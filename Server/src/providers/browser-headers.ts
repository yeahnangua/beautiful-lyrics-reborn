import { UserAgent } from "../../../Universal/Modules/Http";

/** Browser-compatible headers for the public Better Lyrics and Unison APIs. */
export const browserLyricsHeaders = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0",
  "X-User-Agent": UserAgent,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,en-US;q=0.9,en;q=0.8",
  DNT: "1",
  "Sec-GPC": "1",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  Priority: "u=0, i"
} as const;

// Host, connection headers and compression are negotiated by the fetch runtime.
