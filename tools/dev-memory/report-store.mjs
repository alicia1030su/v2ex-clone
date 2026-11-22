import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * Atomic JSON report storage.
 *
 * A report is written to a same-directory temporary file, flushed, and then
 * renamed over the destination. Readers therefore never observe half a JSON
 * document, including when the supervisor exits abnormally.
 */
export class ReportStore {
  /**
   * @param {string} filePath
   * @param {unknown} value
   */
  static writeAtomic(filePath, value) {
    const absolute = path.resolve(filePath);
    mkdirSync(path.dirname(absolute), { recursive: true });
    const temporary = path.join(
      path.dirname(absolute),
      `.${path.basename(absolute)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
    );
    let descriptor = -1;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = -1;
      renameSync(temporary, absolute);
    } catch (error) {
      if (descriptor >= 0) {
        try {
          closeSync(descriptor);
        } catch {
          // Preserve the original write error.
        }
      }
      try {
        unlinkSync(temporary);
      } catch {
        // The temporary file may not have been created.
      }
      throw error;
    }
  }

  /**
   * @param {string} filePath
   * @returns {unknown}
   */
  static read(filePath) {
    return JSON.parse(readFileSync(path.resolve(filePath), 'utf8'));
  }

  /**
   * @param {string} filePath
   * @param {unknown} value
   */
  writeAtomic(filePath, value) {
    ReportStore.writeAtomic(filePath, value);
  }

  /**
   * @param {string} filePath
   * @returns {unknown}
   */
  read(filePath) {
    return ReportStore.read(filePath);
  }
}
