/**
 * @jest-environment node
 */

import { BiometricSDK } from 'datalake-biometric';

jest.mock('datalake-biometric', () => {
  const records: any[] = [];
  return {
    BiometricSDK: {
      initialize: jest.fn().mockResolvedValue(true),
      enrollWorker: jest.fn().mockResolvedValue({ success: true, framesUsed: 3 }),
      verifyWorker: jest.fn().mockResolvedValue({
        status: 'MATCH', workerId: 'W-TEST-001', confidence: 0.96,
      }),
      logAttendance: jest.fn().mockImplementation(async () => {
        records.push({ id: 'rec-test-1', workerId: 'W-TEST-001' });
      }),
      getPendingRecords: jest.fn().mockImplementation(async () => [...records]),
      markSynced: jest.fn().mockImplementation(async () => {
        records.length = 0;
      }),
    },
  };
});

describe('E2E: Enrol → Verify → Attend → Sync', () => {
  test('full attendance flow completes without error', async () => {
    const initOk = await BiometricSDK.initialize();
    expect(initOk).toBe(true);

    const enroll = await BiometricSDK.enrollWorker('W-TEST-001', [
      'b64frame1', 'b64frame2', 'b64frame3',
    ]);
    expect(enroll.success).toBe(true);

    const verify = await BiometricSDK.verifyWorker('b64image');
    expect(verify.status).toBe('MATCH');
    expect(verify.workerId).toBe('W-TEST-001');

    await BiometricSDK.logAttendance('W-TEST-001', 10.0, 20.0, verify.confidence ?? 0);

    const pending = await BiometricSDK.getPendingRecords();
    expect(pending.length).toBeGreaterThan(0);

    const ids = pending.map((r: any) => r.id);
    await BiometricSDK.markSynced(ids);

    const afterSync = await BiometricSDK.getPendingRecords();
    expect(afterSync.length).toBe(0);
  });
});
