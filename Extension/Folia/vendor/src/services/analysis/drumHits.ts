// Reborn has no access to separated Spotify audio.
export const DRUM_KICK = 1, DRUM_SNARE = 2, DRUM_HAT = 4;
export interface DrumHits {
    times: Float64Array;
    strengths: Float32Array;
    kinds: Uint8Array;
    /** While the track is still separating: the time (s) the hits reach, none after it known yet. */
    until?: number;
}
export const getDrumHits = (_key: string | null): DrumHits | null => null;
