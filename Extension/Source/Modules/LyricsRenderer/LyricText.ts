import { attributionParts } from "@Universal/Modules/LyricsAttribution.ts"
import type { SpicyAttribution } from "@Universal/Types/Lyrics.ts"

/** Build inline credits inside a normal lyric span, without injecting HTML. */
export function SetLyricText(span: HTMLElement, text: string, attribution?: SpicyAttribution) {
	if (!attribution) { span.innerText = text; return }
	for (const part of attributionParts(attribution)) {
		if (!part.href) { span.appendChild(document.createTextNode(part.text)); continue }
		const link = document.createElement("a")
		link.textContent = part.text
		link.href = part.href
		link.target = "_blank"
		link.rel = "noopener noreferrer"
		// Opening a contributor must not seek the enclosing lyric line.
		link.addEventListener("click", event => event.stopPropagation())
		span.appendChild(link)
	}
}
