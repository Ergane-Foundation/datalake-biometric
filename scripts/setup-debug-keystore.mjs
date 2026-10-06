#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Creates the debug signing keystore the example Android app expects.
//
// Usage: yarn setup:keystore
//
// The file is git-ignored on purpose: every developer and CI run gets its own.
// It uses the standard Android debug values, so it is not a secret.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keystore = path.join(root, 'example', 'android', 'app', 'debug.keystore');

if (existsSync(keystore)) {
  console.log(`ok       ${path.relative(root, keystore)} already exists`);
  process.exit(0);
}

const javaHome = process.env.JAVA_HOME;
const exe = process.platform === 'win32' ? 'keytool.exe' : 'keytool';
const keytool = javaHome ? path.join(javaHome, 'bin', exe) : exe;

try {
  execFileSync(
    keytool,
    [
      '-genkeypair',
      '-v',
      '-storetype', 'PKCS12',
      '-keystore', keystore,
      '-storepass', 'android',
      '-alias', 'androiddebugkey',
      '-keypass', 'android',
      '-keyalg', 'RSA',
      '-keysize', '2048',
      '-validity', '10000',
      '-dname', 'CN=Android Debug,O=Android,C=US',
    ],
    { stdio: 'ignore' }
  );
  console.log(`created  ${path.relative(root, keystore)}`);
} catch (error) {
  console.error(`Could not run keytool (${keytool}). Install a JDK 17 and set JAVA_HOME.`);
  console.error(error.message);
  process.exit(1);
}
