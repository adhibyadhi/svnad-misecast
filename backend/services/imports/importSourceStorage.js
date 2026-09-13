/**
 * Saves and reloads bounded original uploads in MongoDB.
 *
 * Job processing must start only after the complete source has been
 * stored and its manifest has been attached to the job.
 */

import { createHash } from "node:crypto";
import { importLimits } from "../../config/importLimits.js";
import { ImportSourceChunk } from "../../models/supporting/index.js";

const chunkSizeBytes = 256 * 1024;

/**
 * Calculates SHA-256 from original bytes.
 */
export function calculateSourceChecksum(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Persists source chunks.
 *
 * Repeating the same job ID and bytes is allowed.
 * A conflicting chunk is rejected instead of overwritten.
 *
 * Partial storage is not a complete, runnable upload.
 */
export async function storeImportSource(importJobId, fileBuffer) {
  if (typeof importJobId !== "string" || importJobId.trim() === "") {
    throw new Error("An import job ID is required.");
  }

  if (
    !Buffer.isBuffer(fileBuffer) ||
    fileBuffer.length === 0 ||
    fileBuffer.length > importLimits.maximumFileBytes
  ) {
    throw new Error(
      "Import source must be a non-empty Buffer within the file limit.",
    );
  }

  const chunkCount = Math.ceil(fileBuffer.length / chunkSizeBytes);

  for (let chunkNumber = 0; chunkNumber < chunkCount; chunkNumber += 1) {
    const start = chunkNumber * chunkSizeBytes;
    const data = fileBuffer.subarray(start, start + chunkSizeBytes);
    const chunkChecksum = calculateSourceChecksum(data);

    try {
      await ImportSourceChunk.create({
        import_job_id: importJobId,
        chunk_number: chunkNumber,
        chunk_checksum: chunkChecksum,
        data,
      });
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }

      const existingChunk = await ImportSourceChunk.findOne({
        record_kind: "source_chunk",
        import_job_id: importJobId,
        chunk_number: chunkNumber,
      });

      if (
        !existingChunk ||
        existingChunk.chunk_checksum !== chunkChecksum ||
        !existingChunk.data.equals(data)
      ) {
        throw new Error(
          "Stored import source conflicts with the submitted bytes.",
        );
      }
    }
  }

  // Detect leftover chunks from an inconsistent reuse of the job ID.
  const storedChunkCount = await ImportSourceChunk.countDocuments({
    record_kind: "source_chunk",
    import_job_id: importJobId,
  });

  if (storedChunkCount !== chunkCount) {
    throw new Error("Stored source chunk count does not match the upload.");
  }

  return {
    source_size_bytes: fileBuffer.length,
    source_chunk_count: chunkCount,
    source_checksum: calculateSourceChecksum(fileBuffer),
  };
}

/**
 * Reloads and verifies a complete source using its saved manifest.
 *
 * Returns a bounded temporary Buffer for parsing.
 */
export async function loadImportSource(importJobId, manifest) {
  const {
    source_size_bytes: expectedSize,
    source_chunk_count: expectedCount,
    source_checksum: expectedChecksum,
  } = manifest;

  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > importLimits.maximumFileBytes ||
    expectedCount !== Math.ceil(expectedSize / chunkSizeBytes) ||
    typeof expectedChecksum !== "string" ||
    !/^[a-f0-9]{64}$/.test(expectedChecksum)
  ) {
    throw new Error("Invalid import source manifest.");
  }

  const buffers = [];
  let totalBytes = 0;
  let expectedChunkNumber = 0;

  const cursor = ImportSourceChunk.find({
    record_kind: "source_chunk",
    import_job_id: importJobId,
  })
    .sort({ chunk_number: 1 })
    .cursor();

  try {
    for await (const chunk of cursor) {
      if (
        expectedChunkNumber >= expectedCount ||
        chunk.chunk_number !== expectedChunkNumber
      ) {
        throw new Error("Import source chunks are missing or out of sequence.");
      }

      const expectedChunkBytes = Math.min(
        chunkSizeBytes,
        expectedSize - totalBytes,
      );

      if (
        !Buffer.isBuffer(chunk.data) ||
        chunk.data.length !== expectedChunkBytes ||
        calculateSourceChecksum(chunk.data) !== chunk.chunk_checksum
      ) {
        throw new Error("Import source chunk failed verification.");
      }

      buffers.push(chunk.data);
      totalBytes += chunk.data.length;
      expectedChunkNumber += 1;
    }
  } finally {
    await cursor.close();
  }

  if (expectedChunkNumber !== expectedCount || totalBytes !== expectedSize) {
    throw new Error("Import source is incomplete.");
  }

  const fileBuffer = Buffer.concat(buffers, totalBytes);

  if (calculateSourceChecksum(fileBuffer) !== expectedChecksum) {
    throw new Error("Import source checksum does not match its manifest.");
  }

  return fileBuffer;
}
