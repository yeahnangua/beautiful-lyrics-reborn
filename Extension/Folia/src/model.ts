import { motionValue } from 'framer-motion';
import type { PlayerSnapshot, AudioFrame } from './contracts';
import { activeLineIndex } from './lyrics';

// Only discrete snapshots, active-line changes and panel state notify React subscribers.
export class FoliaModel {
  readonly time = motionValue(0);
  readonly lyricTime = motionValue(0);
  readonly audioPower = motionValue(0);
  readonly audioBands = { bass: motionValue(0), lowMid: motionValue(0), mid: motionValue(0), vocal: motionValue(0), treble: motionValue(0) };
  readonly offset = motionValue(0);
  private listeners = new Set<() => void>();
  state: { player: PlayerSnapshot; index: number; panel: 'settings' | 'playlist' | null; failed: boolean };
  constructor(player: PlayerSnapshot) { this.state = { player, index: -1, panel: null, failed: false }; }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  change(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  update(player: PlayerSnapshot) {
    const changed = player.key !== this.state.player.key;
    this.change({ player, index: activeLineIndex(player.lyrics.lines, this.lyricTime.get()),
      ...(changed ? { panel: null, failed: false } : {}) });
  }
  step(time: number, offset: number, audio: AudioFrame) {
    this.time.set(time); this.offset.set(offset); this.lyricTime.set(time + offset);
    this.audioPower.set(audio.power);
    for (const band of Object.keys(this.audioBands) as (keyof typeof this.audioBands)[]) this.audioBands[band].set(audio[band]);
    const index = activeLineIndex(this.state.player.lyrics.lines, time + offset);
    if (index !== this.state.index) this.change({ index });
  }
  closePanel(): boolean {
    if (!this.state.panel) return false;
    this.change({ panel: null }); return true;
  }
  destroy() {
    this.listeners.clear();
    this.time.destroy(); this.lyricTime.destroy(); this.offset.destroy(); this.audioPower.destroy();
    Object.values(this.audioBands).forEach(value => value.destroy());
  }
}
