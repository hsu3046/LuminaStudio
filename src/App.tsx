import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Folder, FolderOpen, Image, Monitor, Download, ChevronRight,
  ArrowUp, Grid2x2, Grid3x3, List, X, ChevronLeft, ChevronRight as ChevronRightNav,
  FolderPlus, Inbox, Sparkles, Wand2, Settings, CheckSquare, Square, Check,
} from "lucide-react";
import Generate from "./pages/Generate";
import SettingsPage from "./pages/Settings";
import "./App.css";

// ─── Types ───

interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  size: number;
  modified: number;
  mime_type: string;
  category: string;
}

interface DirectoryListing {
  current_path: string;
  parent_path: string | null;
  files: FileEntry[];
  total_count: number;
  image_count: number;
  folder_count: number;
}

interface ThumbnailResult {
  data: string;
  width: number;
  height: number;
}

type ViewMode = "grid" | "large" | "list";

// ─── Helpers ───

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pathComponents(fullPath: string): { name: string; path: string }[] {
  const parts = fullPath.split("/").filter(Boolean);
  return parts.map((name, i) => ({
    name,
    path: "/" + parts.slice(0, i + 1).join("/"),
  }));
}

// ─── Thumbnail concurrency limiter ───
// Max 3 concurrent thumbnail IPC calls. No class, just 3 variables.
let thumbActive = 0;
const THUMB_MAX = 3;
const thumbWait: Array<() => void> = [];

async function loadThumbnail(path: string, size: number): Promise<string | null> {
  if (thumbActive >= THUMB_MAX) {
    await new Promise<void>((resolve) => thumbWait.push(resolve));
  }
  thumbActive++;
  try {
    const r = await invoke<ThumbnailResult>("get_thumbnail", { path, size });
    return `data:image/jpeg;base64,${r.data}`;
  } catch {
    return null;
  } finally {
    thumbActive--;
    thumbWait.shift()?.();
  }
}

// ─── Lazy Thumbnail ───
// Uses IntersectionObserver to load thumbnails only when visible.

function Thumbnail({ file, size }: { file: FileEntry; size: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (file.category !== "image" || loaded.current) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          observer.disconnect();
          loaded.current = true;
          loadThumbnail(file.path, size).then((url) => {
            if (url) setSrc(url);
          });
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [file.path, file.category, size]);

  if (file.is_directory) {
    return (
      <div className="thumbnail-wrapper" ref={ref}>
        <div className="folder-icon"><Folder size={40} strokeWidth={1.5} /></div>
      </div>
    );
  }

  return (
    <div className="thumbnail-wrapper" ref={ref}>
      {src ? (
        <img src={src} alt={file.name} />
      ) : (
        <div className="thumb-placeholder">
          <span className="thumb-placeholder-ext">
            {file.name.split(".").pop()?.toUpperCase() ?? ""}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Lightbox ───

function Lightbox({
  images,
  currentIndex,
  onClose,
  onNavigate,
}: {
  images: FileEntry[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const current = images[currentIndex];

  useEffect(() => {
    setLoading(true);
    setImageData(null);
    invoke<string>("get_image_base64", { path: current.path })
      .then((data) => {
        setImageData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [current.path]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && currentIndex > 0)
        onNavigate(currentIndex - 1);
      else if (e.key === "ArrowRight" && currentIndex < images.length - 1)
        onNavigate(currentIndex + 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentIndex, images.length, onClose, onNavigate]);

  return (
    <div className="lightbox-overlay" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose}>
        <X size={18} />
      </button>

      {currentIndex > 0 && (
        <button
          className="lightbox-nav prev"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex - 1);
          }}
        >
          <ChevronLeft size={22} />
        </button>
      )}

      {loading ? (
        <div className="lightbox-loading">로딩 중...</div>
      ) : imageData ? (
        <img
          src={imageData}
          alt={current.name}
          className="lightbox-image"
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}

      {currentIndex < images.length - 1 && (
        <button
          className="lightbox-nav next"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(currentIndex + 1);
          }}
        >
          <ChevronRightNav size={22} />
        </button>
      )}

      <div className="lightbox-info" onClick={(e) => e.stopPropagation()}>
        <span className="filename">{current.name}</span>
        <span className="counter">
          {currentIndex + 1} / {images.length}
        </span>
      </div>
    </div>
  );
}

// ─── App ───

const PAGE_SIZE = 30;

type AppPage = 'gallery' | 'generate' | 'settings';

export default function App() {
  const [page, setPage] = useState<AppPage>('gallery');
  const [currentPath, setCurrentPath] = useState("");
  const [allFiles, setAllFiles] = useState<FileEntry[]>([]);
  const [imageCount, setImageCount] = useState(0);
  const [folderCount, setFolderCount] = useState(0);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [recentFolders, setRecentFolders] = useState<string[]>([]);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const galleryRef = useRef<HTMLDivElement>(null);

  // ─── Selection Mode (for reference images) ───
  const [selectMode, setSelectMode] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [pendingRefs, setPendingRefs] = useState<string[]>([]);

  // Navigate to a directory
  const navigateTo = useCallback(async (path: string) => {
    setLoading(true);
    setAllFiles([]);
    setDisplayCount(PAGE_SIZE);
    try {
      const result = await invoke<DirectoryListing>("scan_directory", {
        path,
      });
      setAllFiles(result.files);
      setCurrentPath(result.current_path);
      setParentPath(result.parent_path);
      setImageCount(result.image_count);
      setFolderCount(result.folder_count);
      setRecentFolders((prev) =>
        [path, ...prev.filter((p) => p !== path)].slice(0, 5)
      );
      galleryRef.current?.scrollTo(0, 0);
    } catch (err) {
      console.error("scan_directory error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    invoke<string>("get_pictures_directory")
      .then((path) => navigateTo(path))
      .catch(() =>
        invoke<string>("get_home_directory").then((path) => navigateTo(path))
      );
  }, [navigateTo]);

  // Open folder dialog
  const handleOpenFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "폴더 선택",
    });
    if (selected) navigateTo(selected as string);
  }, [navigateTo]);

  // Click handler
  const handleItemClick = useCallback(
    (file: FileEntry) => {
      if (selectMode && file.category === 'image') {
        // Toggle selection
        setSelectedPaths(prev => {
          const next = new Set(prev);
          if (next.has(file.path)) next.delete(file.path);
          else if (next.size < 5) next.add(file.path);
          return next;
        });
        return;
      }
      if (file.is_directory) {
        navigateTo(file.path);
      } else if (file.category === "image") {
        const images = allFiles.filter((f) => f.category === "image");
        const idx = images.findIndex((f) => f.path === file.path);
        if (idx >= 0) setLightboxIndex(idx);
      }
    },
    [allFiles, navigateTo, selectMode]
  );

  // Use selected images as references → switch to Generate
  const handleUseAsReference = useCallback(async () => {
    const paths = Array.from(selectedPaths);
    try {
      const base64Results = await Promise.all(
        paths.map(p => invoke<string>('get_image_base64', { path: p }))
      );
      setPendingRefs(base64Results);
      setSelectMode(false);
      setSelectedPaths(new Set());
      setPage('generate');
    } catch (err) {
      console.error('Failed to load reference images:', err);
    }
  }, [selectedPaths]);

  // Toggle select mode
  const toggleSelectMode = useCallback(() => {
    setSelectMode(prev => {
      if (prev) setSelectedPaths(new Set());
      return !prev;
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "o") {
        e.preventDefault();
        handleOpenFolder();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handleOpenFolder]);

  const displayedFiles = allFiles.slice(0, displayCount);
  const hasMore = displayCount < allFiles.length;
  const imageFiles = useMemo(
    () => allFiles.filter((f) => f.category === "image"),
    [allFiles]
  );
  const breadcrumbs = currentPath ? pathComponents(currentPath) : [];
  const thumbSize = viewMode === "large" ? 400 : 300;

  return (
    <div className="app-layout">
      {/* ─── Sidebar ─── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1><Sparkles size={16} /> Lumina Studio</h1>
        </div>
        <div className="sidebar-content">
          {/* App tabs */}
          <div className="sidebar-section">
            <div className="sidebar-section-title">App</div>
            <button className={`sidebar-item ${page === 'gallery' ? 'active' : ''}`} onClick={() => setPage('gallery')}>
              <span className="icon"><Image size={16} strokeWidth={1.5} /></span>
              <span className="label">Gallery</span>
            </button>
            <button className={`sidebar-item ${page === 'generate' ? 'active' : ''}`} onClick={() => setPage('generate')}>
              <span className="icon"><Wand2 size={16} strokeWidth={1.5} /></span>
              <span className="label">Generate</span>
            </button>
            <button className={`sidebar-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}>
              <span className="icon"><Settings size={16} strokeWidth={1.5} /></span>
              <span className="label">Settings</span>
            </button>
          </div>

          {/* Gallery-specific sections (only when on gallery page) */}
          {page === 'gallery' && (
            <>
              <div className="sidebar-section">
                <div className="sidebar-section-title">Quick Access</div>
                <button className="sidebar-item" onClick={() => invoke<string>("get_pictures_directory").then(navigateTo)}>
                  <span className="icon"><Image size={16} strokeWidth={1.5} /></span>
                  <span className="label">Pictures</span>
                </button>
                <button className="sidebar-item" onClick={() => invoke<string>("get_home_directory").then((p) => navigateTo(p + "/Desktop"))}>
                  <span className="icon"><Monitor size={16} strokeWidth={1.5} /></span>
                  <span className="label">Desktop</span>
                </button>
                <button className="sidebar-item" onClick={() => invoke<string>("get_home_directory").then((p) => navigateTo(p + "/Downloads"))}>
                  <span className="icon"><Download size={16} strokeWidth={1.5} /></span>
                  <span className="label">Downloads</span>
                </button>
              </div>

              {recentFolders.length > 0 && (
                <div className="sidebar-section">
                  <div className="sidebar-section-title">Recent</div>
                  {recentFolders.map((folder) => (
                    <button
                      key={folder}
                      className={`sidebar-item ${folder === currentPath ? "active" : ""}`}
                      onClick={() => navigateTo(folder)}
                    >
                      <span className="icon"><FolderOpen size={16} strokeWidth={1.5} /></span>
                      <span className="label">{folder.split("/").pop() || folder}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        {page === 'gallery' && (
          <button className="open-folder-btn" onClick={handleOpenFolder}>
            <FolderPlus size={14} strokeWidth={1.5} /> 폴더 열기
          </button>
        )}
      </aside>

      {/* ─── Main ─── */}
      <div className="main-content">
        {page === 'gallery' && (
          <>
            {/* Toolbar */}
            <div className="toolbar">
              <div className="toolbar-left">
                {parentPath && (
                  <button
                    className="toolbar-btn"
                    onClick={() => navigateTo(parentPath)}
                    title="상위 폴더"
                  >
                    <ArrowUp size={16} strokeWidth={2} />
                  </button>
                )}
              </div>
              <div className="toolbar-center">
                <div className="breadcrumb">
                  {breadcrumbs.slice(-4).map((bc, i, arr) => (
                    <span
                      key={bc.path}
                      style={{ display: "flex", alignItems: "center", gap: 2 }}
                    >
                      <button
                        className={`breadcrumb-item ${i === arr.length - 1 ? "current" : ""}`}
                        onClick={() => navigateTo(bc.path)}
                      >
                        {bc.name}
                      </button>
                      {i < arr.length - 1 && (
                        <span className="breadcrumb-separator"><ChevronRight size={12} /></span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
              <div className="toolbar-right">
                <span className="stats-badge">
                  {selectMode
                    ? `${selectedPaths.size}/5 선택됨`
                    : <>{allFiles.length > 0 && `${Math.min(displayCount, allFiles.length)}/${allFiles.length}`}{imageCount > 0 && ` · ${imageCount} images`}{folderCount > 0 && ` · ${folderCount} folders`}</>}
                </span>
                <button
                  className={`toolbar-btn ${selectMode ? 'active' : ''}`}
                  onClick={toggleSelectMode}
                  title={selectMode ? '선택 모드 해제' : '레퍼런스 선택'}
                >
                  <CheckSquare size={16} strokeWidth={1.5} />
                </button>
                <button
                  className={`toolbar-btn ${viewMode === "grid" ? "active" : ""}`}
                  onClick={() => setViewMode("grid")}
                  title="그리드"
                >
                  <Grid3x3 size={16} strokeWidth={1.5} />
                </button>
                <button
                  className={`toolbar-btn ${viewMode === "large" ? "active" : ""}`}
                  onClick={() => setViewMode("large")}
                  title="큰 그리드"
                >
                  <Grid2x2 size={16} strokeWidth={1.5} />
                </button>
                <button
                  className={`toolbar-btn ${viewMode === "list" ? "active" : ""}`}
                  onClick={() => setViewMode("list")}
                  title="리스트"
                >
                  <List size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>

            {/* Gallery */}
            <div className="gallery-container" ref={galleryRef}>
              {!currentPath && !loading && (
                <div className="empty-state">
                  <div className="empty-icon"><Folder size={48} strokeWidth={1} /></div>
                  <div className="empty-text">폴더를 선택해주세요</div>
                  <div className="empty-hint">⌘O 로 빠르게 열 수 있습니다</div>
                  <button onClick={handleOpenFolder}>폴더 열기</button>
                </div>
              )}

              {loading && (
                <div className={`gallery-grid view-${viewMode}`}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="gallery-item">
                      <div className="skeleton" style={{ paddingBottom: "100%" }} />
                      <div className="item-info">
                        <div className="skeleton" style={{ height: 14, width: "70%", marginTop: 4 }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!loading && currentPath && allFiles.length === 0 && (
                <div className="empty-state">
                  <div className="empty-icon"><Inbox size={48} strokeWidth={1} /></div>
                  <div className="empty-text">표시할 이미지가 없습니다</div>
                </div>
              )}

              {!loading && displayedFiles.length > 0 && (
                <>
                  <div className={`gallery-grid view-${viewMode}`}>
                    {displayedFiles.map((file) => {
                      const isSelected = selectedPaths.has(file.path);
                      const isImage = file.category === 'image';
                      return (
                        <div
                          key={file.path}
                          className={`gallery-item ${file.is_directory ? "folder" : ""} ${selectMode && isImage ? 'selectable' : ''} ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleItemClick(file)}
                        >
                          <Thumbnail file={file} size={thumbSize} />
                          {selectMode && isImage && (
                            <div className="select-check">
                              {isSelected ? <Check size={14} /> : <Square size={14} />}
                            </div>
                          )}
                          <div className="item-info">
                            <div className="item-name" title={file.name}>{file.name}</div>
                            <div className="item-meta">
                              {file.is_directory ? "폴더" : formatFileSize(file.size)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {hasMore && (
                    <div className="load-more-container">
                      <button
                        className="load-more-btn"
                        onClick={() => setDisplayCount((c) => c + PAGE_SIZE)}
                      >
                        더 보기 ({allFiles.length - displayCount}개 남음)
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Floating action bar when images are selected */}
            {selectMode && selectedPaths.size > 0 && (
              <div className="select-action-bar">
                <span>{selectedPaths.size}장 선택됨</span>
                <button className="select-action-btn" onClick={handleUseAsReference}>
                  <Wand2 size={14} /> 레퍼런스로 사용
                </button>
                <button className="select-cancel-btn" onClick={toggleSelectMode}>
                  취소
                </button>
              </div>
            )}
          </>
        )}

        {page === 'generate' && <Generate initialRefs={pendingRefs} onRefsConsumed={() => setPendingRefs([])} />}
        {page === 'settings' && <SettingsPage />}
      </div>

      {/* Lightbox */}
      {lightboxIndex !== null && imageFiles.length > 0 && (
        <Lightbox
          images={imageFiles}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}
