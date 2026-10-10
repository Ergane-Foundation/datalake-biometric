// SPDX-License-Identifier: Apache-2.0
export type Screen = 'menu' | 'enroll' | 'verify' | 'benchmark' | 'sync';

export type InitStatus = 'pending' | 'ready' | 'failed';

export type InitError = {
  code?: string;
  message?: string;
};
