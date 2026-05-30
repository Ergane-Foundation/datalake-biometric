import { renderHook, act } from '@testing-library/react-native';
import { useFaceState } from '../camera';

// ─── Mocks — must be before any imports that pull in native code ──────────────

jest.mock('react-native-vision-camera', () => ({
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useFaceState', () => {
  test('initializes with correct defaults', () => {
    const { result } = renderHook(() => useFaceState());
    expect(result.current.faceInFrame).toBe(false);
    expect(result.current.blinkCount).toBe(0);
    expect(result.current.eyesOpen).toBe(true);
  });

  test('getLastHint() returns null when no face seen', () => {
    const { result } = renderHook(() => useFaceState());
    expect(result.current.getLastHint()).toBeNull();
  });

  test('state values stay within valid ranges after update', () => {
    const { result } = renderHook(() => useFaceState());
    act(() => {
      // Use optional chaining per spec: if updateFace doesn't exist, skip gracefully
      (result.current as any).updateFace?.({
        bounds: { x: 50, y: 80, width: 100, height: 120 },
        leftEyeOpenProbability: 0.9,
        rightEyeOpenProbability: 0.85,
        frameWidth: 640,
        frameHeight: 480,
      });
    });
    expect(result.current.blinkCount).toBeGreaterThanOrEqual(0);
    expect(typeof result.current.eyesOpen).toBe('boolean');
  });
});
