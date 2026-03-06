// Settings service — API 키 저장/로드 (localStorage 기반)

export type Provider = 'gemini' | 'openai' | 'seedream';
export type Quality = 'standard' | '2k' | '4k';

const STORAGE_KEY = 'lumina-studio-settings';

export interface AppSettings {
    apiKeys: Record<Provider, string>;
    defaultProvider: Provider;
    defaultQuality: Quality;
    defaultAspectRatio: string;
    outputFolder: string;
    autoSave: boolean;
}

const DEFAULTS: AppSettings = {
    apiKeys: { gemini: '', openai: '', seedream: '' },
    defaultProvider: 'gemini',
    defaultQuality: 'standard',
    defaultAspectRatio: '3:2',
    outputFolder: '',
    autoSave: true,
};

export function loadSettings(): AppSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULTS };
        const saved = JSON.parse(raw);
        return { ...DEFAULTS, ...saved, apiKeys: { ...DEFAULTS.apiKeys, ...saved.apiKeys } };
    } catch {
        return { ...DEFAULTS };
    }
}

export function saveSettings(settings: AppSettings): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getApiKey(provider: Provider): string {
    return loadSettings().apiKeys[provider] || '';
}
