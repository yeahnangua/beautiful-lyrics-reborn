const lyricRequestTimeoutMs = 5_000;
const lyricRequestMaxRetries = 2;

export async function withLyricRequestRetries<T>(
  request: (signal: AbortSignal) => Promise<T>,
  label: string
): Promise<T> {
  for (let retry = 0; retry <= lyricRequestMaxRetries; retry += 1) {
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        request(controller.signal),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error(`${label} timed out after ${lyricRequestTimeoutMs / 1000} seconds`));
          }, lyricRequestTimeoutMs);
        })
      ]);
    } catch (error) {
      if (timedOut === false || retry === lyricRequestMaxRetries) {
        throw error;
      }
      console.warn(
        `[lyrics request] ${label}: timed out after ${lyricRequestTimeoutMs / 1000} seconds, retry ${retry + 1}/${lyricRequestMaxRetries}`
      );
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  throw new Error(`${label} failed`);
}
