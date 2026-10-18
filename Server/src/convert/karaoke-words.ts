import type { SyllableMetadata } from "../types";

type TimedText = Omit<SyllableMetadata, "IsPartOfWord">;

// Spaces and punctuation can have zero duration in karaoke formats. Keep their
// text until word boundaries are established, without inventing highlight times.
export function convertKaraokeWords(words: TimedText[]): SyllableMetadata[] {
  const validWords = words.filter((word) => word.Text.length > 0 &&
    Number.isFinite(word.StartTime) && Number.isFinite(word.EndTime) && word.EndTime >= word.StartTime);
  const ends = new Map<TimedText, number>();
  let nextStart: number | undefined;
  for (let index = validWords.length - 1; index >= 0; index -= 1) {
    const word = validWords[index]!;
    if (word.EndTime === word.StartTime) continue;
    ends.set(word, nextStart !== undefined && nextStart > word.StartTime
      ? Math.min(word.EndTime, nextStart) : word.EndTime);
    nextStart = word.StartTime;
  }

  const timedTexts: TimedText[] = [];
  let pending = "";
  for (const word of validWords) {
    if (word.EndTime > word.StartTime && word.Text.trim().length > 0) {
      const previous = timedTexts[timedTexts.length - 1];
      if (previous) {
        // Attach a suffix before the space to the previous syllable, and an
        // opening mark after the space to the next one (e.g. `hello, (world)`).
        const separator = /\s+(?=\S*$)/.exec(pending);
        if (separator) {
          const boundary = separator.index + separator[0].length;
          previous.Text += pending.slice(0, boundary);
          pending = pending.slice(boundary);
        } else if (!/\s$/.test(previous.Text)) {
          previous.Text += pending;
          pending = "";
        }
      }
      timedTexts.push({
        Text: pending + word.Text,
        StartTime: word.StartTime,
        EndTime: ends.get(word)!
      });
      pending = "";
    } else {
      pending += word.Text;
    }
  }
  const last = timedTexts[timedTexts.length - 1];
  if (last) last.Text += pending;

  return timedTexts.map((word, index) => {
    const next = timedTexts[index + 1];
    return {
      ...word,
      Text: word.Text.trim(),
      IsPartOfWord: next !== undefined && !/\s$/.test(word.Text) && !/^\s/.test(next.Text)
    };
  });
}
