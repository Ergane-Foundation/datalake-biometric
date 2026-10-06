#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fails if a tracked or new text file starts with a UTF-8 byte order mark (BOM) or
// contains mojibake: UTF-8 text that was decoded as Windows-1252 and saved
// again, which turns one accented letter or dash into two or three odd
// characters. Some Windows editors do this silently, so CI checks it.
//
// Usage: yarn lint:encoding

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKIP = /(^\.yarn\/releases\/|\.(png|jpe?g|gif|ico|jar|pdf|zip|tflite|keystore|ttf|otf)$)/i;
// C1 control characters, or the typical first two characters of a double-encoded sequence.
const MOJIBAKE = /[\u0080-\u009f]|\u00f0\u0178|\u00e2\u20ac|\u00e2\u201d|\u00c3[\u0080-\u00bf]|\u00c2[\u00a0-\u00bf]/;

const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter((f) => f && !SKIP.test(f));

const problems = [];
for (const file of files) {
  let buffer;
  try {
    buffer = readFileSync(file);
  } catch {
    continue; // deleted in the working tree
  }
  if (buffer.includes(0)) continue; // binary
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    problems.push(`${file}: starts with a UTF-8 BOM`);
  }
  buffer
    .toString('utf8')
    .split('\n')
    .forEach((line, i) => {
      if (MOJIBAKE.test(line)) problems.push(`${file}:${i + 1}: looks double-encoded`);
    });
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error('\nSave these files as UTF-8 without BOM. See CONTRIBUTING.md.');
  process.exit(1);
}
console.log(`ok       ${files.length} files checked`);
