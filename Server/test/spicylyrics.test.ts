import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpicyLyricsProvider, setSpicyLyricsApiKey } from "../src/providers/spicylyrics";
import type { TrackMetadata } from "../src/types";

const track: TrackMetadata = { id: "1QV6tiMFM6fSOKOGLMHYYg", name: "Song", artists: ["Artist"] };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

function envelope(body: unknown): unknown {
  return { Body: body, Status: 200, Type: "object" };
}

const syllableBody = {
  Type: "Syllable",
  StartTime: 1,
  EndTime: 2,
  id: "upstream-id",
  source: "spicy_lyrics",
  SongWriters: ["Writer"],
  UploadAttribution: { Uploader: { id: "1", username: "up", url: "https://spicylyrics.org/uid/1" } },
  Content: [{
    Type: "Vocal",
    OppositeAligned: false,
    Lead: {
      StartTime: 1,
      EndTime: 2,
      Syllables: [
        { Text: "Hel", StartTime: 1, EndTime: 1.5, IsPartOfWord: true },
        { Text: "lo", StartTime: 1.5, EndTime: 2, IsPartOfWord: false }
      ]
    },
    Background: [{
      StartTime: 1,
      EndTime: 2,
      Syllables: [{ Text: "ah", StartTime: 1, EndTime: 2, IsPartOfWord: false }]
    }]
  }]
};

afterEach(() => setSpicyLyricsApiKey(undefined));

const expectedAttribution = {
  provider: "spicylyrics" as const,
  source: "spicy_lyrics",
  uploader: { id: "1", username: "up", url: "https://spicylyrics.org/uid/1" }
};

describe("Spicy Lyrics provider", () => {
  it("skips the request entirely when no key is configured", async () => {
    const fetchMock = vi.fn();
    expect(await createSpicyLyricsProvider(fetchMock as typeof fetch).getLyrics(track)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips the request when the track has no Spotify ID", async () => {
    setSpicyLyricsApiKey("sl_sk_test");
    const fetchMock = vi.fn();
    expect(await createSpicyLyricsProvider(fetchMock as typeof fetch).getLyrics({ id: "", name: "Song", artists: [] })).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requests the track by Spotify ID with a bearer key and rebuilds a clean syllable body", async () => {
    setSpicyLyricsApiKey("sl_sk_test");
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.spicylyrics.org");
      expect(url.pathname).toBe(`/v1/lyrics/${track.id}`);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sl_sk_test");
      return json(envelope(syllableBody));
    });
    const lyrics = await createSpicyLyricsProvider(fetchMock as typeof fetch).getLyrics(track);
    expect(lyrics).toMatchObject({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [{
        Type: "Vocal",
        Lead: {
          StartTime: 1,
          EndTime: 2,
          Syllables: [
            { Text: "Hel", StartTime: 1, EndTime: 1.5, IsPartOfWord: true },
            { Text: "lo", StartTime: 1.5, EndTime: 2, IsPartOfWord: false }
          ]
        },
        Background: [{
          Syllables: [{ Text: "ah", StartTime: 1, EndTime: 2, IsPartOfWord: false }]
        }]
      }],
      Attribution: expectedAttribution
    });
    // Upstream-only fields must not leak into the public payload.
    expect(lyrics).not.toHaveProperty("id");
    expect(lyrics).not.toHaveProperty("source");
    expect(lyrics).not.toHaveProperty("UploadAttribution");
    expect(lyrics?.Source).toEqual({ Provider: "spicylyrics", Transport: "direct", TrackId: track.id });
  });

  it("includes apple_music or spotify attribution without community links", async () => {
    setSpicyLyricsApiKey("sl_sk_test");
    const fetchMock = vi.fn().mockResolvedValue(json(envelope({
      Type: "Line",
      Content: [{ Type: "Vocal", Text: "Line", StartTime: 1, EndTime: 2, OppositeAligned: false }],
      source: "apple_music"
    })));
    const lyrics = await createSpicyLyricsProvider(fetchMock as typeof fetch).getLyrics(track);
    expect(lyrics?.Attribution).toEqual({ provider: "spicylyrics", source: "apple_music" });
  });

  it("converts a line-level body with attribution", async () => {
    setSpicyLyricsApiKey("sl_sk_test");
    const fetchMock = vi.fn().mockResolvedValue(json(envelope({
      Type: "Line",
      Content: [
        { Type: "Vocal", Text: "First line", StartTime: 1, EndTime: 2, OppositeAligned: false },
        { Type: "Vocal", Text: "Second line", StartTime: 2, EndTime: 3, OppositeAligned: true }
      ],
      source: "spicy_lyrics",
      UploadAttribution: { Uploader: { id: "10", username: "author", url: "https://spicylyrics.org/uid/10" } }
    })));
    const lyrics = await createSpicyLyricsProvider(fetchMock as typeof fetch).getLyrics(track);
    expect(lyrics).toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 3,
      Content: [
        { Type: "Vocal", Text: "First line", StartTime: 1, EndTime: 2, OppositeAligned: false },
        { Type: "Vocal", Text: "Second line", StartTime: 2, EndTime: 3, OppositeAligned: true }
      ],
      Attribution: {
        provider: "spicylyrics",
        source: "spicy_lyrics",
        uploader: { id: "10", username: "author", url: "https://spicylyrics.org/uid/10" }
      },
      Source: { Provider: "spicylyrics", Transport: "direct", TrackId: track.id }
    });
  });

  it("converts a static body with attribution", async () => {
    setSpicyLyricsApiKey("sl_sk_test");
    const fetchMock = vi.fn().mockResolvedValue(json(envelope({
      Type: "Static",
      Lines: [{ Text: "One" }, { Text: "Two" }],
      source: "spicy_lyrics",
      UploadAttribution: { Uploader: { id: "5", username: "user5", url: "https://spicylyrics.org/uid/5" } }
    })));
    const lyrics = await createSpicyLyricsProvider(fetchMock as typeof fetch).getLyrics(track);
    expect(lyrics).toEqual({
      Type: "Static",
      Lines: [{ Text: "One" }, { Text: "Two" }],
      Attribution: {
        provider: "spicylyrics",
        source: "spicy_lyrics",
        uploader: { id: "5", username: "user5", url: "https://spicylyrics.org/uid/5" }
      },
      Source: { Provider: "spicylyrics", Transport: "direct", TrackId: track.id }
    });
  });

  it.each([
    ["not found", new Response("{}", { status: 404 })],
    ["unauthorized", new Response("{}", { status: 401 })],
    ["rate limited", new Response("{}", { status: 429 })],
    ["missing body", json(envelope(undefined))],
    ["unknown type", json(envelope({ Type: "Unknown" }))],
    ["invalid JSON", new Response("not json", { status: 200 })]
  ])("returns undefined for %s", async (_label, response) => {
    setSpicyLyricsApiKey("sl_sk_test");
    const fetchMock = vi.fn().mockResolvedValue(response);
    expect(await createSpicyLyricsProvider(fetchMock as typeof fetch).getLyrics(track)).toBeUndefined();
  });

  it("drops malformed syllables instead of returning broken timing", async () => {
    setSpicyLyricsApiKey("sl_sk_test");
    const fetchMock = vi.fn().mockResolvedValue(json(envelope({
      Type: "Syllable",
      Content: [
        { Type: "Vocal", Lead: { Syllables: [{ Text: "", StartTime: 1, EndTime: 2 }, { Text: "Bad", StartTime: 2, EndTime: 1 }] } }
      ]
    })));
    expect(await createSpicyLyricsProvider(fetchMock as typeof fetch).getLyrics(track)).toBeUndefined();
  });
});
