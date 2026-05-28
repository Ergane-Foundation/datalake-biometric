import { NativeModules } from 'react-native';

const { DatalakeBiometric } = NativeModules;

if (!DatalakeBiometric) {
  throw new Error(
    'DatalakeBiometric native module is not available. ' +
      'Ensure the library is correctly linked and that you are running on a physical or emulated Android device. ' +
      'If using Expo, this module requires a custom development build.'
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type VerifyStatus = 'MATCH' | 'NO_MATCH' | 'NO_FACE' | 'POOR_QUALITY';

export interface VerifyResult {
  status: VerifyStatus;
  workerId?: string;
  confidence?: number;
  inferenceMs?: number;
  totalMs?: number;
  quality?: number;
}

export interface EnrollResult {
  success: boolean;
  framesUsed: number;
}

export interface LivenessResult {
  isLive: boolean;
  isBlink: boolean;
  blinkCount: number;
  earValue: number;
}

export interface AttendanceRecord {
  id: string;
  workerId: string;
  timestamp: number;
  latitude: number;
  longitude: number;
  confidence: number;
  signature: string;
}

// ─── SDK ─────────────────────────────────────────────────────────────────────

export const BiometricSDK = {
  /** Initialises TFLite models and the on-device embedding store. */
  initialize(): Promise<boolean> {
    return DatalakeBiometric.initialize();
  },

  /** Enrols a worker by averaging embeddings from multiple base64-encoded JPEG frames. */
  enrollWorker(
    workerId: string,
    base64Frames: string[]
  ): Promise<EnrollResult> {
    return DatalakeBiometric.enrollWorker(workerId, base64Frames);
  },

  /** Runs face detection, liveness check, and 1-N matching against enrolled workers. */
  verifyWorker(base64Image: string): Promise<VerifyResult> {
    return DatalakeBiometric.verifyWorker(base64Image);
  },

  /** Evaluates MediaPipe face-mesh landmarks and returns blink/liveness state. */
  checkLiveness(landmarks: any[]): Promise<LivenessResult> {
    return DatalakeBiometric.checkLiveness(landmarks);
  },

  /** Records a verified attendance event locally and queues it for server sync. */
  logAttendance(
    workerId: string,
    latitude: number,
    longitude: number,
    confidence: number
  ): Promise<boolean> {
    return DatalakeBiometric.logAndQueueAttendance(
      workerId,
      latitude,
      longitude,
      confidence
    );
  },

  /** Returns all attendance records that have not yet been synced to the server. */
  getPendingRecords(): Promise<AttendanceRecord[]> {
    return DatalakeBiometric.getPendingAttendanceRecords();
  },

  /** Marks the given record IDs as synced so they are excluded from future uploads. */
  markSynced(recordIds: string[]): Promise<boolean> {
    return DatalakeBiometric.markRecordsSynced(recordIds);
  },
};
