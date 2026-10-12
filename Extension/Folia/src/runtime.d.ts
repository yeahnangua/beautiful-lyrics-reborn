import type { FoliaHandle, PlayerSnapshot, FoliaActions } from './contracts.ts';

// The Deno host consumes the compiled module through this stable declaration.
export function mountFolia(host: HTMLElement, snapshot: PlayerSnapshot, actions: FoliaActions, language?: string): FoliaHandle;
