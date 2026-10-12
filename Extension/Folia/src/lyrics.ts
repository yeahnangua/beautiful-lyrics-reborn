import type { Lyrics, SyllableVocal, SyllableMetadata } from '../../../Universal/Types/Lyrics.ts';
import type { LyricLine as Line, LyricWord as Word, BackgroundVocal as LyricBackgroundVocal, LyricsState } from './contracts.ts';

// Convert Reborn's timed objects without guessing word boundaries or mutating provider data.
function wordsFor(syllables: SyllableMetadata[]): Word[] {
  const words: Word[] = [];
  syllables.forEach((syllable, index) => {
    const space = index > 0 && !syllables[index - 1].IsPartOfWord ? ' ' : '';
    words.push({ text: space + syllable.Text, startTime: syllable.StartTime, endTime: syllable.EndTime,
      syllables: [{ text: space + syllable.Text, startTime: syllable.StartTime, endTime: syllable.EndTime }] });
  });
  return words;
}
function backgroundFor(vocal: SyllableVocal, agentId: string): LyricBackgroundVocal {
  const words = wordsFor(vocal.Syllables);
  return { text: words.map(word => word.text).join(''), startTime: vocal.StartTime, endTime: vocal.EndTime, words, agentId };
}
export function convertLyrics(lyrics: (Lyrics & { NaturalAlignment?: string }) | undefined, loaded: boolean): LyricsState {
  const direction = lyrics?.NaturalAlignment === 'Right' ? 'rtl' : 'ltr';
  if (!loaded) return { status: 'loading', lines: [], staticLines: [], direction };
  if (!lyrics) return { status: 'missing', lines: [], staticLines: [], direction };
  if (lyrics.Type === 'Static') return { status: 'static', lines: [], staticLines: lyrics.Lines.map(line => line.Text), direction };
  const lines: Line[] = [];
  for (const [index, group] of lyrics.Content.entries()) {
    if (group.Type !== 'Vocal') continue;
    const agentId = group.OppositeAligned ? 'opposite' : 'lead';
    if ('Lead' in group) {
      const words = wordsFor(group.Lead.Syllables);
      const backgroundVocals = group.Background?.map((vocal, i) => backgroundFor(vocal, `${agentId}-background-${i}`));
      lines.push({ id: String(index), agentId, startTime: group.Lead.StartTime, endTime: group.Lead.EndTime,
        fullText: words.map(word => word.text).join(''), words, backgroundVocals, backgroundVocal: backgroundVocals?.[0] });
    } else {
      lines.push({ id: String(index), agentId, startTime: group.StartTime, endTime: group.EndTime,
        fullText: group.Text, words: [{ text: group.Text, startTime: group.StartTime, endTime: group.EndTime }] });
    }
  }
  // Keep overlapping lines intact and their stable order at identical start times.
  lines.sort((a, b) => a.startTime - b.startTime);
  return { status: lines.some(line => line.fullText.trim()) ? 'synced' : 'instrumental', lines, staticLines: [], direction };
}
export const lyricSeekTime = (time: number, offset: number, duration: number): number =>
  Math.max(0, Math.min(duration, time - offset));

export function activeLineIndex(lines: Line[], time: number): number {
  let low = 0, high = lines.length;
  while (low < high) { const mid = (low + high) >>> 1; if (lines[mid].startTime <= time) low = mid + 1; else high = mid; }
  // Overlapping vocals can have different end times. Prefer the latest active lead.
  for (let index = low - 1; index >= 0; index--) if (time < lines[index].endTime) return index;
  return -1;
}
