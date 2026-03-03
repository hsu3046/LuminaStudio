// Image Generation Service
// Ported from lumina-imagegen/app/api/generate/route.ts
// Uses Tauri HTTP plugin to bypass browser CORS restrictions

import { getApiKey, type Provider, type Quality } from './settings';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export interface GenerateOptions {
    provider: Provider;
    prompt: string;
    aspectRatio: string;
    quality: Quality;
    n: number;
    referenceImages?: string[]; // base64 data URL array (max 5)
}

export interface GenerateResult {
    imageUrls: string[];
    duration: number;
}

// ===== Cost Estimation =====

const ASPECT_RATIOS = [
    { id: '1:1', label: '1:1', desc: 'Square' },
    { id: '3:2', label: '3:2', desc: 'Classic Photo' },
    { id: '2:3', label: '2:3', desc: 'Portrait' },
    { id: '4:3', label: '4:3', desc: 'Standard' },
    { id: '3:4', label: '3:4', desc: 'Portrait' },
    { id: '16:9', label: '16:9', desc: 'Widescreen' },
    { id: '9:16', label: '9:16', desc: 'Vertical' },
    { id: '21:9', label: '21:9', desc: 'Ultra Wide' },
] as const;

export { ASPECT_RATIOS };

export function getPreviewDimensions(ratio: string): { w: number; h: number } {
    const [rw, rh] = ratio.split(':').map(Number);
    if (!rw || !rh) return { w: 48, h: 48 };
    const maxDim = 48;
    if (rw >= rh) return { w: maxDim, h: Math.round(maxDim * (rh / rw)) };
    return { w: Math.round(maxDim * (rw / rh)), h: maxDim };
}

export function estimateCost(
    provider: Provider,
    quality: Quality,
    aspectRatio: string,
    refCount: number
): { cost: number; detail: string } {
    switch (provider) {
        case 'gemini': {
            // Gemini: 0.0315 $/image (output), input ~$0.001 per ref
            const inputCost = refCount * 0.001;
            const outputCost = 0.0315;
            return { cost: inputCost + outputCost, detail: `Gemini ~$${(inputCost + outputCost).toFixed(3)}` };
        }
        case 'openai': {
            // OpenAI GPT Image 1: quality × size
            // 1024x1024: low $0.011, med $0.042, high $0.167
            // 1536x1024/1024x1536: low $0.016, med $0.063, high $0.25
            type OaiQuality = 'low' | 'medium' | 'high';
            const [rw, rh] = aspectRatio.split(':').map(Number);
            const isSquare = rw && rh ? Math.abs(rw / rh - 1) < 0.05 : true;
            const oaiQ: OaiQuality = quality === 'standard' ? 'medium' : 'high';
            const prices: Record<string, Record<OaiQuality, number>> = {
                square: { low: 0.011, medium: 0.042, high: 0.167 },
                rect: { low: 0.016, medium: 0.063, high: 0.25 },
            };
            const cost = prices[isSquare ? 'square' : 'rect'][oaiQ];
            return { cost, detail: `OpenAI ~$${cost.toFixed(3)}` };
        }
        case 'seedream': {
            // SeedDream: standard ~$0.02, 2k ~$0.04, 4k ~$0.08
            const costs: Record<Quality, number> = { standard: 0.02, '2k': 0.04, '4k': 0.08 };
            const cost = costs[quality];
            return { cost, detail: `SeedDream ~$${cost.toFixed(3)}` };
        }
    }
}

// ===== API Handlers =====

export async function generateImage(options: GenerateOptions): Promise<GenerateResult> {
    const { provider, prompt, aspectRatio, quality, n, referenceImages } = options;
    const imageCount = Math.min(Math.max(n || 1, 1), 4);

    if (!prompt.trim()) throw new Error('프롬프트가 비어있습니다.');

    const apiKey = getApiKey(provider);
    if (!apiKey) throw new Error(`${provider.toUpperCase()} API Key가 설정되지 않았습니다. Settings에서 설정해주세요.`);

    const startTime = Date.now();

    let imageUrls: string[];
    switch (provider) {
        case 'gemini':
            imageUrls = await handleGemini(apiKey, prompt, aspectRatio, quality, imageCount, referenceImages);
            break;
        case 'openai':
            imageUrls = await handleOpenAI(apiKey, prompt, aspectRatio, quality, imageCount, referenceImages);
            break;
        case 'seedream':
            imageUrls = await handleSeedream(apiKey, prompt, aspectRatio, quality, imageCount, referenceImages);
            break;
    }

    return { imageUrls, duration: Date.now() - startTime };
}

// ===== Gemini 3.1 Flash Image =====

function mapGeminiImageSize(quality?: Quality): string {
    switch (quality) {
        case '4k': return '4K';
        case '2k': return '2K';
        default: return '1K';
    }
}

async function handleGemini(
    apiKey: string, prompt: string, aspectRatio?: string, quality?: Quality,
    n: number = 1, referenceImages?: string[]
): Promise<string[]> {
    const generateOne = async (): Promise<string> => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`;

        const imageConfig: Record<string, string> = {};
        if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
        imageConfig.imageSize = mapGeminiImageSize(quality);

        const requestParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

        const hasRefs = referenceImages && referenceImages.length > 0;
        if (hasRefs) {
            for (const img of referenceImages) {
                const match = img.match(/^data:(image\/\w+);base64,(.+)$/);
                if (match) {
                    requestParts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                }
            }
        }

        const promptText = hasRefs
            ? `Using the ${referenceImages!.length} attached reference image(s), generate a photograph with the following specifications:\n\n${prompt}`
            : prompt;
        requestParts.push({ text: promptText });

        const response = await tauriFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: requestParts }],
                generationConfig: {
                    responseModalities: ['IMAGE'],
                    ...(Object.keys(imageConfig).length > 0 && { imageConfig }),
                },
            }),
        });

        if (!response.ok) {
            const errBody = await response.text();
            throw new Error(`Gemini API 오류 (${response.status}): ${errBody.slice(0, 200)}`);
        }

        const data = await response.json();
        const candidates = data.candidates;
        if (!candidates || candidates.length === 0) {
            throw new Error('Gemini에서 이미지를 생성하지 못했습니다.');
        }

        const parts = candidates[0].content?.parts || [];
        const imagePart = parts.find(
            (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData
        );

        if (!imagePart?.inlineData) {
            throw new Error('Gemini 응답에 이미지가 포함되지 않았습니다.');
        }

        const { mimeType, data: base64Data } = imagePart.inlineData;
        return `data:${mimeType};base64,${base64Data}`;
    };

    // Gemini has no native n param → parallel calls
    return Promise.all(Array.from({ length: n }, () => generateOne()));
}

// ===== OpenAI GPT Image 1 =====

function mapOpenAIParams(aspectRatio?: string, quality?: Quality): { size: string; quality: string } {
    let size = '1024x1024';
    if (aspectRatio) {
        const [w, h] = aspectRatio.split(':').map(Number);
        if (w && h) {
            const ratio = w / h;
            if (Math.abs(ratio - 1) < 0.05) size = '1024x1024';
            else if (ratio > 1) size = '1536x1024';
            else size = '1024x1536';
        }
    }

    let openaiQuality = 'medium';
    switch (quality) {
        case 'standard': openaiQuality = 'medium'; break;
        case '2k': openaiQuality = 'high'; break;
        case '4k': openaiQuality = 'high'; break;
    }

    return { size, quality: openaiQuality };
}

async function handleOpenAI(
    apiKey: string, prompt: string, aspectRatio?: string, quality?: Quality,
    n: number = 1, referenceImages?: string[]
): Promise<string[]> {
    const { size, quality: openaiQuality } = mapOpenAIParams(aspectRatio, quality);
    const hasRefs = referenceImages && referenceImages.length > 0;

    let response: Response;

    if (hasRefs) {
        // Reference images → /v1/images/edits (multipart/form-data)
        const formData = new FormData();

        for (let i = 0; i < referenceImages.length; i++) {
            const match = referenceImages[i].match(/^data:(image\/\w+);base64,(.+)$/);
            if (!match) continue;
            const mimeType = match[1];
            const base64Data = match[2];
            const ext = mimeType.split('/')[1] || 'png';
            // Convert base64 to Blob
            const byteChars = atob(base64Data);
            const byteArray = new Uint8Array(byteChars.length);
            for (let j = 0; j < byteChars.length; j++) {
                byteArray[j] = byteChars.charCodeAt(j);
            }
            const imageBlob = new Blob([byteArray], { type: mimeType });
            formData.append('image[]', imageBlob, `reference_${i + 1}.${ext}`);
        }

        formData.append('model', 'gpt-image-1');
        formData.append('prompt', `Using the ${referenceImages.length} attached reference image(s), generate a photograph with the following specifications:\n\n${prompt}`);
        formData.append('n', String(n));
        formData.append('size', size);
        formData.append('quality', openaiQuality);

        response = await tauriFetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: formData,
        });
    } else {
        // Text only → /v1/images/generations (JSON)
        response = await tauriFetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: 'gpt-image-1',
                prompt,
                n,
                size,
                quality: openaiQuality,
                moderation: 'low',
            }),
        });
    }

    if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`OpenAI API 오류 (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    if (!data.data || data.data.length === 0) {
        throw new Error('OpenAI에서 이미지를 생성하지 못했습니다.');
    }

    return data.data
        .map((item: { b64_json?: string; url?: string }) => {
            if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
            if (item.url) return item.url;
            return null;
        })
        .filter(Boolean) as string[];
}

// ===== ByteDance SeedDream 4.5 =====

const SEEDREAM_MIN_PIXELS = 3_686_400;  // 1920²
const SEEDREAM_MAX_PIXELS = 16_777_216; // 4096²

function mapSeedreamSize(aspectRatio?: string, quality?: Quality): string {
    let targetPixels: number;
    switch (quality) {
        case '4k': targetPixels = SEEDREAM_MAX_PIXELS; break;
        case '2k': targetPixels = 6_553_600; break;
        default: targetPixels = SEEDREAM_MIN_PIXELS; break;
    }

    const [rw, rh] = (aspectRatio || '1:1').split(':').map(Number);
    if (!rw || !rh) return '1920x1920';

    let h = Math.sqrt(targetPixels * rh / rw);
    let w = h * rw / rh;

    if (w * h < SEEDREAM_MIN_PIXELS) {
        const scale = Math.sqrt(SEEDREAM_MIN_PIXELS / (w * h));
        w *= scale;
        h *= scale;
    }

    if (w * h > SEEDREAM_MAX_PIXELS) {
        const scale = Math.sqrt(SEEDREAM_MAX_PIXELS / (w * h));
        w *= scale;
        h *= scale;
    }

    w = Math.ceil(w / 2) * 2;
    h = Math.ceil(h / 2) * 2;

    while (w * h < SEEDREAM_MIN_PIXELS) {
        w += 2;
        h += 2;
    }

    return `${w}x${h}`;
}

async function handleSeedream(
    apiKey: string, prompt: string, aspectRatio?: string, quality?: Quality,
    n: number = 1, referenceImages?: string[]
): Promise<string[]> {
    const size = mapSeedreamSize(aspectRatio, quality);
    const hasRefs = referenceImages && referenceImages.length > 0;

    console.log(`[SeedDream] Size: ${size} (ratio: ${aspectRatio}, quality: ${quality}, n: ${n})`);
    if (hasRefs) {
        console.log(`[SeedDream] Reference images: ${referenceImages.length}장`);
        referenceImages.forEach((img, i) => {
            const match = img.match(/^data:(image\/\w+);base64,/);
            const type = match ? match[1] : 'unknown';
            const sizeKB = Math.round((img.length * 3) / 4 / 1024);
            console.log(`  [${i + 1}] ${type}, ~${sizeKB}KB`);
        });
    } else {
        console.log('[SeedDream] No reference images');
    }

    const finalPrompt = hasRefs
        ? `Using the ${referenceImages!.length} attached reference image(s), generate a photograph with the following specifications:\n\n${prompt}`
        : prompt;

    const requestBody: Record<string, unknown> = {
        model: 'seedream-4-5-251128',
        prompt: finalPrompt,
        size,
        n,
        response_format: 'url',
        watermark: false,
    };

    if (hasRefs) {
        // SeedDream API requires parameter name "image" (not "image_urls")
        // Ensure mime type in data URI is lowercase (API requirement)
        const normalizedRefs = referenceImages.map(img =>
            img.replace(/^data:image\/(\w+);/, (_, fmt) => `data:image/${fmt.toLowerCase()};`)
        );
        // Single image: string, multiple: string[]
        requestBody.image = normalizedRefs.length === 1 ? normalizedRefs[0] : normalizedRefs;
    }

    const jsonBody = JSON.stringify(requestBody);
    console.log(`[SeedDream] Request body size: ${(jsonBody.length / 1024).toFixed(1)}KB`);

    try {
        const response = await tauriFetch('https://ark.ap-southeast.bytepluses.com/api/v3/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: jsonBody,
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error('[SeedDream] API Error (full):', errBody);
            console.error('[SeedDream] Status:', response.status, response.statusText);
            console.error('[SeedDream] Request size:', size, '| Model: seedream-4-5-251128');
            throw new Error(`SeedDream API 오류 (${response.status}): ${errBody.slice(0, 500)}`);
        }

        const data = await response.json();
        console.log('[SeedDream] Response data keys:', Object.keys(data));
        console.log('[SeedDream] data.data count:', data.data?.length ?? 0);

        if (!data.data || data.data.length === 0) {
            console.error('[SeedDream] Empty response:', JSON.stringify(data).slice(0, 500));
            throw new Error('SeedDream에서 이미지를 생성하지 못했습니다.');
        }

        return data.data
            .map((item: { b64_json?: string; url?: string }) => {
                if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
                if (item.url) return item.url;
                console.warn('[SeedDream] Item has no b64_json or url:', Object.keys(item));
                return null;
            })
            .filter(Boolean) as string[];
    } catch (err) {
        console.error('[SeedDream] Fetch error:', err);
        throw err;
    }
}
