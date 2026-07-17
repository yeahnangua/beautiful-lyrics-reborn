import { describe, expect, it, vi } from "vitest";
import worker, { createWorker } from "../src/index";
import { createLyricsService } from "../src/service";
import type { ProviderClients } from "../src/types";

function createProviders(): ProviderClients {
  return {
    /*
    amlldb: {
      getSyllableLyrics: vi.fn().mockResolvedValue(undefined)
    },
    */
    qqmusic: {
      getSyllableLyrics: vi.fn().mockResolvedValue(undefined)
    },
    spotify: {
      getLyrics: vi.fn().mockResolvedValue(undefined),
      getTrackMetadata: vi.fn().mockResolvedValue(undefined)
    },
    lyrically: {
      // getSyllableLyrics: vi.fn().mockResolvedValue(undefined),
      getKugouLyrics: vi.fn().mockResolvedValue(undefined),
      getLyrics: vi.fn().mockResolvedValue(undefined),
      getYouTubeLyrics: vi.fn().mockResolvedValue(undefined),
      getDeezerLyrics: vi.fn().mockResolvedValue(undefined),
      getGeniusLyrics: vi.fn().mockResolvedValue(undefined)
    },
    lrclib: {
      getLyrics: vi.fn().mockResolvedValue(undefined)
    }
  };
}

describe("lyrics service", () => {
  it("returns Spotify static lyrics when no metadata is available for fallbacks", async () => {
    const providers = createProviders();
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue({
      Type: "Static",
      Lines: [{ Text: "Spotify lyric" }]
    });

    const service = createLyricsService(providers);
    await expect(service.getLyrics("track", "token")).resolves.toEqual({
      Type: "Static",
      Lines: [{ Text: "Spotify lyric" }]
    });
    expect(providers.spotify.getTrackMetadata).toHaveBeenCalledWith("track", "token", undefined);
    expect(providers.lrclib.getLyrics).not.toHaveBeenCalled();
  });

  /*
  it("returns AMLLDB syllable lyrics before trying Spotify", async () => {
    const providers = createProviders();
    vi.mocked(providers.amlldb.getSyllableLyrics).mockResolvedValue({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "你",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });

    const service = createLyricsService(providers);
    await expect(service.getLyrics("track", "token")).resolves.toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "你",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
    expect(providers.spotify.getLyrics).not.toHaveBeenCalled();
  });
  */

  it("returns the first available syllable lyrics without waiting for slower syllable providers", async () => {
    const providers = createProviders();
    let resolveDeezer!: (lyrics: undefined) => void;
    vi.mocked(providers.lyrically.getDeezerLyrics).mockReturnValue(
      new Promise((resolve) => {
        resolveDeezer = resolve;
      })
    );
    const qqMusicLyrics = {
      Type: "Syllable" as const,
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal" as const,
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "你",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    };
    vi.mocked(providers.qqmusic.getSyllableLyrics).mockResolvedValue(qqMusicLyrics);

    const service = createLyricsService(providers);
    const request = service.getLyrics("track", "token", {
      id: "track",
      name: "Song",
      artists: ["Artist"]
    });

    await vi.waitFor(() => {
      expect(providers.qqmusic.getSyllableLyrics).toHaveBeenCalled();
      expect(providers.lyrically.getKugouLyrics).toHaveBeenCalledWith(
        {
          id: "track",
          name: "Song",
          artists: ["Artist"]
        },
        true
      );
      expect(providers.lyrically.getDeezerLyrics).toHaveBeenCalled();
    });
    await expect(request).resolves.toEqual(qqMusicLyrics);
    resolveDeezer(undefined);
  });

  it("prefers QQ Music syllable lyrics before Spotify line lyrics", async () => {
    const providers = createProviders();
    vi.mocked(providers.qqmusic.getSyllableLyrics).mockResolvedValue({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "你",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Spotify line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });

    const service = createLyricsService(providers);
    await expect(
      service.getLyrics("track", "token", {
        id: "track",
        name: "Song",
        artists: ["Artist"]
      })
    ).resolves.toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "你",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
    expect(providers.spotify.getLyrics).not.toHaveBeenCalled();
  });

  it("uses Lyrically Spotify proxy line lyrics when it wins the line race", async () => {
    const providers = createProviders();
    vi.mocked(providers.lyrically.getLyrics).mockResolvedValue({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Lyrically Spotify proxy line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Spotify line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });

    const service = createLyricsService(providers);
    await expect(
      service.getLyrics("track", "token", {
        id: "track",
        name: "Song",
        artists: ["Artist"]
      })
    ).resolves.toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Lyrically Spotify proxy line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });
    expect(providers.qqmusic.getSyllableLyrics).toHaveBeenCalledWith({
      id: "track",
      name: "Song",
      artists: ["Artist"]
    });
    // Musixmatch syllable lookup is disabled.
    expect(providers.lyrically.getLyrics).toHaveBeenCalledWith({
      id: "track",
      name: "Song",
      artists: ["Artist"]
    });
    expect(providers.spotify.getLyrics).toHaveBeenCalledWith("track", "token", undefined);
  });

  it("returns the first available line lyrics without waiting for slower line providers", async () => {
    const providers = createProviders();
    let resolveLyrically!: (lyrics: undefined) => void;
    vi.mocked(providers.lyrically.getLyrics).mockReturnValue(
      new Promise((resolve) => {
        resolveLyrically = resolve;
      })
    );
    const spotifyLyrics = {
      Type: "Line" as const,
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal" as const,
          Text: "Spotify line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    };
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue(spotifyLyrics);

    const service = createLyricsService(providers);
    const request = service.getLyrics("track", "token", {
      id: "track",
      name: "Song",
      artists: ["Artist"]
    });

    await vi.waitFor(() => {
      expect(providers.spotify.getLyrics).toHaveBeenCalled();
      expect(providers.lyrically.getYouTubeLyrics).toHaveBeenCalled();
      expect(providers.lyrically.getKugouLyrics).toHaveBeenCalledWith(
        {
          id: "track",
          name: "Song",
          artists: ["Artist"]
        },
        false
      );
      expect(providers.lrclib.getLyrics).toHaveBeenCalled();
    });
    await expect(request).resolves.toEqual(spotifyLyrics);
    resolveLyrically(undefined);
  });

  it("stops syllable lookups after 10 seconds and starts the line race", async () => {
    vi.useFakeTimers();
    try {
      const providers = createProviders();
      vi.mocked(providers.qqmusic.getSyllableLyrics).mockReturnValue(new Promise(() => {}));
      const spotifyLyrics = {
        Type: "Line" as const,
        StartTime: 1,
        EndTime: 2,
        Content: [
          {
            Type: "Vocal" as const,
            Text: "Spotify line",
            StartTime: 1,
            EndTime: 2,
            OppositeAligned: false
          }
        ]
      };
      vi.mocked(providers.spotify.getLyrics).mockResolvedValue(spotifyLyrics);

      const service = createLyricsService(providers);
      const request = service.getLyrics("track", "token", {
        id: "track",
        name: "Song",
        artists: ["Artist"]
      });

      await vi.advanceTimersByTimeAsync(9_999);
      expect(providers.spotify.getLyrics).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(providers.spotify.getLyrics).toHaveBeenCalled();
      await expect(request).resolves.toEqual(spotifyLyrics);
      expect(providers.qqmusic.getSyllableLyrics).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  /*
  it("prefers Lyrically syllable lyrics before Spotify line lyrics", async () => {
    const providers = createProviders();
    vi.mocked(providers.lyrically.getSyllableLyrics).mockResolvedValue({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "Hello",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Spotify line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });

    const service = createLyricsService(providers);
    await expect(
      service.getLyrics("track", "token", {
        id: "track",
        name: "Song",
        artists: ["Artist"]
      })
    ).resolves.toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "Hello",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
    expect(providers.spotify.getLyrics).not.toHaveBeenCalled();
  });
  */

  it("prefers Lyrically Deezer syllable lyrics before Lyrically Spotify proxy line lyrics", async () => {
    const providers = createProviders();
    vi.mocked(providers.lyrically.getLyrics).mockResolvedValue({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Lyrically Spotify proxy line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });
    vi.mocked(providers.lyrically.getDeezerLyrics).mockResolvedValue({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "Deezer",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });

    const service = createLyricsService(providers);
    await expect(
      service.getLyrics("track", "token", {
        id: "track",
        name: "Song",
        artists: ["Artist"]
      })
    ).resolves.toEqual({
      Type: "Syllable",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          OppositeAligned: false,
          Lead: {
            StartTime: 1,
            EndTime: 2,
            Syllables: [
              {
                Text: "Deezer",
                StartTime: 1,
                EndTime: 2,
                IsPartOfWord: false
              }
            ]
          }
        }
      ]
    });
    expect(providers.lyrically.getLyrics).not.toHaveBeenCalled();
    expect(providers.spotify.getLyrics).not.toHaveBeenCalled();
  });

  it("prefers Spotify line lyrics over LRCLIB line lyrics", async () => {
    const providers = createProviders();
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Spotify line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });

    const service = createLyricsService(providers);
    await expect(service.getLyrics("track", "token")).resolves.toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Spotify line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });
    expect(providers.spotify.getTrackMetadata).toHaveBeenCalledWith("track", "token", undefined);
    expect(providers.lrclib.getLyrics).not.toHaveBeenCalled();
  });

  it("uses direct Spotify line lyrics when Lyrically Spotify proxy misses", async () => {
    const providers = createProviders();
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Spotify line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });

    const service = createLyricsService(providers);
    await expect(service.getLyrics("track", "token")).resolves.toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Spotify line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });
    expect(providers.lyrically.getLyrics).toHaveBeenCalledWith({
      id: "track",
      name: "",
      artists: []
    });
    expect(providers.spotify.getLyrics).toHaveBeenCalledWith("track", "token", undefined);
  });

  it("uses Lyrically line lyrics when it wins the line race", async () => {
    const providers = createProviders();
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue(undefined);
    vi.mocked(providers.spotify.getTrackMetadata).mockResolvedValue({
      id: "track",
      name: "Song",
      artists: ["Artist"]
    });
    vi.mocked(providers.lyrically.getLyrics).mockResolvedValue({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Lyrically line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });
    vi.mocked(providers.lrclib.getLyrics).mockResolvedValue({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "LRCLIB line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });

    const service = createLyricsService(providers);
    await expect(service.getLyrics("track", "token")).resolves.toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "Lyrically line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });
    expect(providers.lrclib.getLyrics).toHaveBeenCalledWith({
      id: "track",
      name: "Song",
      artists: ["Artist"]
    });
  });

  it("prefers LRCLIB line lyrics over Spotify static lyrics", async () => {
    const providers = createProviders();
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue({
      Type: "Static",
      Lines: [{ Text: "Spotify static" }]
    });
    vi.mocked(providers.spotify.getTrackMetadata).mockResolvedValue({
      id: "track",
      name: "Song",
      artists: ["Artist"]
    });
    vi.mocked(providers.lrclib.getLyrics).mockResolvedValue({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "LRCLIB line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });

    const service = createLyricsService(providers);
    await expect(service.getLyrics("track", "token")).resolves.toEqual({
      Type: "Line",
      StartTime: 1,
      EndTime: 2,
      Content: [
        {
          Type: "Vocal",
          Text: "LRCLIB line",
          StartTime: 1,
          EndTime: 2,
          OppositeAligned: false
        }
      ]
    });
  });

  it("prefers Spotify static lyrics over LRCLIB static lyrics", async () => {
    const providers = createProviders();
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue({
      Type: "Static",
      Lines: [{ Text: "Spotify static" }]
    });
    vi.mocked(providers.spotify.getTrackMetadata).mockResolvedValue({
      id: "track",
      name: "Song",
      artists: ["Artist"]
    });
    vi.mocked(providers.lrclib.getLyrics).mockResolvedValue({
      Type: "Static",
      Lines: [{ Text: "LRCLIB static" }]
    });

    const service = createLyricsService(providers);
    await expect(service.getLyrics("track", "token")).resolves.toEqual({
      Type: "Static",
      Lines: [{ Text: "Spotify static" }]
    });
  });

  it("falls back to LRCLIB when Spotify lyrics are missing", async () => {
    const providers = createProviders();
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue(undefined);
    vi.mocked(providers.spotify.getTrackMetadata).mockResolvedValue({
      id: "track",
      name: "Song",
      artists: ["Artist"]
    });
    vi.mocked(providers.lrclib.getLyrics).mockResolvedValue({
      Type: "Static",
      Lines: [{ Text: "Fallback lyric" }]
    });

    const service = createLyricsService(providers);
    await expect(service.getLyrics("track", "token")).resolves.toEqual({
      Type: "Static",
      Lines: [{ Text: "Fallback lyric" }]
    });
    expect(providers.lrclib.getLyrics).toHaveBeenCalledWith({
      id: "track",
      name: "Song",
      artists: ["Artist"]
    });
  });

  it("uses supplied track metadata for LRCLIB fallback before fetching Spotify metadata", async () => {
    const providers = createProviders();
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue(undefined);
    vi.mocked(providers.lrclib.getLyrics).mockResolvedValue({
      Type: "Static",
      Lines: [{ Text: "Fallback lyric" }]
    });

    const service = createLyricsService(providers);
    await expect(
      service.getLyrics("track", "token", {
        id: "track",
        name: "Song",
        artists: ["Artist"],
        album: "Album",
        durationSeconds: 123,
        isrc: "ISRC"
      })
    ).resolves.toEqual({
      Type: "Static",
      Lines: [{ Text: "Fallback lyric" }]
    });

    expect(providers.spotify.getTrackMetadata).not.toHaveBeenCalled();
    expect(providers.lrclib.getLyrics).toHaveBeenCalledWith({
      id: "track",
      name: "Song",
      artists: ["Artist"],
      album: "Album",
      durationSeconds: 123,
      isrc: "ISRC"
    });
  });

  it("passes Spotify client context to the Spotify provider", async () => {
    const providers = createProviders();
    vi.mocked(providers.spotify.getLyrics).mockResolvedValue(undefined);
    vi.mocked(providers.spotify.getTrackMetadata).mockResolvedValue(undefined);

    const service = createLyricsService(providers);
    await service.getLyrics("track", "token", undefined, {
      appPlatform: "Linux_x86_64",
      appVersion: "1.2.99.999"
    });

    expect(providers.spotify.getLyrics).toHaveBeenCalledWith("track", "token", {
      appPlatform: "Linux_x86_64",
      appVersion: "1.2.99.999"
    });
  });
});

describe("worker route", () => {
  const env = {};
  const context = {} as ExecutionContext;

  it("returns 401 when authorization is missing", async () => {
    const response = await worker.fetch?.(new Request("http://localhost:8787/lyrics/track"), env, context);
    expect(response).toBeDefined();
    if (response === undefined) {
      throw new Error("Worker fetch handler is missing");
    }

    expect(response.status).toBe(401);
  });

  it("returns 404 for unknown routes", async () => {
    const response = await worker.fetch?.(new Request("http://localhost:8787/nope"), env, context);
    expect(response).toBeDefined();
    if (response === undefined) {
      throw new Error("Worker fetch handler is missing");
    }

    expect(response.status).toBe(404);
  });

  it("returns an empty body when no provider finds lyrics", async () => {
    const injectedWorker = createWorker({
      getLyrics: vi.fn().mockResolvedValue(undefined)
    });

    const response = await injectedWorker.fetch?.(
      new Request("http://localhost:8787/lyrics/track", {
        headers: {
          Authorization: "Bearer token"
        }
      }),
      env,
      context
    );

    expect(response).toBeDefined();
    if (response === undefined) {
      throw new Error("Worker fetch handler is missing");
    }

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("");
  });

  it("passes query track metadata to the lyrics service", async () => {
    const service = {
      getLyrics: vi.fn().mockResolvedValue(undefined)
    };
    const injectedWorker = createWorker(service);

    const response = await injectedWorker.fetch?.(
      new Request(
        "http://localhost:8787/lyrics/track?track_name=Song&artist_name=Artist&album_name=Album&duration=123&isrc=ISRC",
        {
          headers: {
            Authorization: "Bearer token"
          }
        }
      ),
      env,
      context
    );

    expect(response).toBeDefined();
    if (response === undefined) {
      throw new Error("Worker fetch handler is missing");
    }

    expect(service.getLyrics).toHaveBeenCalledWith(
      "track",
      "token",
      {
        id: "track",
        name: "Song",
        artists: ["Artist"],
        album: "Album",
        durationSeconds: 123,
        isrc: "ISRC"
      },
      undefined
    );
  });

  it("passes Spotify client context headers to the lyrics service", async () => {
    const service = {
      getLyrics: vi.fn().mockResolvedValue(undefined)
    };
    const injectedWorker = createWorker(service);

    const response = await injectedWorker.fetch?.(
      new Request("http://localhost:8787/lyrics/track", {
        headers: {
          Authorization: "Bearer token",
          "X-Spotify-App-Platform": "Linux_x86_64",
          "X-Spotify-App-Version": "1.2.99.999"
        }
      }),
      env,
      context
    );

    expect(response).toBeDefined();
    if (response === undefined) {
      throw new Error("Worker fetch handler is missing");
    }

    expect(service.getLyrics).toHaveBeenCalledWith("track", "token", undefined, {
      appPlatform: "Linux_x86_64",
      appVersion: "1.2.99.999"
    });
  });
});
