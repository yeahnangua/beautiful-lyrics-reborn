import { describe, expect, it, vi } from "vitest";
import { createSpotifyProvider, spotifyTrackIdToGid } from "../src/providers/spotify";

describe("Spotify provider", () => {
  it("converts Spotify base62 track ids to metadata gid hex", () => {
    expect(spotifyTrackIdToGid("6OsRo5kez17uDLwddaKfrI")).toBe("dfe2a264a1e74335aa3fdd3e5d7777c2");
  });

  it("uses supplied Spotify client context headers for lyrics requests", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          lyrics: {
            syncType: "UNSYNCED",
            lines: [{ words: "Lyric" }]
          }
        }),
        { status: 200 }
      )
    );

    const provider = createSpotifyProvider(fetchMock);
    await provider.getLyrics("6OsRo5kez17uDLwddaKfrI", "token", {
      appPlatform: "Linux_x86_64",
      appVersion: "1.2.99.999"
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://spclient.wg.spotify.com/color-lyrics/v2/track/6OsRo5kez17uDLwddaKfrI?format=json&vocalRemoval=false&market=from_token",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token",
          "App-Platform": "Linux_x86_64",
          "Spotify-App-Version": "1.2.99.999"
        })
      })
    );
  });

  it("falls back to spclient metadata when Web API metadata is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            gid: "dfe2a264a1e74335aa3fdd3e5d7777c2",
            name: "Test Song",
            artist: [{ gid: "artist", name: "Test Artist" }],
            album: {
              gid: "album",
              name: "Test Album",
              artist: [],
              date: { year: 2024 }
            },
            duration: 181,
            external_id: [{ type: "isrc", id: "TESTISRC" }]
          }),
          { status: 200 }
        )
      );

    const provider = createSpotifyProvider(fetchMock);
    await expect(provider.getTrackMetadata("6OsRo5kez17uDLwddaKfrI", "token")).resolves.toEqual({
      id: "6OsRo5kez17uDLwddaKfrI",
      name: "Test Song",
      artists: ["Test Artist"],
      album: "Test Album",
      durationSeconds: 181,
      isrc: "TESTISRC"
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://spclient.wg.spotify.com/metadata/4/track/dfe2a264a1e74335aa3fdd3e5d7777c2",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token"
        })
      })
    );
  });

  it("returns undefined instead of throwing when spclient metadata is not JSON", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([10, 102, 74, 201, 0]), {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream"
          }
        })
      );

    const provider = createSpotifyProvider(fetchMock);
    await expect(provider.getTrackMetadata("6OsRo5kez17uDLwddaKfrI", "token")).resolves.toBeUndefined();
  });
});
