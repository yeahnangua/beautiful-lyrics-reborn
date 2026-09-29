import type { Lyrics as ProviderLyrics } from "@Universal/Types/Lyrics.ts"
import { franc } from "npm:franc@^6.2.0"
export type { ProviderLyrics }

export type TransformedLyrics = ProviderLyrics & {
	NaturalAlignment: "Right" | "Left";
	Language: string;
}
const RightToLeftLanguages = ["pes", "urd", "arb", "uig", "heb", "ydd", "men"]
const MinimumInterludeDuration = 2
const EndInterludeEarlyBy = 0.25

export const TransformProviderLyrics = async (providerLyrics: ProviderLyrics): Promise<TransformedLyrics> => {
	const lyrics = structuredClone(providerLyrics) as TransformedLyrics
	const texts = lyrics.Type === "Static" ? lyrics.Lines.map(line => line.Text)
		: lyrics.Content.flatMap(group => group.Type !== "Vocal" ? []
			: "Text" in group ? [group.Text]
			: [group.Lead.Syllables.map((word, index, words) =>
				`${index > 0 && !words[index - 1].IsPartOfWord ? " " : ""}${word.Text}`).join("")])
	lyrics.Language = franc(texts.join("\n"))
	lyrics.NaturalAlignment = RightToLeftLanguages.includes(lyrics.Language) ? "Right" : "Left"
	if (lyrics.Type === "Static") return lyrics

	// Rebuild generated interludes without mutating provider data or duplicating cached gaps.
	const content = lyrics.Content.filter(group => group.Type === "Vocal")
	let previousEnd = 0
	const withInterludes: (typeof lyrics.Content[number])[] = []
	for (const group of content) {
		const vocals = "Lead" in group ? [group.Lead, ...(group.Background ?? [])] : [group]
		const start = Math.min(...vocals.map(vocal => vocal.StartTime))
		const end = Math.max(...vocals.map(vocal => vocal.EndTime))
		if (start - previousEnd >= MinimumInterludeDuration) {
			withInterludes.push({ Type: "Interlude", StartTime: previousEnd, EndTime: start - EndInterludeEarlyBy })
		}
		withInterludes.push(group)
		previousEnd = Math.max(previousEnd, end)
	}
	lyrics.Content = withInterludes as typeof lyrics.Content
	return lyrics
}
