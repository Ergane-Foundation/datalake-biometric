// SPDX-License-Identifier: Apache-2.0
/**
 * The subset of a file-system API that {@link readPhotoAndDelete} needs.
 * `react-native-blob-util`'s `fs` object satisfies it; tests pass a fake.
 */
export type PhotoFileSystem = {
  readFile(path: string, encoding: 'base64'): Promise<string>;
  unlink(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
};

/**
 * Reads a captured photo as base64 and deletes the file before returning.
 *
 * Vision Camera always writes a capture to a temporary JPEG. That file is a raw
 * face image, so it must not outlive the call: it is deleted whether the read
 * succeeds or fails. If the file still exists after the delete attempt, this
 * throws rather than return the image, so a privacy failure is never silent.
 */
export async function readPhotoAndDelete(
  rawPath: string,
  fs: PhotoFileSystem
): Promise<string> {
  const path = rawPath.startsWith('file://')
    ? rawPath.slice('file://'.length)
    : rawPath;

  let data: string | undefined;
  let readError: unknown;
  try {
    data = await fs.readFile(path, 'base64');
  } catch (e) {
    readError = e;
  }

  try {
    await fs.unlink(path);
  } catch {
    // A failed unlink is only acceptable if the file is already gone.
    if (await fs.exists(path)) {
      throw new Error('Could not delete the temporary photo file.');
    }
  }

  if (readError !== undefined || data === undefined) {
    throw readError ?? new Error('Could not read the captured photo.');
  }
  return data;
}
