// Platform detection utility
// Checks if running inside Tauri desktop app vs plain browser

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;
