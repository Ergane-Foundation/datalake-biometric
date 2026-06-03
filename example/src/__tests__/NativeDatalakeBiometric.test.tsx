import { NativeModules } from 'react-native';
import { BiometricSDK } from 'datalake-biometric';

jest.mock('react-native', () => ({
  NativeModules: {
    DatalakeBiometric: {
      initialize:             jest.fn(),
      enrollWorker:           jest.fn(),
      verifyWorker:           jest.fn(),
      logAttendance:          jest.fn(),
      getPendingRecords:      jest.fn(),
      markSynced:             jest.fn(),
      purgeSyncedRecords:     jest.fn(),
    },
  },
  Platform: { OS: 'android' },
}));

jest.mock('datalake-biometric', () => ({
  BiometricSDK: {
    initialize:           jest.fn(),
    enrollWorker:         jest.fn(),
    verifyWorker:         jest.fn(),
    logAttendance:        jest.fn(),
    getPendingRecords:    jest.fn(),
    markSynced:           jest.fn(),
    purgeSyncedRecords:   jest.fn(),
  },
}));

describe('BiometricSDK', () => {
  beforeEach(() => jest.clearAllMocks());

  test('initialize() resolves true', async () => {
    (BiometricSDK.initialize as jest.Mock).mockResolvedValue(true);
    const result = await BiometricSDK.initialize();
    expect(result).toBe(true);
  });

  test('enrollWorker() called with workerId and frames', async () => {
    const mock = BiometricSDK.enrollWorker as jest.Mock;
    mock.mockResolvedValue({ success: true, framesUsed: 3 });
    const frames = ['b64frame1', 'b64frame2', 'b64frame3'];
    const result = await BiometricSDK.enrollWorker('W-1042', frames);
    expect(result.success).toBe(true);
    expect(mock).toHaveBeenCalledWith('W-1042', frames, undefined);
  });

  test('verifyWorker() returns MATCH with confidence > 0.9', async () => {
    (BiometricSDK.verifyWorker as jest.Mock).mockResolvedValue({
      status: 'MATCH', workerId: 'W-1042', confidence: 0.95,
    });
    const result = await BiometricSDK.verifyWorker('b64image');
    expect(result.status).toBe('MATCH');
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  test('verifyWorker() with hint passes normalized box', async () => {
    const mock = BiometricSDK.verifyWorker as jest.Mock;
    mock.mockResolvedValue({ status: 'NO_FACE' });
    const hint = { nx: 0.1, ny: 0.2, nw: 0.6, nh: 0.7 };
    await BiometricSDK.verifyWorker('b64image', hint);
    expect(mock).toHaveBeenCalledWith('b64image', hint);
  });

  test('logAttendance() called with correct args', async () => {
    const mock = BiometricSDK.logAttendance as jest.Mock;
    mock.mockResolvedValue(undefined);
    await BiometricSDK.logAttendance('W-1042', 10.0, 20.0, 0.95);
    expect(mock).toHaveBeenCalledWith('W-1042', 10.0, 20.0, 0.95);
  });

  test('getPendingRecords() returns records array', async () => {
    const mock = BiometricSDK.getPendingRecords as jest.Mock;
    mock.mockResolvedValue([{
      id: 'rec-1', workerId: 'W-1042',
      timestamp: Date.now(), latitude: 10.0, longitude: 20.0,
      confidence: 0.95, signature: 'hmac-abc',
    }]);
    const records = await BiometricSDK.getPendingRecords();
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]!.workerId).toBe('W-1042');
  });

  test('markSynced() called with ids array', async () => {
    const mock = BiometricSDK.markSynced as jest.Mock;
    mock.mockResolvedValue(undefined);
    await BiometricSDK.markSynced(['rec-1', 'rec-2']);
    expect(mock).toHaveBeenCalledWith(['rec-1', 'rec-2']);
  });

  test('purgeSyncedRecords() resolves true', async () => {
    (BiometricSDK.purgeSyncedRecords as jest.Mock).mockResolvedValue(true);
    const result = await BiometricSDK.purgeSyncedRecords();
    expect(result).toBe(true);
    expect(BiometricSDK.purgeSyncedRecords).toHaveBeenCalledTimes(1);
  });
});

// Keep NativeModules in scope so TS doesn't strip the import
void NativeModules;
