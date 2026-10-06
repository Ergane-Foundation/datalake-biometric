// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockNative = {
  initialize: jest.fn(async (_options?: object) => true),
  logAndQueueAttendance: jest.fn(
    async (_workerId: string, _confidence: number, _location?: object) => true
  ),
  getSecureRandomBytes: jest.fn(async (_count: number) => [0, 1, 2]),
};

jest.mock('../NativeDatalakeBiometric', () => ({
  __esModule: true,
  default: mockNative,
}));

// Imported after the mock is registered.
const { BiometricSDK } = require('../index') as typeof import('../index');

describe('BiometricSDK', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes initialize options through and validates their range', async () => {
    await BiometricSDK.initialize({ matchThreshold: 0.7 });
    expect(mockNative.initialize).toHaveBeenCalledWith({ matchThreshold: 0.7 });
    expect(() => BiometricSDK.initialize({ minQuality: 1.5 })).toThrow(
      RangeError
    );
    expect(() =>
      BiometricSDK.initialize({ matchThreshold: Number.NaN })
    ).toThrow(RangeError);
  });

  it('logs attendance with or without a location', async () => {
    await BiometricSDK.logAttendance('W-1', 0.9);
    await BiometricSDK.logAttendance('W-1', 0.9, {
      latitude: 10,
      longitude: 20,
    });
    expect(mockNative.logAndQueueAttendance).toHaveBeenNthCalledWith(
      1,
      'W-1',
      0.9,
      undefined
    );
    expect(mockNative.logAndQueueAttendance).toHaveBeenNthCalledWith(
      2,
      'W-1',
      0.9,
      {
        latitude: 10,
        longitude: 20,
      }
    );
  });

  it('builds a random source from native secure bytes', async () => {
    const randomInt = await BiometricSDK.createSecureRandomInt(3);
    expect(mockNative.getSecureRandomBytes).toHaveBeenCalledWith(3);
    expect([randomInt(2), randomInt(2), randomInt(2)]).toEqual([0, 1, 0]);
  });
});
