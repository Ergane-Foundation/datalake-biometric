// SPDX-License-Identifier: Apache-2.0
import type { RandomInt } from './random';

/**
 * Active liveness: the user must perform randomly chosen actions in front of
 * the camera. This module is only the decision logic. It has no camera or
 * native dependency: feed it one {@link FaceObservation} per frame from any
 * face detector that reports eye, smile and head-pose values (for example
 * ML Kit through `react-native-vision-camera-face-detector`, as the example
 * app does).
 *
 * This is active challenge-response only. It defeats static photos, printed or
 * on a screen, because a still image cannot change pose on request. It does
 * NOT defend against video replays, deepfakes or masks, and it is not
 * certified presentation attack detection.
 */

export type LivenessChallenge = 'blink' | 'smile' | 'turn';

export const LIVENESS_CHALLENGES: readonly LivenessChallenge[] = [
  'blink',
  'smile',
  'turn',
];

/** Face measurements for one camera frame. Probabilities are 0..1. */
export interface FaceObservation {
  /** Number of faces in the frame. More than one fails the session. */
  faceCount: number;
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  smilingProbability?: number;
  /** Head rotation around the vertical axis, in degrees. Sign does not matter. */
  headYawDegrees?: number;
  /** Frame time in milliseconds, from a monotonic or wall clock. */
  timestampMs: number;
}

export interface LivenessConfig {
  /** Whole session must finish within this time, measured from the first frame. */
  timeoutMs: number;
  requiredBlinks: number;
  /** Average eye-open probability below this counts as closed. */
  eyeClosedBelow: number;
  /** Average eye-open probability above this counts as open. */
  eyeOpenAbove: number;
  /** Smile probability below this counts as a neutral face. */
  neutralSmileBelow: number;
  /** Smile probability above this counts as smiling. */
  smileAbove: number;
  /** Absolute yaw below this counts as facing the camera. */
  frontalYawBelowDegrees: number;
  /** Absolute yaw above this counts as a head turn. */
  turnedYawAboveDegrees: number;
}

/**
 * Defaults tuned on ML Kit's classification output during development. They
 * are starting points, not calibrated values; adjust them for your detector.
 */
export const DEFAULT_LIVENESS_CONFIG: LivenessConfig = {
  timeoutMs: 12_000,
  requiredBlinks: 2,
  eyeClosedBelow: 0.3,
  eyeOpenAbove: 0.7,
  neutralSmileBelow: 0.3,
  smileAbove: 0.7,
  frontalYawBelowDegrees: 10,
  turnedYawAboveDegrees: 20,
};

export type LivenessStatus = 'IN_PROGRESS' | 'PASSED' | 'FAILED';
export type LivenessFailure = 'TIMEOUT' | 'MULTIPLE_FACES';

export interface LivenessState {
  readonly status: LivenessStatus;
  readonly failure?: LivenessFailure;
  /** Challenges in the order the user must complete them. */
  readonly challenges: readonly LivenessChallenge[];
  /** Index into `challenges` of the active one; equals its length once passed. */
  readonly currentIndex: number;
  readonly faceInFrame: boolean;
  /** Blinks counted so far in the active blink challenge. */
  readonly blinkCount: number;
  /**
   * Whether the starting pose of the active challenge was seen: eyes closed
   * (blink), neutral face (smile) or facing the camera (turn). Requiring the
   * start pose means a static photo that already shows the end pose fails.
   */
  readonly armed: boolean;
  readonly startedAtMs: number | null;
  readonly config: LivenessConfig;
}

/**
 * Picks `count` distinct challenges in random order (partial Fisher-Yates).
 *
 * @param randomInt Source of randomness. Pass a secure one in production.
 */
export function pickChallenges(
  count: number,
  randomInt: RandomInt
): LivenessChallenge[] {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > LIVENESS_CHALLENGES.length
  ) {
    throw new RangeError(
      `count must be an integer from 1 to ${LIVENESS_CHALLENGES.length}.`
    );
  }
  const pool = [...LIVENESS_CHALLENGES];
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(pool.length - i);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}

/**
 * Creates a fresh session for the given challenge sequence.
 *
 * @param startedAtMs Start of the timeout window. Pass the current time in
 *   apps, so the session also expires when the camera delivers no frames.
 *   When omitted, the clock starts at the first observed frame.
 */
export function createLivenessState(
  challenges: readonly LivenessChallenge[],
  config: Partial<LivenessConfig> = {},
  startedAtMs: number | null = null
): LivenessState {
  if (challenges.length === 0) {
    throw new RangeError('At least one challenge is required.');
  }
  return {
    status: 'IN_PROGRESS',
    challenges: [...challenges],
    currentIndex: 0,
    faceInFrame: false,
    blinkCount: 0,
    armed: false,
    startedAtMs,
    config: { ...DEFAULT_LIVENESS_CONFIG, ...config },
  };
}

/** The challenge the user must perform now, or `null` when the session is over. */
export function currentChallenge(
  state: LivenessState
): LivenessChallenge | null {
  return state.status === 'IN_PROGRESS'
    ? (state.challenges[state.currentIndex] ?? null)
    : null;
}

/**
 * Fails the session if its time is up. Call it from a timer as well as from
 * {@link updateLiveness}, because frames may stop arriving (camera paused).
 */
export function expireLiveness(
  state: LivenessState,
  nowMs: number
): LivenessState {
  if (state.status !== 'IN_PROGRESS' || state.startedAtMs === null)
    return state;
  if (nowMs - state.startedAtMs > state.config.timeoutMs) {
    return { ...state, status: 'FAILED', failure: 'TIMEOUT' };
  }
  return state;
}

/** Applies one frame and returns the next state. Pure: never mutates `state`. */
export function updateLiveness(
  state: LivenessState,
  observation: FaceObservation
): LivenessState {
  if (state.status !== 'IN_PROGRESS') return state;

  const started: LivenessState =
    state.startedAtMs === null
      ? { ...state, startedAtMs: observation.timestampMs }
      : state;
  const timed = expireLiveness(started, observation.timestampMs);
  if (timed.status !== 'IN_PROGRESS') return timed;

  if (observation.faceCount > 1) {
    return {
      ...timed,
      status: 'FAILED',
      failure: 'MULTIPLE_FACES',
      faceInFrame: true,
    };
  }
  if (observation.faceCount === 0) {
    // Losing the face resets the active challenge, so a person cannot start
    // it and then swap in a photo or another face to finish it.
    return { ...timed, faceInFrame: false, blinkCount: 0, armed: false };
  }

  const present: LivenessState = { ...timed, faceInFrame: true };
  const challenge = present.challenges[present.currentIndex];
  const step =
    challenge === 'blink'
      ? stepBlink(present, observation)
      : challenge === 'smile'
        ? stepSmile(present, observation)
        : stepTurn(present, observation);

  if (!step.done) return step.state;
  const nextIndex = present.currentIndex + 1;
  return {
    ...step.state,
    currentIndex: nextIndex,
    blinkCount: 0,
    armed: false,
    status: nextIndex >= present.challenges.length ? 'PASSED' : 'IN_PROGRESS',
  };
}

type Step = { state: LivenessState; done: boolean };

function stepBlink(state: LivenessState, obs: FaceObservation): Step {
  const { leftEyeOpenProbability: left, rightEyeOpenProbability: right } = obs;
  if (left === undefined || right === undefined) return { state, done: false };
  const average = (left + right) / 2;
  if (average < state.config.eyeClosedBelow) {
    return { state: { ...state, armed: true }, done: false };
  }
  // A blink is counted on the re-open, so a photo with closed eyes never counts.
  if (average > state.config.eyeOpenAbove && state.armed) {
    const blinkCount = state.blinkCount + 1;
    return {
      state: { ...state, armed: false, blinkCount },
      done: blinkCount >= state.config.requiredBlinks,
    };
  }
  return { state, done: false };
}

function stepSmile(state: LivenessState, obs: FaceObservation): Step {
  const smile = obs.smilingProbability;
  if (smile === undefined) return { state, done: false };
  if (smile < state.config.neutralSmileBelow) {
    return { state: { ...state, armed: true }, done: false };
  }
  return { state, done: state.armed && smile > state.config.smileAbove };
}

function stepTurn(state: LivenessState, obs: FaceObservation): Step {
  if (obs.headYawDegrees === undefined) return { state, done: false };
  const yaw = Math.abs(obs.headYawDegrees);
  if (yaw < state.config.frontalYawBelowDegrees) {
    return { state: { ...state, armed: true }, done: false };
  }
  return {
    state,
    done: state.armed && yaw > state.config.turnedYawAboveDegrees,
  };
}
