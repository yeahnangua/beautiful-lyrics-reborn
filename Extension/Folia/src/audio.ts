import type { AudioFrame } from './contracts.ts';

// Spotify's track analysis supplies envelope/beat proxies, not a real-time FFT.
type Segment = { start: number; duration: number; loudness_start: number; loudness_max: number; loudness_max_time: number; loudness_end: number };
type Beat = { start: number; duration: number; confidence: number };
type Analysis = { segments: Segment[]; beats: Beat[] };
const cache = new Map<string, Analysis>();
export const SILENT_AUDIO: AudioFrame = { power: 0, bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 };
const clamp = (value: number, max = 1) => Math.min(max, Math.max(0, value));
function validate(value: unknown): Analysis | undefined {
  if (!value || typeof value !== 'object' || !('segments' in value) || !Array.isArray(value.segments)) return;
  const segments = value.segments.filter((s): s is Segment => s && ['start', 'duration', 'loudness_start', 'loudness_max', 'loudness_max_time'].every(key => Number.isFinite(s[key])) && s.start >= 0 && s.duration > 0)
    .map(s => ({ ...s, loudness_end: Number.isFinite(s.loudness_end) ? s.loudness_end : s.loudness_start })).sort((a, b) => a.start - b.start);
  const beats = 'beats' in value && Array.isArray(value.beats) ? value.beats.filter((b): b is Beat => b && Number.isFinite(b.start) && Number.isFinite(b.duration) && Number.isFinite(b.confidence) && b.start >= 0 && b.duration > 0).sort((a, b) => a.start - b.start) : [];
  return segments.length ? { segments, beats } : undefined;
}
function at<T extends { start: number; duration: number }>(items: T[], time: number): T | undefined {
  let low = 0, high = items.length;
  while (low < high) { const mid = (low + high) >>> 1; if (items[mid].start <= time) low = mid + 1; else high = mid; }
  const item = items[low - 1];
  return item && time < item.start + item.duration ? item : undefined;
}
export class TrackAnalysis {
  status: 'loading' | 'available' | 'unavailable' = 'unavailable';
  private revision = 0;
  private analysis?: Analysis;
  private cancel?: () => void;
  constructor(private readonly fetch: ((uri: string) => Promise<unknown>) | undefined, private readonly timeoutMs = 6500) {}
  async setSong(uri: string): Promise<void> {
    const revision = ++this.revision;
    this.cancel?.(); this.analysis = undefined; this.status = 'unavailable';
    if (!this.fetch || !uri.startsWith('spotify:track:')) return;
    const existing = cache.get(uri);
    if (existing) { cache.delete(uri); cache.set(uri, existing); this.analysis = existing; this.status = 'available'; return; }
    this.status = 'loading';
    const result = await new Promise<Analysis | undefined>(resolve => {
      let settled = false;
      const finish = (data?: Analysis) => { if (settled) return; settled = true; clearTimeout(timer); if (this.cancel === cancel) this.cancel = undefined; resolve(data); };
      const cancel = () => finish();
      const timer = setTimeout(cancel, this.timeoutMs);
      this.cancel = cancel;
      Promise.resolve().then(() => this.fetch!(uri)).then(value => finish(validate(value)), () => finish());
    });
    if (revision !== this.revision) return;
    this.analysis = result; this.status = result ? 'available' : 'unavailable';
    if (result) { cache.set(uri, result); while (cache.size > 8) cache.delete(cache.keys().next().value!); }
  }
  sample(time: number, playing: boolean): AudioFrame {
    if (!playing || !Number.isFinite(time) || !this.analysis) return SILENT_AUDIO;
    const segment = at(this.analysis.segments, time);
    if (!segment) return SILENT_AUDIO;
    const elapsed = time - segment.start, peak = clamp(segment.loudness_max_time, segment.duration);
    const loudness = elapsed < peak
      ? segment.loudness_start + (segment.loudness_max - segment.loudness_start) * elapsed / Math.max(peak, 0.001)
      : segment.loudness_max + (segment.loudness_end - segment.loudness_max) * (elapsed - peak) / Math.max(segment.duration - peak, 0.001);
    const power = clamp((loudness + 60) / 60) * 255;
    const beat = at(this.analysis.beats, time);
    const pulse = beat ? clamp(1 - (time - beat.start) / Math.min(0.18, beat.duration)) * clamp(beat.confidence) * 255 : 0;
    return { power, bass: Math.max(power, pulse), lowMid: power, mid: power, vocal: power, treble: power };
  }
  destroy(): void { ++this.revision; this.cancel?.(); this.analysis = undefined; this.status = 'unavailable'; }
}
