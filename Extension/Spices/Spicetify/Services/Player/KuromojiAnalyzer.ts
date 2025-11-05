// Type Imports
import type KuromojiType from "npm:@types/kuromoji@^0.1.3"
import type { Tokenizer, IpadicFeatures } from "npm:@types/kuromoji@^0.1.3"

// Language Module
import ImportedKuromoji from "./Kuromoji.js"
const Kuromoji = (ImportedKuromoji as unknown as typeof KuromojiType)

// Export our Kuromoji Analyzer (required format so we can be passed into Kuroshiro)
let Analyzer: (Tokenizer<IpadicFeatures> | undefined)
export const init = (): Promise<void> => {
	if (Analyzer !== undefined) {
		return Promise.resolve()
	}

	return new Promise(
		(resolve, reject) => {
			Kuromoji.builder(
				{
					dicPath: "https://kuromoji.socalifornian.live"
				}
			).build(
				(error, analyzer) => {
					if (error) {
						return reject(error)
					}

					Analyzer = analyzer
					resolve()
				}
			)
		}
	)
}
export const parse = (text = ""): Promise<IpadicFeatures[]> => {
	if ((text.trim() === "") || (Analyzer === undefined)) {
		return Promise.resolve([])
	}

	// deno-lint-ignore no-explicit-any
	const result = Analyzer.tokenize(text) as any[]
	for(const token of result) {
		token.verbose = {
			word_id: token.word_id,
			word_type: token.word_type,
			word_position: token.word_position
		}
		delete token.word_id
		delete token.word_type
		delete token.word_position
	}

	return Promise.resolve(result)
}