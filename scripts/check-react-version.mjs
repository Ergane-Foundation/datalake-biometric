#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Fails if React does not match the renderer that React Native bundles.
//
// React Native ships a prebuilt React renderer (Libraries/Renderer) made for
// one exact React version. Any other version, even a newer patch, builds and
// passes every test, but the app throws "Incompatible React versions" as soon
// as a button is tapped. So react, react-dom and react-test-renderer must be
// pinned to exactly that version, and move only together with React Native.
//
// Checks the root workspace and the example app: the versions declared in
// package.json and the versions installed in node_modules.
//
// Usage: yarn lint:react

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinned = ['react', 'react-dom', 'react-test-renderer'];
const errors = [];

function rendererVersion(requireFrom) {
  const rnDir = path.dirname(requireFrom.resolve('react-native/package.json'));
  const dir = path.join(rnDir, 'Libraries', 'Renderer', 'implementations');
  const versions = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const text = readFileSync(path.join(dir, file), 'utf8');
    for (const match of text.matchAll(/reconcilerVersion:\s*"([^"]+)"/g)) {
      versions.add(match[1]);
    }
  }
  if (versions.size !== 1) {
    throw new Error(
      `Expected one renderer version in ${dir}, found: ${[...versions].join(', ') || 'none'}`
    );
  }
  return [...versions][0];
}

for (const workspace of ['.', 'example']) {
  const manifestPath = path.join(root, workspace, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const requireFrom = createRequire(manifestPath);
  const expected = rendererVersion(requireFrom);
  const label = workspace === '.' ? 'root' : workspace;

  for (const name of pinned) {
    for (const field of ['dependencies', 'devDependencies']) {
      const declared = manifest[field]?.[name];
      if (declared !== undefined && declared !== expected) {
        errors.push(
          `${label}/package.json ${field}.${name} is "${declared}", must be exactly "${expected}"`
        );
      }
    }
    let installed;
    try {
      installed = JSON.parse(
        readFileSync(requireFrom.resolve(`${name}/package.json`), 'utf8')
      ).version;
    } catch {
      continue; // not installed in this workspace
    }
    if (installed !== expected) {
      errors.push(
        `${label}: installed ${name} ${installed}, but the React Native renderer needs ${expected}`
      );
    }
  }
  if (errors.length === 0) {
    console.log(
      `ok       ${label}: react matches the React Native renderer (${expected})`
    );
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  console.error(
    'Pin react, react-dom and react-test-renderer to the renderer version; see scripts/check-react-version.mjs.'
  );
  process.exit(1);
}
