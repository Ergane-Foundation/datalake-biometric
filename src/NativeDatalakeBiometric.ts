import { TurboModuleRegistry, type TurboModule } from 'react-native';

export interface Spec extends TurboModule {
  multiply(a: number, b: number): number;

  initialize(): Promise<boolean>;

  enrollWorker(
    workerId: string,
    base64Frames: Array<string>
  ): Promise<{ success: boolean; framesUsed: number }>;

  verifyWorker(base64Image: string): Promise<{
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
    latitude: number,
    longitude: number,
    confidence: number
  ): Promise<boolean>;

  getPendingAttendanceRecords(): Promise<
    Array<{
      id: string;
      workerId: string;
      timestamp: number;
      latitude: number;
      longitude: number;
      confidence: number;
      signature: string;
    }>
  >;

  markRecordsSynced(recordIds: Array<string>): Promise<boolean>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('DatalakeBiometric');
