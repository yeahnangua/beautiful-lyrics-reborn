// The host passes discrete snapshots and actions; precise clocks stay in the mounted React root.
export interface LyricWord { text: string; startTime: number; endTime: number; syllables?: { text: string; startTime: number; endTime: number }[] }
export interface BackgroundVocal { text: string; startTime: number; endTime: number; words: LyricWord[]; agentId?: string }
export interface LyricLine {
  id?: string; agentId?: string; fullText: string; startTime: number; endTime: number; words: LyricWord[];
  backgroundVocal?: BackgroundVocal; backgroundVocals?: BackgroundVocal[];
}
export type LyricsState = {
  status: 'loading' | 'missing' | 'instrumental' | 'static' | 'synced';
  lines: LyricLine[];
  staticLines: string[];
  direction: 'ltr' | 'rtl';
};
export type AudioFrame = { power: number; bass: number; lowMid: number; mid: number; vocal: number; treble: number };
export interface PlayerSnapshot {
  key: string;
  title: string;
  artist: string;
  album: string;
  coverUrl: string;
  duration: number;
  playing: boolean;
  shuffle: boolean;
  loop: 'off' | 'all' | 'one';
  liked: boolean;
  volume: number;
  canSeek: boolean;
  canLike: boolean;
  canPlaylist: boolean;
  canFeedback: boolean;
  fullscreen: boolean;
  audioStatus: 'loading' | 'available' | 'unavailable';
  lyrics: LyricsState;
}
export interface LibraryItem { type: 'folder' | 'playlist'; uri: string; name: string; cover?: string }
export interface FoliaActions {
  metric?(kind: string, fields: Record<string, unknown>): void;
  close(): void;
  toggleFullscreen(): void;
  prev(): void;
  next(): void;
  togglePlay(): void;
  seek(time: number): void;
  setVolume(volume: number): void;
  toggleShuffle(): void;
  toggleLoop(): void;
  toggleLike(): void;
  feedback(): void;
  offset(): number;
  adjustOffset(delta: number): void;
  resetOffset(): void;
  listFolder(uri: string, filter: string): Promise<LibraryItem[]>;
  playlistDetails(uri: string): Promise<LibraryItem>;
  addToPlaylist(uri: string, capturedTrack: string): Promise<void>;
  createLibraryItem(type: 'folder' | 'playlist', name: string, parent: string): Promise<void>;
}
export interface FoliaHandle {
  update(snapshot: PlayerSnapshot): void;
  step(time: number, offset: number, audio: AudioFrame): void;
  closePanel(): boolean;
  destroy(): void;
}
