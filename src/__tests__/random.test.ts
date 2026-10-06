// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from '@jest/globals';
import { randomIntFromBytes } from '../random';

describe('randomIntFromBytes', () => {
  it('maps bytes into range', () => {
    const next = randomIntFromBytes([0, 1, 2, 3]);
    expect([next(2), next(2), next(2), next(2)]).toEqual([0, 1, 0, 1]);
  });

  it('skips bytes that would bias the result', () => {
    // For max 3 the usable bytes are 0..254; 255 must be skipped.
    const next = randomIntFromBytes([255, 4]);
    expect(next(3)).toBe(1);
  });

  it('gives every value equal weight over all usable bytes', () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    const next = randomIntFromBytes(all);
    // Bytes 0..254 are usable for max 3, so 255 draws cover each value 85 times.
    const counts = [0, 0, 0];
    for (let i = 0; i < 255; i++) counts[next(3)]!++;
    expect(counts).toEqual([85, 85, 85]);
  });

  it('throws when the pool runs out or the range is invalid', () => {
    const next = randomIntFromBytes([255]);
    expect(() => next(3)).toThrow('exhausted');
    expect(() => randomIntFromBytes([1])(0)).toThrow(RangeError);
    expect(() => randomIntFromBytes([1])(257)).toThrow(RangeError);
  });
});
