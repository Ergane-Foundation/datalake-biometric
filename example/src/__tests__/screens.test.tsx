// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

// Native-only packages. The camera never mounts in these tests because no
// device is returned, so only the hooks need stubs.
jest.mock('react-native-vision-camera', () => ({
  Camera: 'Camera',
  useCameraDevice: () => null,
  useCameraPermission: () => ({
    hasPermission: true,
    requestPermission: jest.fn(),
  }),
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
import MenuScreen from '../screens/MenuScreen';
import EnrollScreen from '../screens/EnrollScreen';
import VerifyScreen from '../screens/VerifyScreen';

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe('MenuScreen', () => {
  it('navigates to the chosen screen', () => {
    const navigate = jest.fn();
    render(<MenuScreen navigate={navigate} initStatus="ready" />, {
      wrapper: Wrapper,
    });
    fireEvent.press(screen.getByText(/Enroll Worker/));
    expect(navigate).toHaveBeenCalledWith('enroll');
  });

  it('shows when initialization failed', () => {
    render(<MenuScreen navigate={jest.fn()} initStatus="failed" />, {
      wrapper: Wrapper,
    });
    expect(screen.getByText(/Init Failed/)).toBeTruthy();
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
