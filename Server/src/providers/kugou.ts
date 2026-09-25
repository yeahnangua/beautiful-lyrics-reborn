// Adapted from lrcmux/internal/providers/kugou/provider.go (MIT).
// Copyright © 2026 f1nniboy. See NOTICE.md and LICENSES/lrcmux-MIT.txt.
// Changed 2026-09-19: HTTPS, native fetch, strict matching, bounded requests,
// and multiple candidates when a matching lyric file is unavailable.
import OpenCC from "opencc-js";
import { convertKrcToSyllableLyrics, decodeKrc } from "../convert/krc";
import { withLyricRequestRetries } from "./request";
import { withMatchedTitle } from "./matched-title";
import type { SyllableLyricsProvider, TrackMetadata } from "../types";

type Candidate = {
  id: string;
  accesskey: string;
  song: string;
  singer: string;
  duration?: number;
  score?: number;
  product_from?: string;
};

const simplify = OpenCC.Converter({ from: "tw", to: "cn" });
const headers = { Accept: "application/json", "User-Agent": "Mozilla/5.0" };

function normalize(text: string): string {
  return simplify(text).normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}

function matches(value: unknown, track: TrackMetadata): value is Candidate {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Candidate>;
  if (typeof candidate.id !== "string" || !candidate.id.trim() ||
    typeof candidate.accesskey !== "string" || !candidate.accesskey.trim() ||
    typeof candidate.song !== "string" || typeof candidate.singer !== "string" ||
    candidate.product_from === "ugc" || normalize(candidate.song) !== normalize(track.name)) {
    return false;
  }
  const artists = [candidate.singer, ...candidate.singer.split(/[、,，;；&/＋+]/)].map(normalize).filter(Boolean);
  if (!track.artists.some((artist) => artists.includes(normalize(artist)))) {
    return false;
  }
  return track.durationSeconds === undefined || candidate.duration === undefined ||
    (Number.isFinite(candidate.duration) && candidate.duration > 0 &&
      Math.abs(candidate.duration / 1000 - track.durationSeconds) <= 8);
}

export function createKugouProvider(fetchImpl: typeof fetch = fetch): SyllableLyricsProvider {
  async function getJson<T>(url: URL, signal: AbortSignal): Promise<T | undefined> {
    const response = await fetchImpl(url.toString(), { headers, signal });
    return response.ok ? await response.json() as T : undefined;
  }

  return {
    async getSyllableLyrics(track) {
      if (!track.name.trim() || !track.artists[0]?.trim()) {
        return undefined;
      }
      return withLyricRequestRetries(async (signal) => {
        const searchUrl = new URL("https://krcs.kugou.com/search");
        searchUrl.search = new URLSearchParams({
          ver: "1", man: "yes", client: "mobi",
          keyword: simplify(`${track.artists[0]} - ${track.name}`),
          hash: "", album_audio_id: "",
          duration: String(Math.round((track.durationSeconds ?? 0) * 1000))
        }).toString();
        const search = await getJson<{ status?: number; candidates?: unknown[] }>(searchUrl, signal);
        if (search?.status !== 200 || !Array.isArray(search.candidates)) {
          return undefined;
        }
        const candidates = search.candidates.filter((candidate): candidate is Candidate => matches(candidate, track));
        const difference = (candidate: Candidate): number => track.durationSeconds === undefined
          ? 0 : Math.abs((candidate.duration ?? Infinity) / 1000 - track.durationSeconds);
        candidates.sort((a, b) => difference(a) - difference(b) || (b.score ?? 0) - (a.score ?? 0));
        for (const candidate of candidates.slice(0, 3)) {
          const lyricUrl = new URL("https://lyrics.kugou.com/download");
          lyricUrl.search = new URLSearchParams({
            ver: "1", client: "pc", id: candidate.id, accesskey: candidate.accesskey,
            fmt: "krc", charset: "utf8"
          }).toString();
          const payload = await getJson<{ status?: number; content?: string }>(lyricUrl, signal);
          if (payload?.status !== 200) {
            continue;
          }
          const lyrics = convertKrcToSyllableLyrics(await decodeKrc(payload.content));
          if (lyrics !== undefined) {
            return withMatchedTitle(lyrics, candidate.song);
          }
        }
        return undefined;
      }, "kugou direct");
    }
  };
}

export const kugouProvider = createKugouProvider();
