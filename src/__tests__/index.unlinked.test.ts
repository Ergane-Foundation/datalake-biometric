// SPDX-License-Identifier: Apache-2.0
import { expect, it, jest } from '@jest/globals';

// Simulates an app where the native part is not linked (or Jest, or the web).
jest.mock('../NativeDatalakeBiometric', () => ({
  __esModule: true,
  default: null,
}));

it('imports without throwing and fails with a clear error on first use', () => {
  const { BiometricSDK } = require('../index') as typeof import('../index');
  expect(() => BiometricSDK.getPendingRecords()).toThrow(
    'native module is not available'
  );
});
