import { BUILTIN_VISUALIZER_MODES, BUILTIN_VISUALIZER_BACKGROUND_MODES } from '../vendor/src/types/visualizerModes';

// Only Reborn-owned preferences are persisted; Folia application settings are never read.
export interface Settings { mode: string; background: string; fontScale: number; showLyrics: boolean; showSubtitles: boolean }
export const SETTINGS_KEY = 'BeautifulLyrics/FoliaFullscreen/v1';
export const DEFAULT_SETTINGS: Settings = { mode: 'classic', background: 'latent', fontScale: 1, showLyrics: true, showSubtitles: false };
export function validateSettings(value: unknown): Settings {
  const saved = value && typeof value === 'object' ? value as Partial<Settings> : {};
  return {
    mode: BUILTIN_VISUALIZER_MODES.includes(saved.mode as never) ? saved.mode! : DEFAULT_SETTINGS.mode,
    background: BUILTIN_VISUALIZER_BACKGROUND_MODES.includes(saved.background as never) ? saved.background! : DEFAULT_SETTINGS.background,
    fontScale: typeof saved.fontScale === 'number' && Number.isFinite(saved.fontScale) ? Math.max(0.5, Math.min(2, saved.fontScale)) : 1,
    showLyrics: typeof saved.showLyrics === 'boolean' ? saved.showLyrics : true,
    showSubtitles: typeof saved.showSubtitles === 'boolean' ? saved.showSubtitles : DEFAULT_SETTINGS.showSubtitles,
  };
}
export function loadSettings(): Settings {
  try { return validateSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')); } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(settings: Settings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* A full/restricted storage still permits this session's settings. */ }
}
