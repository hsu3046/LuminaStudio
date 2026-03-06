import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { loadSettings, type Provider, type Quality } from '../services/settings';
import {
    Sparkles, Upload, X, Loader2, Download, Image as ImageIcon, AlertCircle,
    Bookmark, BookmarkCheck, ChevronDown, Trash2, AlertTriangle, CheckCircle2, AlertOctagon,
} from 'lucide-react';
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

// ===== Estimated Generation Time =====

function estimateTime(provider: Provider, quality: Quality, n: number, refCount: number): { min: number; max: number } {
    const base: Record<Provider, Record<Quality, [number, number]>> = {
        gemini: { standard: [5, 10], '2k': [8, 15], '4k': [10, 20] },
        openai: { standard: [10, 20], '2k': [15, 30], '4k': [15, 30] },
        seedream: { standard: [8, 15], '2k': [10, 20], '4k': [15, 25] },
    };
    const [bMin, bMax] = base[provider][quality];
    const refAdd = refCount > 0 ? (provider === 'openai' ? 5 : 3) : 0;
    // Gemini runs in parallel, others scale linearly
    const multi = provider === 'gemini' ? Math.max(1, n * 0.6) : n;
    return {
        min: Math.round((bMin + refAdd) * multi),
        max: Math.round((bMax + refAdd) * multi),
    };
}

function getStageMessage(elapsed: number, estMax: number): string {
    const ratio = elapsed / estMax;
    if (ratio < 0.15) return '프롬프트 분석 중...';
    if (ratio < 0.4) return '이미지 렌더링 중...';
    if (ratio < 0.7) return '디테일 생성 중...';
    if (ratio < 0.95) return '거의 완료...';
    return '마무리 중... 조금만 더 기다려주세요';
}

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

    // Auto-save state
    const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

    // Generating progress timer
    const [elapsed, setElapsed] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const timeEstimate = useMemo(() =>
        estimateTime(provider, quality, imageCount, referenceImages.length),
        [provider, quality, imageCount, referenceImages.length]
    );

    // Start/stop elapsed timer on status change
    useEffect(() => {
        if (status === 'generating') {
            setElapsed(0);
            timerRef.current = setInterval(() => setElapsed(prev => prev + 1), 1000);
        } else {
            if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        }
        return () => { if (timerRef.current) clearInterval(timerRef.current); };
    }, [status]);

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

    // ===== Auto-Save =====
    const autoSaveImages = useCallback(async (urls: string[], prov: Provider) => {
        if (!isTauri()) return;
        const settings = loadSettings();
        if (!settings.autoSave || !settings.outputFolder) return;

        setAutoSaveStatus('saving');

        try {
            const { mkdir, create } = await import('@tauri-apps/plugin-fs');
            const { exists } = await import('@tauri-apps/plugin-fs');

            // 폴더가 없으면 생성
            const folderExists = await exists(settings.outputFolder);
            if (!folderExists) {
                await mkdir(settings.outputFolder, { recursive: true });
            }

            const now = new Date();
            const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;

            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                const filename = `lumina-${prov}-${ts}-${i + 1}.png`;
                const filePath = `${settings.outputFolder}/${filename}`;

                let bytes: Uint8Array;
                if (url.startsWith('data:')) {
                    const base64Data = url.split(',')[1];
                    const raw = atob(base64Data);
                    bytes = new Uint8Array(raw.length);
                    for (let j = 0; j < raw.length; j++) bytes[j] = raw.charCodeAt(j);
                } else {
                    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
                    const resp = await tauriFetch(url);
                    bytes = new Uint8Array(await resp.arrayBuffer());
                }

                const file = await create(filePath);
                await file.write(bytes);
                await file.close();
                console.log(`[AutoSave] Saved ${filename} (${bytes.length} bytes)`);
            }

            setAutoSaveStatus('saved');
            // 5초 후 상태 초기화
            setTimeout(() => setAutoSaveStatus('idle'), 5000);
        } catch (err) {
            console.error('[AutoSave] Error:', err);
            setAutoSaveStatus('error');
        }
    }, []);

    const handleGenerate = useCallback(async () => {
        if (!prompt.trim() || status === 'generating') return;

        // 미저장 확인 (자동 저장 OFF이고 이전 결과가 있을 때)
        if (imageUrls.length > 0) {
            const settings = loadSettings();
            const isAutoSaved = settings.autoSave && settings.outputFolder && autoSaveStatus === 'saved';
            if (!isAutoSaved) {
                const ok = window.confirm(
                    '저장하지 않은 이미지가 있습니다.\n새로 생성하면 현재 이미지가 사라집니다.\n\n계속하시겠습니까?'
                );
                if (!ok) return;
            }
        }

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
        setAutoSaveStatus('idle');

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

            // 자동 저장 실행 (비동기, 에러가 나도 생성 결과는 유지)
            autoSaveImages(result.imageUrls, provider);
        } catch (err) {
            setError(humanizeError(err, provider));
            setStatus('error');
        }
    }, [prompt, provider, aspectRatio, quality, imageCount, referenceImages, status, imageUrls.length, autoSaveStatus, autoSaveImages]);

    const handleDownload = useCallback(async (url: string, index: number) => {
        const filename = `lumina-${provider}-${Date.now()}-${index + 1}.png`;

        if (isTauri()) {
            try {
                const { save } = await import('@tauri-apps/plugin-dialog');
                const { create } = await import('@tauri-apps/plugin-fs');

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

                // Use low-level create/write/close for reliable saving
                const file = await create(savePath);
                await file.write(bytes);
                await file.close();
                console.log(`[Download] Saved ${bytes.length} bytes to: ${savePath}`);
            } catch (err) {
                console.error('[Download] Tauri save error:', err);
                const errMsg = err instanceof Error ? err.message : String(err);
                alert(`저장 실패: ${errMsg}`);
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
                            {status === 'generating' ? (<><Loader2 size={16} className="spin" /> 생성 중... ({elapsed}초)</>) : (<><Sparkles size={16} /> 이미지 생성</>)}
                        </button>
                        {status !== 'generating' && (
                            <div className="gen-time-estimate">
                                예상 소요: ~{timeEstimate.min}–{timeEstimate.max}초
                            </div>
                        )}
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
                        <div className="gen-progress">
                            <div className="gen-progress-header">
                                <Loader2 size={28} className="spin" />
                                <div className="gen-progress-info">
                                    <p className="gen-progress-stage">{getStageMessage(elapsed, timeEstimate.max)}</p>
                                    <p className="gen-progress-time">
                                        {elapsed}초 경과 · 예상 {timeEstimate.min}–{timeEstimate.max}초
                                    </p>
                                </div>
                            </div>
                            <div className="gen-progress-bar-track">
                                <div
                                    className="gen-progress-bar-fill"
                                    style={{ width: `${Math.min(95, (elapsed / timeEstimate.max) * 100)}%` }}
                                />
                            </div>
                            {/* Shimmer placeholders */}
                            <div className={`gen-shimmer-grid count-${imageCount}`}>
                                {Array.from({ length: imageCount }).map((_, i) => (
                                    <div key={i} className="gen-shimmer-item">
                                        <div className="shimmer" />
                                    </div>
                                ))}
                            </div>
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
                                <div className="gen-duration-row">
                                    <div className="gen-duration">⏱ {(duration / 1000).toFixed(1)}초</div>
                                    {autoSaveStatus === 'saving' && (
                                        <div className="gen-autosave-badge saving">
                                            <Loader2 size={12} className="spin" /> 자동 저장 중...
                                        </div>
                                    )}
                                    {autoSaveStatus === 'saved' && (
                                        <div className="gen-autosave-badge saved">
                                            <CheckCircle2 size={12} /> 자동 저장됨
                                        </div>
                                    )}
                                    {autoSaveStatus === 'error' && (
                                        <div className="gen-autosave-badge error">
                                            <AlertOctagon size={12} /> 자동 저장 실패
                                        </div>
                                    )}
                                </div>
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
