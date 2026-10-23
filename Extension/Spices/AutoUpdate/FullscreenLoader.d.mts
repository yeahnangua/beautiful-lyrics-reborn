import type { FoliaActions, FoliaHandle, PlayerSnapshot } from '../../Folia/src/contracts.ts';

export function createFullscreenLoader(
  release: { api: number; sha256: string; file: string },
  runtime?: typeof globalThis,
): (signal: AbortSignal) => Promise<{
  mountFolia(host: HTMLElement, snapshot: PlayerSnapshot, actions: FoliaActions, language?: string): FoliaHandle;
  source: 'network' | 'cache' | 'memory';
}>;
