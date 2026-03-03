import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
    Sparkles, Upload, X, Loader2, Download, Image as ImageIcon, AlertCircle,
} from 'lucide-react';
import { type Provider, type Quality } from '../services/settings';
import { generateImage, estimateCost, ASPECT_RATIOS, getPreviewDimensions } from '../services/imageGen';

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

type GenStatus = 'idle' | 'generating' | 'done' | 'error';

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
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const addImages = useCallback((files: FileList | File[]) => {
        const remaining = MAX_REFERENCE_IMAGES - referenceImages.length;
        const toAdd = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remaining);
        toAdd.forEach(file => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const dataUrl = ev.target?.result as string;
                if (dataUrl) {
                    setReferenceImages(prev => prev.length < MAX_REFERENCE_IMAGES ? [...prev, dataUrl] : prev);
                }
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

    const handleGenerate = useCallback(async () => {
        if (!prompt.trim() || status === 'generating') return;
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
            setError(err instanceof Error ? err.message : '알 수 없는 오류');
            setStatus('error');
        }
    }, [prompt, provider, aspectRatio, quality, imageCount, referenceImages, status]);

    const handleDownload = useCallback((url: string, index: number) => {
        try {
            const link = document.createElement('a');
            link.href = url;
            link.download = `lumina-${provider}-${Date.now()}-${index + 1}.png`;
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
                        <label className="gen-label">Prompt</label>
                        <textarea
                            className="gen-textarea"
                            value={prompt}
                            onChange={e => setPrompt(e.target.value)}
                            placeholder="이미지를 설명해주세요..."
                            rows={4}
                        />
                    </div>

                    <div className="gen-section">
                        <label className="gen-label">Reference Images ({referenceImages.length}/{MAX_REFERENCE_IMAGES})</label>
                        <div className="gen-drop-zone" onDrop={handleDrop} onDragOver={e => e.preventDefault()} onClick={() => fileInputRef.current?.click()}>
                            <Upload size={18} strokeWidth={1.5} />
                            <span>드래그하거나 클릭하여 업로드</span>
                            <input ref={fileInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { if (e.target.files) addImages(e.target.files); e.target.value = ''; }} />
                        </div>
                        {referenceImages.length > 0 && (
                            <div className="gen-ref-grid">
                                {referenceImages.map((img, i) => (
                                    <div key={i} className="gen-ref-thumb">
                                        <img src={img} alt={`ref ${i + 1}`} />
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
        </div>
    );
}
