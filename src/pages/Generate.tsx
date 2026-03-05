import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
    Sparkles, Upload, X, Loader2, Download, Image as ImageIcon, AlertCircle,
    Bookmark, BookmarkCheck, ChevronDown, Trash2, AlertTriangle,
} from 'lucide-react';
import { type Provider, type Quality } from '../services/settings';
import { generateImage, estimateCost, ASPECT_RATIOS, getPreviewDimensions, compressImageIfNeeded, humanizeError } from '../services/imageGen';
import { isTauri } from '../utils/platform';

const PROVIDERS: { id: Provider; label: string; desc: string }[] = [
    { id: 'gemini', label: 'Nano Banana', desc: 'Google Gemini' },
    { id: 'openai', label: 'GPT Image', desc: 'OpenAI' },
    { id: 'seedream', label: 'SeedDream', desc: 'ByteDance' },
];

const QUALITY_PRESETS: { id: Quality; label: string }[] = [
    { id: 'standard', label: 'Standard' },
    { id: '2k', label: '2K' },
    { id: '4k', label: '4K' },
];

const MAX_REFERENCE_IMAGES = 5;
const IMAGE_COUNT_OPTIONS = [1, 2, 3, 4] as const;
const MAX_SAVED_PROMPTS = 10;
const OPENAI_MAX_BYTES_PER_IMAGE = 4 * 1024 * 1024; // OpenAI images/edits 4MB limit

/** Returns indices of images exceeding the byte limit */
function getOversizedIndices(images: string[], limitBytes: number): number[] {
    return images.reduce<number[]>((acc, img, i) => {
        const base64 = img.split(',')[1] || '';
        const bytes = Math.round(base64.length * 3 / 4);
        if (bytes > limitBytes) acc.push(i);
        return acc;
    }, []);
}

/** Get estimated byte size of a base64 data URL */
function getBase64Size(dataUrl: string): number {
    const base64 = dataUrl.split(',')[1] || '';
    return Math.round(base64.length * 3 / 4);
}

function formatMB(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1);
}
const SAVED_PROMPTS_KEY = 'lumina-studio-saved-prompts';

type GenStatus = 'idle' | 'generating' | 'done' | 'error';

// ===== Saved Prompts =====
interface SavedPrompt {
    id: string;
    text: string;
    savedAt: number;
}

function loadSavedPrompts(): SavedPrompt[] {
    try {
        return JSON.parse(localStorage.getItem(SAVED_PROMPTS_KEY) || '[]');
    } catch { return []; }
}

function persistSavedPrompts(prompts: SavedPrompt[]) {
    localStorage.setItem(SAVED_PROMPTS_KEY, JSON.stringify(prompts));
}

interface GenerateProps {
    initialRefs?: string[];
    onRefsConsumed?: () => void;
}

export default function Generate({ initialRefs, onRefsConsumed }: GenerateProps) {
    const [provider, setProvider] = useState<Provider>('gemini');
    const [prompt, setPrompt] = useState('');
    const [aspectRatio, setAspectRatio] = useState('3:2');
    const [quality, setQuality] = useState<Quality>('standard');
    const [imageCount, setImageCount] = useState(1);
    const [referenceImages, setReferenceImages] = useState<string[]>([]);
    const [status, setStatus] = useState<GenStatus>('idle');
    const [imageUrls, setImageUrls] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [duration, setDuration] = useState<number | null>(null);
    const [isCompressing, setIsCompressing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Reference image preview lightbox
    const [previewRef, setPreviewRef] = useState<number | null>(null);

    // Saved prompts
    const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(() => loadSavedPrompts());
    const [showPromptList, setShowPromptList] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const promptListRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (promptListRef.current && !promptListRef.current.contains(e.target as Node)) {
                setShowPromptList(false);
            }
        };
        if (showPromptList) document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showPromptList]);

    // Receive references from Gallery selection mode
    const consumedRef = useRef(false);
    useEffect(() => {
        if (initialRefs && initialRefs.length > 0 && !consumedRef.current) {
            consumedRef.current = true;
            setReferenceImages(initialRefs.slice(0, MAX_REFERENCE_IMAGES));
            onRefsConsumed?.();
        }
        if (!initialRefs || initialRefs.length === 0) {
            consumedRef.current = false;
        }
    }, [initialRefs, onRefsConsumed]);

    const costEstimate = useMemo(() => {
        const single = estimateCost(provider, quality, aspectRatio, referenceImages.length);
        return {
            cost: single.cost * imageCount,
            detail: imageCount > 1 ? `${single.detail} × ${imageCount}장` : single.detail,
        };
    }, [provider, quality, aspectRatio, referenceImages.length, imageCount]);

    // OpenAI 4MB per-image limit check
    const oversizedIndices = useMemo(() => {
        if (provider !== 'openai' || referenceImages.length === 0) return [];
        return getOversizedIndices(referenceImages, OPENAI_MAX_BYTES_PER_IMAGE);
    }, [provider, referenceImages]);

    const addImages = useCallback((files: FileList | File[]) => {
        const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
        const toAdd = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
        if (toAdd.length === 0) return;

        setIsCompressing(true);
        let processed = 0;

        toAdd.forEach(file => {
            const reader = new FileReader();
            reader.onload = async (ev) => {
                const dataUrl = ev.target?.result as string;
                if (dataUrl) {
                    const compressed = await compressImageIfNeeded(dataUrl);
                    setReferenceImages(prev => prev.length < MAX_REFERENCE_IMAGES ? [...prev, compressed] : prev);
                }
                processed++;
                if (processed >= toAdd.length) setIsCompressing(false);
            };
            reader.readAsDataURL(file);
        });
    }, [referenceImages.length]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files) addImages(e.dataTransfer.files);
    }, [addImages]);

    const removeImage = useCallback((index: number) => {
        setReferenceImages(prev => prev.filter((_, i) => i !== index));
    }, []);

    // ===== Prompt Save/Load =====
    const saveCurrentPrompt = useCallback(() => {
        const text = prompt.trim();
        if (!text) return;
        // Avoid duplicates
        if (savedPrompts.some(p => p.text === text)) return;
        const newPrompt: SavedPrompt = { id: Date.now().toString(), text, savedAt: Date.now() };
        const updated = [newPrompt, ...savedPrompts].slice(0, MAX_SAVED_PROMPTS);
        setSavedPrompts(updated);
        persistSavedPrompts(updated);
        // Visual feedback
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 1500);
    }, [prompt, savedPrompts]);

    const deletePrompt = useCallback((id: string) => {
        const updated = savedPrompts.filter(p => p.id !== id);
        setSavedPrompts(updated);
        persistSavedPrompts(updated);
    }, [savedPrompts]);

    const loadPrompt = useCallback((text: string) => {
        setPrompt(text);
        setShowPromptList(false);
    }, []);

    const handleGenerate = useCallback(async () => {
        if (!prompt.trim() || status === 'generating') return;

        // OpenAI: warn about oversized reference images before spending API cost
        if (provider === 'openai' && referenceImages.length > 0) {
            const oversized = getOversizedIndices(referenceImages, OPENAI_MAX_BYTES_PER_IMAGE);
            if (oversized.length > 0) {
                const details = oversized.map(i => {
                    const sizeMB = formatMB(getBase64Size(referenceImages[i]));
                    return `  #${i + 1}: ${sizeMB}MB`;
                }).join('\n');
                const ok = window.confirm(
                    `⚠ OpenAI는 참조 이미지당 4MB 제한이 있습니다.\n\n` +
                    `다음 이미지가 초과합니다:\n${details}\n\n` +
                    `자동 압축을 시도하지만 API 에러가 발생할 수 있습니다.\n계속하시겠습니까?`
                );
                if (!ok) return;
            }
        }

        setStatus('generating');
        setError(null);
        setImageUrls([]);
        setDuration(null);

        try {
            const result = await generateImage({
                provider,
                prompt: prompt.trim(),
                aspectRatio,
                quality,
                n: imageCount,
                referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
            });
            setImageUrls(result.imageUrls);
            setDuration(result.duration);
            setStatus('done');
        } catch (err) {
            setError(humanizeError(err, provider));
            setStatus('error');
        }
    }, [prompt, provider, aspectRatio, quality, imageCount, referenceImages, status]);

    const handleDownload = useCallback(async (url: string, index: number) => {
        const filename = `lumina-${provider}-${Date.now()}-${index + 1}.png`;

        if (isTauri()) {
            try {
                const { save } = await import('@tauri-apps/plugin-dialog');
                const { writeFile } = await import('@tauri-apps/plugin-fs');

                const savePath = await save({
                    defaultPath: filename,
                    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
                });
                if (!savePath) return;

                let bytes: Uint8Array;
                if (url.startsWith('data:')) {
                    const base64Data = url.split(',')[1];
                    const raw = atob(base64Data);
                    bytes = new Uint8Array(raw.length);
                    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
                } else {
                    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
                    const resp = await tauriFetch(url);
                    bytes = new Uint8Array(await resp.arrayBuffer());
                }

                await writeFile(savePath, bytes);
                console.log(`[Download] Saved to: ${savePath}`);
            } catch (err) {
                console.error('[Download] Tauri save error:', err);
            }
            return;
        }

        try {
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch {
            window.open(url, '_blank');
        }
    }, [provider]);

    return (
        <div className="generate-page">
            <div className="generate-layout">
                {/* ─── Left: Controls ─── */}
                <div className="gen-controls">
                    <div className="gen-section">
                        <label className="gen-label">Provider</label>
                        <div className="gen-provider-grid">
                            {PROVIDERS.map(p => (
                                <button
                                    key={p.id}
                                    className={`gen-provider-btn ${provider === p.id ? 'active' : ''}`}
                                    onClick={() => setProvider(p.id)}
                                >
                                    <span className="gen-provider-name">{p.label}</span>
                                    <span className="gen-provider-desc">{p.desc}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="gen-section">
                        <div className="gen-label-row">
                            <label className="gen-label" style={{ marginBottom: 0 }}>Prompt</label>
                            <div className="gen-prompt-actions">
                                <button
                                    className={`gen-prompt-action-btn ${justSaved ? 'saved' : ''}`}
                                    onClick={saveCurrentPrompt}
                                    disabled={!prompt.trim()}
                                    title="프롬프트 저장"
                                >
                                    {justSaved ? <BookmarkCheck size={13} /> : <Bookmark size={13} />}
                                </button>
                                <div className="gen-prompt-dropdown-wrap" ref={promptListRef}>
                                    <button
                                        className={`gen-prompt-action-btn ${showPromptList ? 'active' : ''}`}
                                        onClick={() => setShowPromptList(v => !v)}
                                        disabled={savedPrompts.length === 0}
                                        title={`저장된 프롬프트 (${savedPrompts.length}/${MAX_SAVED_PROMPTS})`}
                                    >
                                        <ChevronDown size={13} />
                                        {savedPrompts.length > 0 && (
                                            <span className="gen-prompt-badge">{savedPrompts.length}</span>
                                        )}
                                    </button>
                                    {showPromptList && (
                                        <div className="gen-prompt-dropdown">
                                            {savedPrompts.map(sp => (
                                                <div key={sp.id} className="gen-prompt-item">
                                                    <button className="gen-prompt-item-text" onClick={() => loadPrompt(sp.text)}>
                                                        {sp.text.length > 80 ? sp.text.slice(0, 80) + '...' : sp.text}
                                                    </button>
                                                    <button className="gen-prompt-item-del" onClick={(e) => { e.stopPropagation(); deletePrompt(sp.id); }}>
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <textarea
                            className="gen-textarea"
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            placeholder="이미지를 설명해주세요..."
                            rows={4}
                        />
                    </div>

                    <div className="gen-section">
                        <label className="gen-label">
                            Reference Images ({referenceImages.length}/{MAX_REFERENCE_IMAGES})
                            {isCompressing && <span style={{ marginLeft: 8, fontSize: '0.8em', opacity: 0.7 }}>압축 중...</span>}
                        </label>
                        <div className="gen-drop-zone" onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => fileInputRef.current?.click()}>
                            {isCompressing ? <Loader2 size={18} strokeWidth={1.5} className="spin" /> : <Upload size={18} strokeWidth={1.5} />}
                            <span>{isCompressing ? '이미지 최적화 중...' : '드래그하거나 클릭하여 업로드 (최대 10MB)'}</span>
                            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files) addImages(e.target.files); e.target.value = ''; }} />
                        </div>
                        {/* OpenAI oversized warning banner */}
                        {oversizedIndices.length > 0 && (
                            <div className="gen-ref-warning">
                                <AlertTriangle size={14} />
                                <span>
                                    OpenAI 4MB 제한 초과: 이미지
                                    {oversizedIndices.map(i => ` #${i + 1} (${formatMB(getBase64Size(referenceImages[i]))}MB)`).join(',')}
                                    — 생성 시 에러가 발생할 수 있습니다
                                </span>
                            </div>
                        )}
                        {referenceImages.length > 0 && (
                            <div className="gen-ref-grid">
                                {referenceImages.map((img, i) => (
                                    <div key={i} className={`gen-ref-thumb ${oversizedIndices.includes(i) ? 'oversized' : ''}`}>
                                        <img
                                            src={img}
                                            alt={`ref ${i + 1}`}
                                            onClick={(e) => { e.stopPropagation(); setPreviewRef(i); }}
                                            style={{ cursor: 'pointer' }}
                                        />
                                        {oversizedIndices.includes(i) && (
                                            <span className="gen-ref-size-badge">{formatMB(getBase64Size(img))}MB</span>
                                        )}
                                        <button className="gen-ref-remove" onClick={() => removeImage(i)}><X size={12} /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="gen-row">
                        <div className="gen-section" style={{ flex: 1 }}>
                            <label className="gen-label">Aspect Ratio</label>
                            <div className="gen-ratio-grid">
                                {ASPECT_RATIOS.map(r => {
                                    const dim = getPreviewDimensions(r.id);
                                    return (
                                        <button key={r.id} className={`gen-ratio-btn ${aspectRatio === r.id ? 'active' : ''}`} onClick={() => setAspectRatio(r.id)} title={r.desc}>
                                            <div className="gen-ratio-preview" style={{ width: dim.w * 0.5, height: dim.h * 0.5 }} />
                                            <span>{r.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="gen-row">
                        <div className="gen-section" style={{ flex: 1 }}>
                            <label className="gen-label">Quality</label>
                            <div className="gen-quality-grid">
                                {QUALITY_PRESETS.map(q => (
                                    <button key={q.id} className={`gen-pill ${quality === q.id ? 'active' : ''}`} onClick={() => setQuality(q.id)}>
                                        {q.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="gen-section">
                            <label className="gen-label">Output</label>
                            <div className="gen-count">
                                {IMAGE_COUNT_OPTIONS.map(n => (
                                    <button key={n} className={`gen-count-btn ${imageCount === n ? 'active' : ''}`} onClick={() => setImageCount(n)}>
                                        {n}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="gen-footer">
                        <div className="gen-cost">
                            예상 비용: <strong>${costEstimate.cost.toFixed(3)}</strong>
                            <span className="gen-cost-detail">{costEstimate.detail}</span>
                        </div>
                        <button className="gen-generate-btn" onClick={handleGenerate} disabled={!prompt.trim() || status === 'generating'}>
                            {status === 'generating' ? (<><Loader2 size={16} className="spin" /> 생성 중...</>) : (<><Sparkles size={16} /> 이미지 생성</>)}
                        </button>
                    </div>
                </div>

                {/* ─── Right: Results ─── */}
                <div className="gen-results">
                    {status === 'idle' && imageUrls.length === 0 && (
                        <div className="gen-empty">
                            <ImageIcon size={48} strokeWidth={1} />
                            <p>프롬프트를 입력하고 생성 버튼을 눌러주세요</p>
                        </div>
                    )}
                    {status === 'generating' && (
                        <div className="gen-empty">
                            <Loader2 size={40} className="spin" />
                            <p>이미지 생성 중...</p>
                        </div>
                    )}
                    {status === 'error' && error && (
                        <div className="gen-error">
                            <AlertCircle size={20} />
                            <p>{error}</p>
                            <button className="gen-retry-btn" onClick={handleGenerate}>다시 시도</button>
                        </div>
                    )}
                    {imageUrls.length > 0 && (
                        <>
                            {duration !== null && (
                                <div className="gen-duration">⏱ {(duration / 1000).toFixed(1)}초</div>
                            )}
                            <div className={`gen-result-grid count-${imageUrls.length}`}>
                                {imageUrls.map((url, i) => (
                                    <div key={i} className="gen-result-item">
                                        <img src={url} alt={`Generated ${i + 1}`} />
                                        <button className="gen-download-btn" onClick={() => handleDownload(url, i)}>
                                            <Download size={14} /> 저장
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ─── Reference Image Preview Lightbox ─── */}
            {previewRef !== null && referenceImages[previewRef] && (
                <div className="ref-preview-overlay" onClick={() => setPreviewRef(null)}>
                    <button className="ref-preview-close" onClick={() => setPreviewRef(null)}>
                        <X size={18} />
                    </button>
                    <img
                        src={referenceImages[previewRef]}
                        alt={`Reference preview ${previewRef + 1}`}
                        className="ref-preview-image"
                        onClick={e => e.stopPropagation()}
                    />
                    <div className="ref-preview-info" onClick={e => e.stopPropagation()}>
                        {previewRef + 1} / {referenceImages.length}
                    </div>
                    {previewRef > 0 && (
                        <button className="ref-preview-nav prev" onClick={e => { e.stopPropagation(); setPreviewRef(previewRef - 1); }}>‹</button>
                    )}
                    {previewRef < referenceImages.length - 1 && (
                        <button className="ref-preview-nav next" onClick={e => { e.stopPropagation(); setPreviewRef(previewRef + 1); }}>›</button>
                    )}
                </div>
            )}
        </div>
    );
}
