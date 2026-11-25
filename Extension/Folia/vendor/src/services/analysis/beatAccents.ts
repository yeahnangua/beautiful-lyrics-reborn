export interface BeatAccents {
    v: number;
    /** One entry per beat of the grid, in the grid's order. */
    impact: number[];
    low: number[];
    mid: number[];
    high: number[];
    /** 1 when the beat's bar has rhythm, 0 when it is sustained sound only (no beat FX there). */
    rhythmic: number[];
    /** 1 when the beat is a felt beat, 0 for one the model counted between them (see above). */
    pulse: number[];
    trackScale: number;
}
interface BandTracks {
    low: Float32Array;
    mid: Float32Array;
    high: Float32Array;
    /** Mean log-mel over every band. */
    all: Float32Array;
}
export interface BeatMeter {
    /** Beats per minute as the model counted them (median spacing). */
    bpm: number;
    /** [beats in the bar, how many such bars], most common first. */
    barLengths: [number, number][];
    /** The most common bar length, 0 without two downbeats. */
    usual: number;
    /** Mean rise of each position of the usual bar. */
    byPosition: number[];
    /** Median beat logit of each position of the usual bar; empty without the logits. */
    confidenceByPosition: number[];
    /** Beats per felt beat: 3 in compound time or a waltz felt by the bar, 2 for a track counted at twice its tempo, else 1. */
    group: number;
    /** Beats left silent as the model was unsure of them (resolveUnsureBeats). */
    unsure: number;
    /** Beats put back where a drum-driven track runs at its counted tempo (restoreDrivenBeats). */
    driven: number;
}
interface Rise {
    low: number;
    mid: number;
    high: number;
    raw: number;
    loudness: number;
}