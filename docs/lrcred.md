# lrc.red integration

The Worker reads [lrc.red's public API](https://lrc.red/api) directly. No API key is required.

Every search and lyrics request sends this identity, using the contact selected by the maintainer:

```text
User-Agent: beautiful-lyrics-reborn (https://github.com/yeahnangua/beautiful-lyrics-reborn; mailto:1135746060@qq.com)
```

When Spotify metadata includes a valid ISRC, the provider first requests `/s/{isrc}.ttml`.
The extension shares a song-ID-keyed metadata lookup between the details view and
both foreground and prefetched lyric requests. Cached metadata requires no extra
network request. ISRC resolution runs alongside the Apple Music lookup with a
1.5-second caller budget; unavailable or invalid ISRCs fall back to normal search.
The shared lookup has its own eight-second lifetime, so one cancelled or timed-out
lyric waiter does not cancel another consumer. Late results cannot update a newer
lookup, and a slow or failed cache write does not delay the returned metadata.

Otherwise, or when that recording is unavailable, it searches `/search.json?q={title artist}`.
Search candidates must match the normalized title and an expected artist. Full artist
names remain eligible, including names such as AC/DC; collaboration credits also
match complete names separated by punctuation or feat/ft/with markers. Substring
matches are not accepted. When the
Spotify duration is available, the candidate must supply a duration within eight seconds.
EP/album/single version and remaster labels can be normalized; live, acoustic, remix,
and other different versions remain distinct. Matching albums rank ahead of compilations.
At most three matching ISRCs are tried, preferring actual word timing over line/plain data.

TTML parsing retains spaces between words, joins syllables within a word, decodes XML
entities, and preserves backing vocals and alternate singer alignment. Line timing stays
`Line`, and explicitly unsynced TTML stays `Static`. Malformed XML is rejected without
printing lyric text. The provider participates in the normal syllable race; any line/plain
result is reused in later fallback stages without repeating the lrc.red request.

Results use `Source.Provider: "lrc.red"`, `Source.Transport: "direct"`, and the recording's
ISRC as `Source.TrackId`. Source policy, feedback, metrics, and the query-log Message
column use the same provider label.

The existing attribution pipeline appends one `Lyrics via lrc.red` credit row. Card/page
views link `lrc.red` to `https://lrc.red`; Folia's shared controls retain the same link even
when its lyric stream already contains the credit row. Spicy Lyrics community contributor
credits keep their original behavior. A rebuilt main extension and fullscreen payload are
required for the clickable provider link.

Requests retain the service's cancellation/deadline bounds. HTTP 429/503 ends the current
lookup and suppresses further lrc.red queries in that Worker instance until `Retry-After`.
Missing, blank, malformed, negative, or numerically overflowing delays use five seconds.
Valid numeric delays and HTTP dates have a one-second minimum without a five-minute
maximum; fractional numeric delays are tolerated, and asctime HTTP dates use UTC.
An overlapping request cannot shorten an already active cooldown.
This is an instance-local cooldown, not a distributed rate limiter. No upload, synchronization,
or submission endpoint is called.

Validation covered title/version/duration matching, direct ISRC lookup, word spacing,
background vocals, line/static fallbacks, invalid responses, cancellation, throttling,
source blocking, diagnostics, credit rendering, and real API samples. NetEase fetching,
LRCLIB parsing, and the disabled Paxsenix paths are outside this change.

Published on 2026-11-10 as Worker version `2e40e21d-247f-4680-a79e-5af81cb58318`.
The main extension hash starts with `834bdbddab9663e5`, and its fullscreen runtime
starts with `4eb25c024df23b39`. The published payload hashes and both update pointers
were verified. Validation passed 461 server tests, 91 extension tests, two browser
attribution tests, and server/extension/Folia type checks. Post-deployment diagnostics
confirmed successful lrc.red syllable results being selected for real requests.
