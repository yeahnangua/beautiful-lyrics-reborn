// Spotify audio is not exposed to local inference.
export const isGpuAnalysisActive = (_kind?: number) => false;
