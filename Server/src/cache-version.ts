/**
 * Shared across Worker deployments. Bump for incompatible changes to content,
 * provider selection/matching, conversion, key normalization, or freshness.
 * Presentation, logging and unrelated deployments keep the same version.
 */
export const lyricsCacheVersion = 4 as const;
export const lyricsCacheMetricVersion = "workers-cache-v" + lyricsCacheVersion;
