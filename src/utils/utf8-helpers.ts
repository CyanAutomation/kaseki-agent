/**
 * UTF-8 safe string encoding/decoding utilities.
 * Handles proper UTF-8 sequence detection to prevent breaking multi-byte characters.
 */

import * as fs from 'fs';

/**
 * Check if a byte is a UTF-8 continuation byte.
 * Continuation bytes have the pattern 10xxxxxx (0x80-0xBF).
 */
function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

/**
 * Determine the expected length of a UTF-8 sequence from its leading byte.
 */
function utf8SequenceLength(leadingByte: number): number {
  if ((leadingByte & 0x80) === 0) return 1; // Single-byte: 0xxxxxxx
  if ((leadingByte & 0xe0) === 0xc0) return 2; // Two-byte: 110xxxxx
  if ((leadingByte & 0xf0) === 0xe0) return 3; // Three-byte: 1110xxxx
  if ((leadingByte & 0xf8) === 0xf0) return 4; // Four-byte: 11110xxx
  return 1; // Invalid; treat as single-byte
}

/**
 * Safely decode a buffer tail to UTF-8, avoiding partial UTF-8 sequences.
 * If the buffer ends in the middle of a multi-byte UTF-8 sequence,
 * the incomplete sequence is truncated.
 *
 * @param buffer Buffer to decode
 * @returns UTF-8 string without incomplete sequences at the end
 */
export function decodeUtf8TailSafely(buffer: Buffer): string {
  let end = buffer.length;
  if (end > 0) {
    let continuationCount = 0;
    let candidateLead = end - 1;

    // Count continuation bytes at the end
    while (candidateLead >= 0 && isUtf8ContinuationByte(buffer[candidateLead])) {
      continuationCount++;
      candidateLead--;
    }

    if (candidateLead < 0) {
      // All bytes are continuation bytes; skip all
      end = 0;
    } else {
      const sequenceLength = utf8SequenceLength(buffer[candidateLead]);
      const expectedContinuationCount = sequenceLength - 1;

      // If the continuation byte count doesn't match the expected count, truncate
      if (sequenceLength > 1 && continuationCount !== expectedContinuationCount) {
        end = candidateLead;
      }
    }
  }

  return buffer.subarray(0, end).toString('utf-8');
}

/**
 * Extract the last N lines from a string.
 *
 * @param content String content to extract from
 * @param maxLines Maximum number of lines to return
 * @returns Last N lines of the content (or entire content if fewer lines)
 */
export function tailLogByLines(content: string, maxLines: number): string {
  if (maxLines <= 0) {
    return '';
  }

  const lines = content.split(/\r?\n/);
  if (lines.length <= maxLines) {
    return content;
  }
  return lines.slice(-maxLines).join('\n');
}

/**
 * Read the tail bytes of a file into a buffer.
 * Useful for reading last N bytes of a large file without loading entire file.
 *
 * @param logFile Path to the file
 * @param size Total size of the file (from fs.statSync)
 * @param maxSize Maximum bytes to read
 * @returns Buffer containing the tail bytes
 */
export function readTailBytes(logFile: string, size: number, maxSize: number): Buffer {
  const truncated = Buffer.alloc(maxSize);
  const fd = fs.openSync(logFile, 'r');
  try {
    fs.readSync(fd, truncated, 0, maxSize, size - maxSize);
  } finally {
    fs.closeSync(fd);
  }

  return truncated;
}
