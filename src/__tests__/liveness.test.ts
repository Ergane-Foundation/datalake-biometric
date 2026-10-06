// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from '@jest/globals';
import {
  createLivenessState,
  currentChallenge,
  expireLiveness,
  pickChallenges,
  updateLiveness,
  type FaceObservation,
  type LivenessState,
} from '../liveness';
import type { RandomInt } from '../random';

/** Deterministic RandomInt that returns the given values in order. */
function sequence(...values: number[]): RandomInt {
  let i = 0;
  return (max) => {
    const v = values[i++];
    if (v === undefined || v >= max)
      throw new Error(`bad test value ${v} for max ${max}`);
    return v;
  };
}

let clock = 0;
const face = (fields: Partial<FaceObservation> = {}): FaceObservation => ({
  faceCount: 1,
  timestampMs: (clock += 100),
  ...fields,
});
const eyes = (p: number) =>
  face({ leftEyeOpenProbability: p, rightEyeOpenProbability: p });
const run = (state: LivenessState, frames: FaceObservation[]) =>
  frames.reduce(updateLiveness, state);

describe('pickChallenges', () => {
  it('returns distinct challenges in the order the random source dictates', () => {
    // Pool [blink, smile, turn]: pick index 2 (turn), then index 0 of the rest.
    expect(pickChallenges(2, sequence(2, 0))).toEqual(['turn', 'smile']);
    expect(pickChallenges(3, sequence(0, 0, 0))).toEqual([
      'blink',
      'smile',
      'turn',
    ]);
  });

  it('rejects counts outside 1..3', () => {
    expect(() => pickChallenges(0, sequence())).toThrow(RangeError);
    expect(() => pickChallenges(4, sequence())).toThrow(RangeError);
  });
});

describe('blink challenge', () => {
  it('passes after two closed-then-open transitions', () => {
    const s = run(createLivenessState(['blink']), [
      eyes(0.9),
      eyes(0.1),
      eyes(0.9),
      eyes(0.1),
      eyes(0.9),
    ]);
    expect(s.status).toBe('PASSED');
  });

  it('does not count a photo with permanently closed or open eyes', () => {
    const closed = run(createLivenessState(['blink']), [
      eyes(0.1),
      eyes(0.1),
      eyes(0.1),
    ]);
    const open = run(createLivenessState(['blink']), [
      eyes(0.9),
      eyes(0.9),
      eyes(0.9),
    ]);
    expect(closed.blinkCount).toBe(0);
    expect(open.blinkCount).toBe(0);
    expect(closed.status).toBe('IN_PROGRESS');
  });

  it('ignores frames without eye probabilities', () => {
    const s = run(createLivenessState(['blink']), [face(), face()]);
    expect(s.blinkCount).toBe(0);
  });
});

describe('smile and turn challenges', () => {
  it('requires a neutral face before the smile', () => {
    const photo = run(createLivenessState(['smile']), [
      face({ smilingProbability: 0.95 }),
    ]);
    expect(photo.status).toBe('IN_PROGRESS');

    const live = run(createLivenessState(['smile']), [
      face({ smilingProbability: 0.1 }),
      face({ smilingProbability: 0.95 }),
    ]);
    expect(live.status).toBe('PASSED');
  });

  it('requires facing the camera before the turn, in either direction', () => {
    const photo = run(createLivenessState(['turn']), [
      face({ headYawDegrees: 35 }),
    ]);
    expect(photo.status).toBe('IN_PROGRESS');

    const live = run(createLivenessState(['turn']), [
      face({ headYawDegrees: 2 }),
      face({ headYawDegrees: -30 }),
    ]);
    expect(live.status).toBe('PASSED');
  });
});

describe('session rules', () => {
  it('runs challenges in sequence and reports the active one', () => {
    let s = createLivenessState(['smile', 'turn']);
    expect(currentChallenge(s)).toBe('smile');
    s = run(s, [
      face({ smilingProbability: 0 }),
      face({ smilingProbability: 1 }),
    ]);
    expect(currentChallenge(s)).toBe('turn');
    expect(s.status).toBe('IN_PROGRESS');
    s = run(s, [face({ headYawDegrees: 0 }), face({ headYawDegrees: 25 })]);
    expect(s.status).toBe('PASSED');
    expect(currentChallenge(s)).toBeNull();
  });

  it('fails immediately when more than one face is visible', () => {
    const s = run(createLivenessState(['blink']), [
      eyes(0.9),
      face({ faceCount: 2 }),
    ]);
    expect(s.status).toBe('FAILED');
    expect(s.failure).toBe('MULTIPLE_FACES');
  });

  it('resets progress of the active challenge when the face is lost', () => {
    const s = run(createLivenessState(['blink']), [
      eyes(0.1),
      eyes(0.9),
      face({ faceCount: 0 }),
      eyes(0.9),
    ]);
    expect(s.blinkCount).toBe(0);
    expect(s.faceInFrame).toBe(true);
  });

  it('times out from the first frame, both on frames and on a timer', () => {
    const start = createLivenessState(['blink'], { timeoutMs: 1000 });
    const first = updateLiveness(start, { faceCount: 1, timestampMs: 5000 });
    expect(
      updateLiveness(first, { faceCount: 1, timestampMs: 6001 }).failure
    ).toBe('TIMEOUT');
    expect(expireLiveness(first, 5999).status).toBe('IN_PROGRESS');
    expect(expireLiveness(first, 6001).failure).toBe('TIMEOUT');
  });

  it('expires on a timer even when no frame ever arrives, if given a start time', () => {
    const s = createLivenessState(['blink'], { timeoutMs: 1000 }, 100);
    expect(expireLiveness(s, 1000).status).toBe('IN_PROGRESS');
    expect(expireLiveness(s, 1101).failure).toBe('TIMEOUT');
    expect(expireLiveness(createLivenessState(['blink']), 1e12).status).toBe(
      'IN_PROGRESS'
    );
  });

  it('never changes a finished session and never mutates its input', () => {
    const failed = run(createLivenessState(['blink']), [
      face({ faceCount: 3 }),
    ]);
    expect(updateLiveness(failed, eyes(0.1))).toBe(failed);

    const before = createLivenessState(['smile']);
    const snapshot = JSON.stringify(before);
    updateLiveness(before, face({ smilingProbability: 0 }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
