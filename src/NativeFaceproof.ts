// SPDX-License-Identifier: Apache-2.0
import { TurboModuleRegistry, type TurboModule } from 'react-native';

/**
 * Native module contract. React Native codegen reads this file to generate the
 * Android and iOS bindings, so every change here is a native bridge change and
 * must be mirrored in `android/` and `ios/`.
 *
 * App code should use the typed wrapper in `index.tsx`, not this spec directly.
 */
export interface Spec extends TurboModule {
  initialize(options?: {
    matchThreshold?: number;
    minQuality?: number;
  }): Promise<boolean>;

  enrollWorker(
    workerId: string,
    base64Frames: Array<string>,
    hint?: { nx: number; ny: number; nw: number; nh: number }
  ): Promise<{ success: boolean; framesUsed: number }>;

  verifyWorker(
    base64Image: string,
    hint?: { nx: number; ny: number; nw: number; nh: number }
  ): Promise<{
    status: string;
    workerId?: string;
    confidence?: number;
    inferenceMs?: number;
    totalMs?: number;
    quality?: number;
  }>;

  checkLiveness(landmarks: Array<Array<number>>): Promise<{
    isLive: boolean;
    isBlink: boolean;
    blinkCount: number;
    earValue: number;
  }>;

  logAndQueueAttendance(
    workerId: string,
    confidence: number,
    location?: { latitude: number; longitude: number }
  ): Promise<boolean>;

  getPendingAttendanceRecords(): Promise<
    Array<{
      id: string;
      workerId: string;
      timestamp: number;
      latitude?: number;
      longitude?: number;
      confidence: number;
      deviceId: string;
      signature: string;
    }>
  >;

  markRecordsSynced(recordIds: Array<string>): Promise<boolean>;

  purgeSyncedRecords(): Promise<boolean>;

  getSecureRandomBytes(count: number): Promise<Array<number>>;
}

// `get` (not `getEnforcing`) so that importing the package never throws, for
// example in Jest or the web build. `index.tsx` raises a clear error on first use.
export default TurboModuleRegistry.get<Spec>('Faceproof');
