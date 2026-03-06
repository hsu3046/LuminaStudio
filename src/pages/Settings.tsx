import { useState } from 'react';
import { Key, Eye, EyeOff, Check, Save, FolderOpen, HardDriveDownload } from 'lucide-react';
import { loadSettings, saveSettings, type AppSettings, type Provider } from '../services/settings';
import { isTauri } from '../utils/platform';

const PROVIDER_INFO: { id: Provider; label: string; placeholder: string; docsUrl: string }[] = [
    { id: 'gemini', label: 'Google Gemini', placeholder: 'AIzaSy...', docsUrl: 'https://aistudio.google.com/apikey' },
    { id: 'openai', label: 'OpenAI', placeholder: 'sk-...', docsUrl: 'https://platform.openai.com/api-keys' },
    { id: 'seedream', label: 'SeedDream (BytePlus)', placeholder: 'Bearer ...', docsUrl: 'https://console.byteplus.com/' },
];

export default function Settings() {
    const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
    const [showKeys, setShowKeys] = useState<Record<Provider, boolean>>({
        gemini: false, openai: false, seedream: false,
    });
    const [saved, setSaved] = useState(false);

    const updateKey = (provider: Provider, value: string) => {
        setSettings(prev => ({
            ...prev,
            apiKeys: { ...prev.apiKeys, [provider]: value },
        }));
        setSaved(false);
    };

    const handleSave = () => {
        saveSettings(settings);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const toggleShow = (provider: Provider) => {
        setShowKeys(prev => ({ ...prev, [provider]: !prev[provider] }));
    };

    // 자동 저장 폴더 선택
    const handleSelectFolder = async () => {
        if (!isTauri()) return;
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
            directory: true,
            multiple: false,
            title: '자동 저장 폴더 선택',
        });
        if (selected) {
            setSettings(prev => ({ ...prev, outputFolder: selected as string }));
            setSaved(false);
        }
    };

    // 폴더명만 표시 (긴 경로 축약)
    const displayFolder = settings.outputFolder
        ? (settings.outputFolder.length > 40
            ? '...' + settings.outputFolder.slice(-37)
            : settings.outputFolder)
        : '폴더를 선택해주세요';

    return (
        <div className="settings-page">
            <div className="settings-container">
                <div className="settings-header">
                    <h2><Key size={20} /> API Keys</h2>
                    <p className="settings-desc">
                        이미지 생성에 필요한 API 키를 설정합니다. 키는 이 기기에만 로컬 저장됩니다.
                    </p>
                </div>

                <div className="settings-keys">
                    {PROVIDER_INFO.map(p => (
                        <div key={p.id} className="settings-key-row">
                            <div className="settings-key-header">
                                <label className="settings-key-label">{p.label}</label>
                                <a className="settings-key-link" href={p.docsUrl} target="_blank" rel="noopener">
                                    키 발급 →
                                </a>
                            </div>
                            <div className="settings-key-input-wrap">
                                <input
                                    type={showKeys[p.id] ? 'text' : 'password'}
                                    className="settings-key-input"
                                    value={settings.apiKeys[p.id]}
                                    onChange={e => updateKey(p.id, e.target.value)}
                                    placeholder={p.placeholder}
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                                <button className="settings-key-toggle" onClick={() => toggleShow(p.id)}>
                                    {showKeys[p.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                            </div>
                            {settings.apiKeys[p.id] && (
                                <div className="settings-key-status ok">
                                    <Check size={12} /> 키가 입력됨
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* 이미지 저장 설정 (Tauri only) */}
                {isTauri() && (
                    <>
                        <div className="settings-divider" />
                        <div className="settings-header">
                            <h2><HardDriveDownload size={20} /> 이미지 저장</h2>
                            <p className="settings-desc">
                                이미지 생성 완료 시 자동으로 지정 폴더에 저장합니다.
                            </p>
                        </div>

                        <div className="settings-autosave">
                            <div className="settings-autosave-toggle">
                                <span className="settings-autosave-label">자동 저장</span>
                                <button
                                    className={`settings-toggle-btn ${settings.autoSave ? 'on' : ''}`}
                                    onClick={() => {
                                        setSettings(prev => ({ ...prev, autoSave: !prev.autoSave }));
                                        setSaved(false);
                                    }}
                                    role="switch"
                                    aria-checked={settings.autoSave}
                                >
                                    <span className="settings-toggle-knob" />
                                </button>
                            </div>

                            <div className={`settings-folder-row ${!settings.autoSave ? 'disabled' : ''}`}>
                                <div className="settings-folder-path" title={settings.outputFolder || undefined}>
                                    <FolderOpen size={14} strokeWidth={1.5} />
                                    <span>{displayFolder}</span>
                                </div>
                                <button
                                    className="settings-folder-btn"
                                    onClick={handleSelectFolder}
                                    disabled={!settings.autoSave}
                                >
                                    폴더 변경
                                </button>
                            </div>
                        </div>
                    </>
                )}

                <div className="settings-actions">
                    <button className="settings-save-btn" onClick={handleSave}>
                        {saved ? <><Check size={14} /> 저장됨</> : <><Save size={14} /> 설정 저장</>}
                    </button>
                </div>
            </div>
        </div>
    );
}
