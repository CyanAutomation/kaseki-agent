#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(tempPath, filePath);
  } finally {
    try { fs.unlinkSync(tempPath); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export function writeRunMetadata(candidatePath, outputPath, diagnosticPath, fallbackInput) {
  const candidateBytes = fs.readFileSync(candidatePath);
  let metadata;
  let diagnostic;
  try {
    metadata = JSON.parse(candidateBytes.toString('utf8'));
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new TypeError('metadata root must be a JSON object');
    }
  } catch (error) {
    const fallback = typeof fallbackInput === 'string' ? JSON.parse(fallbackInput) : fallbackInput;
    if (!fallback || typeof fallback !== 'object' || Array.isArray(fallback)) {
      throw new TypeError('metadata fallback must be a JSON object');
    }
    const candidateSha256 = crypto.createHash('sha256').update(candidateBytes).digest('hex');
    const message = String(error?.message ?? error).slice(0, 500);
    diagnostic = {
      timestamp: new Date().toISOString(),
      reason_code: 'metadata_write_invalid',
      message,
      candidate_sha256: candidateSha256,
      fallback_used: true,
      instance: fallback.instance,
      exit_code: fallback.exit_code,
      failed_command: fallback.failed_command,
    };
    metadata = {
      ...fallback,
      metadata_write_error: {
        reason_code: diagnostic.reason_code,
        diagnostic_file: path.basename(diagnosticPath),
        candidate_sha256: candidateSha256,
      },
    };
  }

  let outputPersisted = false;
  try {
    if (diagnostic) writeJsonAtomic(diagnosticPath, diagnostic);
    writeJsonAtomic(outputPath, metadata);
    outputPersisted = true;
    return { fallbackUsed: Boolean(diagnostic), metadata };
  } finally {
    // Never leave malformed serialized metadata behind if fallback persistence
    // itself fails. Keep a valid candidate only when its durable output failed.
    if (diagnostic || outputPersisted) {
      try { fs.unlinkSync(candidatePath); } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const [, , candidatePath, outputPath, diagnosticPath, fallbackJson] = process.argv;
  if (!candidatePath || !outputPath || !diagnosticPath || fallbackJson === undefined) {
    process.stderr.write('Usage: write-run-metadata.mjs <candidate> <output> <diagnostic> <fallback-json>\n');
    process.exitCode = 2;
  } else {
    try {
      writeRunMetadata(candidatePath, outputPath, diagnosticPath, fallbackJson);
    } catch (error) {
      process.stderr.write(`Unable to persist run metadata: ${String(error?.message ?? error)}\n`);
      process.exitCode = 1;
    }
  }
}
