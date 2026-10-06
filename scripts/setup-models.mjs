#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Downloads the TFLite models the Android library needs and verifies them.
//
// Usage:
//   yarn setup:models          download missing or wrong files
//   yarn setup:models --check  only verify, exit 1 if anything is missing
//
// Models are not committed to git. Each file is pinned by SHA-256, so a changed
// or corrupted upstream file is rejected instead of silently used. Provenance
// and licenses are documented in docs/MODELS.md.

import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelsDir = path.join(root, 'android', 'src', 'main', 'assets', 'models');

const MODELS = [
  {
    file: 'blazeface.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
    sha256: 'b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f',
  },
  {
    file: 'mobilefacenet.tflite',
    url: 'https://github.com/MCarlomagno/FaceRecognitionAuth/raw/master/assets/mobilefacenet.tflite',
    sha256: 'be4bc7cfc53f7bc336d0f28b1ab92535f618c913a422b683210750f6b5354854',
    // Earlier versions of this repo stored the same file under this name.
    legacyFile: 'mobilefacenet_int8.tflite',
  },
];

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function hasExpectedHash(file, expected) {
  return existsSync(file) && (await sha256(file)) === expected;
}

async function download(model, target) {
  const response = await fetch(model.url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${model.url}`);
  }
  // Write to a temporary name first so a failed or wrong download never
  // replaces a good file.
  const temp = `${target}.download`;
  await writeFile(temp, Buffer.from(await response.arrayBuffer()));
  const actual = await sha256(temp);
  if (actual !== model.sha256) {
    await rm(temp, { force: true });
    throw new Error(
      `SHA-256 mismatch for ${model.file}: expected ${model.sha256}, got ${actual}. ` +
        'The upstream file changed. Do not use it until docs/MODELS.md is updated.'
    );
  }
  await rename(temp, target);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  await mkdir(modelsDir, { recursive: true });
  let failures = 0;

  for (const model of MODELS) {
    const target = path.join(modelsDir, model.file);
    const relative = path.relative(root, target);

    if (await hasExpectedHash(target, model.sha256)) {
      console.log(`ok       ${relative}`);
      continue;
    }
    if (checkOnly) {
      console.log(`missing  ${relative}`);
      failures++;
      continue;
    }

    const legacy = model.legacyFile && path.join(modelsDir, model.legacyFile);
    if (legacy && (await hasExpectedHash(legacy, model.sha256))) {
      await copyFile(legacy, target);
      console.log(`copied   ${relative} (from ${model.legacyFile}; you can delete the old file)`);
      continue;
    }

    try {
      process.stdout.write(`download ${relative} ... `);
      await download(model, target);
      console.log('ok');
    } catch (error) {
      console.log('failed');
      console.error(`  ${error.message}`);
      failures++;
    }
  }

  if (failures > 0) {
    console.error(
      checkOnly
        ? '\nModels missing. Run: yarn setup:models'
        : '\nSome models could not be set up. See docs/MODELS.md for manual steps.'
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
