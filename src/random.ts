// SPDX-License-Identifier: Apache-2.0
/**
 * Returns a uniformly distributed integer in `[0, maxExclusive)`.
 *
 * Liveness code takes this as a parameter instead of calling a random source
 * itself, so tests can pass a deterministic sequence and apps can pass a
 * cryptographically secure one (see `BiometricSDK.createSecureRandomInt`).
 */
export type RandomInt = (maxExclusive: number) => number;

/**
 * Builds a {@link RandomInt} that draws from a fixed pool of random bytes.
 *
 * Uses rejection sampling: bytes that would make `byte % maxExclusive` biased
 * are skipped. Throws when the pool runs out, so a short pool fails loudly
 * instead of silently repeating values.
 *
 * @param bytes Random bytes (0..255), for example from a secure native source.
 */
export function randomIntFromBytes(bytes: ArrayLike<number>): RandomInt {
  let next = 0;
  return (maxExclusive: number) => {
    if (
      !Number.isInteger(maxExclusive) ||
      maxExclusive < 1 ||
      maxExclusive > 256
    ) {
      throw new RangeError('maxExclusive must be an integer from 1 to 256.');
    }
    // Largest multiple of maxExclusive that fits in a byte.
    const limit = 256 - (256 % maxExclusive);
    while (next < bytes.length) {
      const byte = bytes[next++]!;
      if (byte < limit) {
        return byte % maxExclusive;
      }
    }
    throw new Error('Random byte pool exhausted. Request more bytes.');
  };
}
