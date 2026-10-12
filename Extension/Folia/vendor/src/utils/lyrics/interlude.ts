import type { Line } from '../../types';

// Reborn adapter: retain Folia's interlude predicate without importing a lyrics parser.
export const isInterludeLine = (line: Pick<Line, 'fullText'>): boolean => line.fullText === '♪';
