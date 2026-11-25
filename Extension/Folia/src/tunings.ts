import { getBackgroundTunings, getVisualizerTuningModes, getVisualizerTuning, type VisualizerTuningBundle } from '../vendor/src/components/visualizer/tuningRegistry';
import type { VisualizerTuningAdapter, BackgroundTuningDefinition } from '../vendor/src/components/visualizer/tuningDefinition';

export type TuningValues = Record<string, Record<string, unknown>>;
export const TUNINGS_KEY = 'BeautifulLyrics/FoliaFullscreen/tunings/v1';
const commonDefaults = { useCoverColorBg:true, opacity:1, disableGeometricBackground:false, disableVignette:false };
const commonRead = (value: unknown) => {
  const input = value && typeof value === 'object' ? value as Partial<typeof commonDefaults> : {};
  return { useCoverColorBg:typeof input.useCoverColorBg==='boolean'?input.useCoverColorBg:true,
    opacity:typeof input.opacity==='number'&&Number.isFinite(input.opacity)?Math.max(0,Math.min(1,input.opacity)):1,
    disableGeometricBackground:input.disableGeometricBackground===true,disableVignette:input.disableVignette===true };
};
const commonDefinition: BackgroundTuningDefinition<unknown> = {
  mode:'common',defaults:commonDefaults,settingsKey:'commonBackground',settingsSetterKey:'setCommonBackground',settingsResetterKey:'resetCommonBackground',
  storage:{key:'reborn-common-background',read:commonRead,merge:(held,patch)=>commonRead({...held as object,...patch})},
};
export const tuningDefinitions = () => [
  ...getVisualizerTuningModes().map(mode => ({ key: mode, definition: getVisualizerTuning(mode)! })),
  ...getBackgroundTunings().map(definition => ({ key: 'background:' + definition.mode, definition })),
  {key:'background:common',definition:commonDefinition},
];
type Definition = VisualizerTuningAdapter<unknown> | BackgroundTuningDefinition<unknown>;
export function readTuning(definition: Definition, value: unknown): Record<string, unknown> {
  try {
    const tuning = (definition.storage?.read(value && typeof value === 'object' ? value : {}) ?? definition.defaults) as Record<string, unknown>;
    // Artificial metronome effects are opt-in; missing Spotify analysis stays unavailable.
    if (definition.mode === 'machi' && (!value || typeof value !== 'object' || !Object.hasOwn(value, 'simulatedBeat'))) return { ...tuning, simulatedBeat: false };
    return tuning;
  }
  catch { return structuredClone(definition.defaults) as Record<string, unknown>; }
}
export function loadTunings(): TuningValues {
  let saved: TuningValues = {};
  try { saved = JSON.parse(localStorage.getItem(TUNINGS_KEY) ?? '{}') ?? {}; } catch { /* Use defaults. */ }
  return Object.fromEntries(tuningDefinitions().map(({ key, definition }) => [key, readTuning(definition, saved[key])]));
}
export function patchTuning(values: TuningValues, key: string, patch?: Record<string, unknown>): TuningValues {
  const definition = tuningDefinitions().find(item => item.key === key)?.definition;
  if (!definition) return values;
  const current = values[key] ?? readTuning(definition, undefined);
  const updated = patch === undefined ? readTuning(definition, undefined)
    : definition.storage?.merge(current, patch) ?? { ...current, ...patch };
  const next = { ...values, [key]: readTuning(definition, updated) };
  try { localStorage.setItem(TUNINGS_KEY, JSON.stringify(next)); } catch { /* Session preferences still work. */ }
  return next;
}
export const modeTunings = (values: TuningValues): VisualizerTuningBundle => Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith('background:')));
export const backgroundTunings = (values: TuningValues) => Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith('background:')).map(([key, tuning]) => [key.slice(11), key === 'background:common' ? tuning : { tuning }]));
