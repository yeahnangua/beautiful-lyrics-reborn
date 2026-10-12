// Reborn adapter: custom image storage is outside this integration.
export interface StoredTemperaLayerImage { id: string; name: string; mimeType: string; blob: Blob; thumbnail?: Blob; }
export const loadTemperaLayerImageBlobs = async (_images: unknown[]): Promise<Map<string, Blob>> => new Map();
