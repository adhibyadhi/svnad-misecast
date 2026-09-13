/**
 * Initial limits for individual import submissions.
 *
 * These bound parsing work, not total database size.
 * The upload route must enforce the byte limit before buffering.
 */

export const importLimits = Object.freeze({
  maximumFileBytes: 20 * 1024 * 1024,
  maximumRows: 100000,
  maximumRowBytes: 256 * 1024,
});
