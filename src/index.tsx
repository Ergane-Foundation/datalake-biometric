// SPDX-License-Identifier: Apache-2.0
import NativeDatalakeBiometric, { type Spec } from './NativeDatalakeBiometric';
import { randomIntFromBytes, type RandomInt } from './random';

export * from './liveness';
export { randomIntFromBytes, type RandomInt } from './random';

const LINKING_ERROR =
  'The DatalakeBiometric native module is not available. Make sure the package is ' +
  'installed, the app was rebuilt after installing it, and you are running on ' +
  'Android or iOS (Expo Go and the web are not supported).';

function native(): Spec {
  if (!NativeDatalakeBiometric) {
    throw new Error(LINKING_ERROR);
  }
  return NativeDatalakeBiometric;
}

// --- Types -------------------------------------------------------------------

/**
 * Face bounding box in normalized image coordinates (0..1, origin top-left),
 * as reported by a face detector such as ML Kit. On Android it selects which
 * face to use; the face itself is located and aligned by the bundled BlazeFace
 * detector. Without a box, the photo must contain exactly one face. iOS
 * requires a box.
 */
export interface FaceBox {
  nx: number;
  ny: number;
  nw: number;
  nh: number;
}

export interface InitializeOptions {
  /**
   * Minimum cosine similarity (0..1) for a MATCH. Default 0.54: on the LFW
   * benchmark this gives a false accept rate of about 1e-4 per comparison
   * (see docs/BENCHMARKS.md). Every verification is compared with all enrolled
   * people, so the risk of a false match grows with how many are enrolled;
   * raise the threshold for large groups and calibrate on your own data.
   */
  matchThreshold?: number;
  /**
   * Minimum frame quality score (0..1, blur and exposure) before matching.
   * Frames below it return POOR_QUALITY. Default 0.5.
   */
  minQuality?: number;
}

/**
 * - `MATCH` / `NO_MATCH`: a face was embedded and compared.
 * - `NO_FACE`: no usable face was found.
 * - `MULTIPLE_FACES`: several faces were found with no face box given (Android).
 * - `POOR_QUALITY`: the frame was too blurred or badly exposed.
 */
export type VerifyStatus =
  | 'MATCH'
  | 'NO_MATCH'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'POOR_QUALITY';

export interface VerifyResult {
  status: VerifyStatus;
  /** Set when `status` is MATCH. */
  workerId?: string;
  /** Cosine similarity of the best match, when `status` is MATCH. */
  confidence?: number;
  /** Embedding model run time in milliseconds (Android). */
  inferenceMs?: number;
  /** Whole native pipeline time in milliseconds (Android). */
  totalMs?: number;
  /** Frame quality score 0..1 (Android). */
  quality?: number;
}

export interface EnrollResult {
  success: boolean;
  /** Frames in which a face was found and embedded. */
  framesUsed: number;
}

/** Result of the experimental landmark-based blink check. */
export interface LandmarkLivenessResult {
  isLive: boolean;
  isBlink: boolean;
  blinkCount: number;
  earValue: number;
}

export interface GeoLocation {
  latitude: number;
  longitude: number;
}

export interface AttendanceRecord {
  id: string;
  workerId: string;
  /** Milliseconds since the Unix epoch. */
  timestamp: number;
  /** Absent when the record was logged without a location. */
  latitude?: number;
  longitude?: number;
  confidence: number;
  deviceId: string;
  /** Base64 HMAC-SHA256 over the record fields, keyed by a per-install secret. */
  signature: string;
}

// --- SDK ---------------------------------------------------------------------

export const BiometricSDK = {
  /**
   * Loads the models and opens the encrypted on-device database. Call once at
   * app start. Other methods also initialize lazily on first use, but calling
   * this early moves the one-time cost (and any setup error) to a known place.
   */
  initialize(options: InitializeOptions = {}): Promise<boolean> {
    for (const [name, value] of Object.entries(options)) {
      if (
        value !== undefined &&
        !(typeof value === 'number' && value >= 0 && value <= 1)
      ) {
        throw new RangeError(`${name} must be a number from 0 to 1.`);
      }
    }
    return native().initialize(options);
  },

  /**
   * Enrolls a person from several base64 JPEG frames. The embeddings of all
   * frames with a detectable face are averaged into one stored template.
   * Re-enrolling the same `workerId` replaces the old template.
   */
  enrollWorker(
    workerId: string,
    base64Frames: string[],
    hint?: FaceBox
  ): Promise<EnrollResult> {
    return native().enrollWorker(workerId, base64Frames, hint);
  },

  /**
   * Runs the quality check, face detection and alignment, embedding and a 1:N
   * search over all enrolled templates. This does not check liveness; run a
   * liveness session first.
   */
  verifyWorker(base64Image: string, hint?: FaceBox): Promise<VerifyResult> {
    return native().verifyWorker(base64Image, hint) as Promise<VerifyResult>;
  },

  /**
   * Experimental. Blink check from 468-point MediaPipe Face Mesh landmarks.
   * Nothing in this package produces such landmarks yet; prefer the
   * detector-agnostic session in `liveness.ts` (`createLivenessState`).
   */
  checkLiveness(landmarks: number[][]): Promise<LandmarkLivenessResult> {
    return native().checkLiveness(landmarks);
  },

  /**
   * Stores a signed attendance record in the encrypted queue for later sync.
   * Location is optional; when omitted, the record has no coordinates.
   */
  logAttendance(
    workerId: string,
    confidence: number,
    location?: GeoLocation
  ): Promise<boolean> {
    return native().logAndQueueAttendance(workerId, confidence, location);
  },

  /** Returns records that were not marked as synced yet. */
  getPendingRecords(): Promise<AttendanceRecord[]> {
    return native().getPendingAttendanceRecords();
  },

  /** Marks records as synced so they are no longer returned as pending. */
  markSynced(recordIds: string[]): Promise<boolean> {
    return native().markRecordsSynced(recordIds);
  },

  /** Deletes every record already marked as synced from the local database. */
  purgeSyncedRecords(): Promise<boolean> {
    return native().purgeSyncedRecords();
  },

  /**
   * Returns a {@link RandomInt} backed by the platform's secure random source
   * (Android `SecureRandom`, iOS `SecRandomCopyBytes`). React Native's
   * JavaScript engine has no built-in `crypto.getRandomValues`, so this is the
   * way to pick unpredictable liveness challenges.
   *
   * @param byteCount Size of the random pool. 32 bytes is plenty for picking challenges.
   */
  async createSecureRandomInt(byteCount = 32): Promise<RandomInt> {
    const bytes = await native().getSecureRandomBytes(byteCount);
    return randomIntFromBytes(bytes);
  },
};
