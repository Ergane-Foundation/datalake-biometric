// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

// Native-only packages. The camera never mounts in these tests because no
// device is returned, so only the hooks need stubs. The permission object is
// shared so a test can flip hasPermission and get the denied branch.
const mockCameraPermission = {
  hasPermission: true,
  requestPermission: jest.fn(async () => true),
};
jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraDevice: () => null,
  useCameraPermission: () => mockCameraPermission,
  useFrameProcessor: () => null,
}));
jest.mock('react-native-vision-camera-face-detector', () => ({
  useFaceDetector: () => ({ detectFaces: () => [] }),
}));
jest.mock('react-native-worklets-core', () => ({
  useRunOnJS: (fn: unknown) => fn,
}));
jest.mock('react-native-blob-util', () => ({ fs: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: () => () => {} },
}));

// Keep the real liveness logic; replace only the calls into native code.
jest.mock('faceproof', () => ({
  ...jest.requireActual('faceproof'),
  BiometricSDK: {
    getPendingRecords: jest.fn(async () => []),
    // Always index 0: picks blink, then smile.
    createSecureRandomInt: jest.fn(async () => () => 0),
  },
}));

import { ThemeProvider } from '../ThemeContext';
import { FaceCamera } from '../FaceCamera';
import MenuScreen from '../screens/MenuScreen';
import EnrollScreen from '../screens/EnrollScreen';
import VerifyScreen from '../screens/VerifyScreen';
import SyncScreen from '../screens/SyncScreen';

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe('MenuScreen', () => {
  it('navigates to the chosen screen', () => {
    const navigate = jest.fn();
    render(<MenuScreen navigate={navigate} initStatus="ready" />, {
      wrapper: Wrapper,
    });
    fireEvent.press(screen.getByRole('button', { name: /Enroll Worker/ }));
    expect(navigate).toHaveBeenCalledWith('enroll');
  });

  it('shows when initialization failed', () => {
    render(<MenuScreen navigate={jest.fn()} initStatus="failed" />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText(/Init Failed/)).toBeTruthy();
  });

  it('exposes every menu entry as a button', () => {
    render(<MenuScreen navigate={jest.fn()} initStatus="ready" />, {
      wrapper: Wrapper,
    });
    for (const name of [
      /Enroll Worker/,
      /Verify \+ Liveness/,
      /Benchmark/,
      /Sync/,
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('marks the active theme as selected and switches on press', () => {
    render(<MenuScreen navigate={jest.fn()} initStatus="ready" />, {
      wrapper: Wrapper,
    });
    // The default is "auto", and an emoji alone tells a screen reader nothing.
    expect(
      screen.getByRole('button', { name: 'System theme', selected: true })
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Dark theme' }));
    expect(
      screen.getByRole('button', { name: 'Dark theme', selected: true })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'System theme', selected: false })
    ).toBeTruthy();
  });
});

describe('EnrollScreen', () => {
  it('disables capture while no ID is entered and no face is in view', async () => {
    render(<EnrollScreen navigate={jest.fn()} isActive />, {
      wrapper: Wrapper,
    });
    const button = await screen.findByRole('button', {
      name: /Capture 3 & Enroll/,
    });
    expect(button.props.accessibilityState?.disabled).toBe(true);
  });

  it('offers Back to menu as a button', async () => {
    const navigate = jest.fn();
    render(<EnrollScreen navigate={navigate} isActive />, {
      wrapper: Wrapper,
    });
    fireEvent.press(
      await screen.findByRole('button', { name: 'Back to menu' })
    );
    expect(navigate).toHaveBeenCalledWith('menu');
  });
});

describe('SyncScreen', () => {
  it('announces the sync button as disabled until it is configured', async () => {
    render(<SyncScreen navigate={jest.fn()} />, { wrapper: Wrapper });
    // Without an endpoint and a token nothing may be uploaded.
    expect(
      await screen.findByRole('button', {
        name: /Enter endpoint and token to sync/,
        disabled: true,
      })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Refresh', disabled: false })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Back to menu', disabled: false })
    ).toBeTruthy();
  });
});

describe('FaceCamera', () => {
  afterEach(() => {
    mockCameraPermission.hasPermission = true;
    mockCameraPermission.requestPermission = jest.fn(async () => true);
  });

  it('offers a button to ask for the camera when permission is missing', async () => {
    mockCameraPermission.hasPermission = false;
    // The app asks once on mount; a refusal leaves the button on screen.
    mockCameraPermission.requestPermission = jest.fn(async () => false);
    render(<FaceCamera isActive={false} />, { wrapper: Wrapper });
    await act(async () => {});
    expect(
      screen.getByRole('button', { name: /Grant camera access/ })
    ).toBeTruthy();
  });
});

describe('VerifyScreen', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts a session with the challenges chosen by the random source', async () => {
    render(
      <VerifyScreen navigate={jest.fn()} isActive onResult={jest.fn()} />,
      {
        wrapper: Wrapper,
      }
    );
    expect(await screen.findByText('Step 1 of 2: Blink twice')).toBeTruthy();
  });

  it('fails the session after the timeout even without camera frames', async () => {
    render(
      <VerifyScreen navigate={jest.fn()} isActive onResult={jest.fn()} />,
      {
        wrapper: Wrapper,
      }
    );
    await screen.findByText(/Step 1 of 2/);
    await act(async () => {
      jest.advanceTimersByTime(13_000);
    });
    expect(screen.getByText('Not verified')).toBeTruthy();
    expect(screen.getByText(/not completed within 12 s/)).toBeTruthy();
  });
});
