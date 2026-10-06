// SPDX-License-Identifier: Apache-2.0
import { readPhotoAndDelete, type PhotoFileSystem } from '../photoFile';

/** In-memory file system that records which paths exist. */
function fakeFs(
  files: Record<string, string>,
  options: { failUnlink?: boolean } = {}
) {
  const store = new Map(Object.entries(files));
  const fs: PhotoFileSystem = {
    readFile: async (path) => {
      const data = store.get(path);
      if (data === undefined) throw new Error(`ENOENT: ${path}`);
      return data;
    },
    unlink: async (path) => {
      if (options.failUnlink) throw new Error('EACCES');
      if (!store.delete(path)) throw new Error(`ENOENT: ${path}`);
    },
    exists: async (path) => store.has(path),
  };
  return { fs, store };
}

describe('readPhotoAndDelete', () => {
  it('returns the photo and deletes the file', async () => {
    const { fs, store } = fakeFs({ '/cache/a.jpg': 'BASE64' });
    await expect(readPhotoAndDelete('file:///cache/a.jpg', fs)).resolves.toBe(
      'BASE64'
    );
    expect(store.has('/cache/a.jpg')).toBe(false);
  });

  it('deletes the file even when reading it fails', async () => {
    const { fs, store } = fakeFs({ '/cache/b.jpg': 'BASE64' });
    fs.readFile = async () => {
      throw new Error('read failed');
    };
    await expect(readPhotoAndDelete('/cache/b.jpg', fs)).rejects.toThrow(
      'read failed'
    );
    expect(store.has('/cache/b.jpg')).toBe(false);
  });

  it('throws instead of returning the photo when the file cannot be deleted', async () => {
    const { fs, store } = fakeFs(
      { '/cache/c.jpg': 'BASE64' },
      { failUnlink: true }
    );
    await expect(readPhotoAndDelete('/cache/c.jpg', fs)).rejects.toThrow(
      'Could not delete the temporary photo file.'
    );
    expect(store.has('/cache/c.jpg')).toBe(true);
  });

  it('reports the read error when the file never existed', async () => {
    const { fs } = fakeFs({});
    await expect(readPhotoAndDelete('/cache/missing.jpg', fs)).rejects.toThrow(
      'ENOENT'
    );
  });
});
