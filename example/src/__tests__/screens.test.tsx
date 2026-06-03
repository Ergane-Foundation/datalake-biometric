import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

// ─── Mocks — must be before any imports that pull in native code ──────────────

jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraDevices: () => ({ front: { id: 'front' } }),
  useFrameProcessor: () => null,
}));

jest.mock('react-native-vision-camera-face-detector', () => ({
  useFaceDetector: jest.fn(() => ({ detectFaces: jest.fn(() => []) })),
}));

jest.mock('react-native-worklets-core', () => ({
  useRunOnJS: jest.fn((fn: unknown) => fn),
}));

jest.mock('react-native-blob-util', () => ({
  fs: { readFile: jest.fn().mockResolvedValue('base64data') },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('datalake-biometric', () => ({
  BiometricSDK: {
    initialize:           jest.fn().mockResolvedValue(true),
    enrollWorker:         jest.fn().mockResolvedValue({ success: true, framesUsed: 3 }),
    verifyWorker:         jest.fn().mockResolvedValue({ status: 'MATCH', confidence: 0.95 }),
    logAttendance:        jest.fn().mockResolvedValue(undefined),
    getPendingRecords:    jest.fn().mockResolvedValue([]),
    markSynced:           jest.fn().mockResolvedValue(undefined),
    purgeSyncedRecords:   jest.fn().mockResolvedValue(true),
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { ThemeProvider } from '../ThemeContext';
import MenuScreen from '../screens/MenuScreen';
import EnrollScreen from '../screens/EnrollScreen';
import VerifyScreen from '../screens/VerifyScreen';

// Wrap with ThemeProvider for all tests
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

// ─── MenuScreen ───────────────────────────────────────────────────────────────

describe('MenuScreen', () => {
  const mockNavigate = jest.fn();

  beforeEach(() => mockNavigate.mockClear());

  test('renders all 4 menu items', () => {
    render(
      <MenuScreen navigate={mockNavigate} initStatus="ready" />,
      { wrapper: Wrapper }
    );
    expect(screen.getByText(/Enroll Worker/i)).toBeTruthy();
    expect(screen.getByText(/Verify/i)).toBeTruthy();
    expect(screen.getByText(/Benchmark/i)).toBeTruthy();
    expect(screen.getByText(/Sync/i)).toBeTruthy();
  });

  test('calls navigate on menu item press', () => {
    render(
      <MenuScreen navigate={mockNavigate} initStatus="ready" />,
      { wrapper: Wrapper }
    );
    fireEvent.press(screen.getByText(/Enroll Worker/i));
    expect(mockNavigate).toHaveBeenCalledWith('enroll');
  });

  test('shows Init Failed when initStatus is failed', () => {
    render(
      <MenuScreen navigate={mockNavigate} initStatus="failed" />,
      { wrapper: Wrapper }
    );
    expect(screen.getByText(/Init Failed/i)).toBeTruthy();
  });
});

// ─── EnrollScreen ─────────────────────────────────────────────────────────────

describe('EnrollScreen', () => {
  test('capture button disabled with no worker ID', () => {
    render(
      <EnrollScreen navigate={jest.fn()} isActive={true} />,
      { wrapper: Wrapper }
    );
    const btn = screen.getByText(/Capture/i);
    // WorkerId is empty → parent TouchableOpacity has disabled=true
    expect(btn.props.disabled ?? btn.parent?.props.disabled).toBeTruthy();
  });
});

// ─── VerifyScreen ─────────────────────────────────────────────────────────────

describe('VerifyScreen', () => {
  afterEach(() => jest.useRealTimers());

  test('shows a liveness challenge instruction on mount', () => {
    render(
      <VerifyScreen navigate={jest.fn()} isActive={true} onResult={jest.fn()} />,
      { wrapper: Wrapper }
    );
    // Challenge is randomized — one of blink / smile / turn must be shown.
    const hasBlink = screen.queryByText(/blink/i) !== null;
    const hasSmile = screen.queryByText(/smile/i) !== null;
    const hasTurn  = screen.queryByText(/turn your head/i) !== null;
    expect(hasBlink || hasSmile || hasTurn).toBe(true);
  });

  test('shows SPOOF after liveness timeout', async () => {
    jest.useFakeTimers();
    render(
      <VerifyScreen navigate={jest.fn()} isActive={true} onResult={jest.fn()} />,
      { wrapper: Wrapper }
    );
    jest.advanceTimersByTime(12001);
    await waitFor(() => {
      expect(screen.getByText(/SPOOF|NO LIVENESS/i)).toBeTruthy();
    });
  });
});
