// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from '@testing-library/react-native';
import type { FaceObservation } from 'faceproof';

// The frame-processor worklet is native; here the hook's JS-side handler is
// captured from useRunOnJS and called directly with what the worklet would send.
let mockHandleFrame: (...args: number[]) => void = () => {};

jest.mock('react-native-vision-camera', () => ({
  useFrameProcessor: () => null,
}));
jest.mock('react-native-vision-camera-face-detector', () => ({
  useFaceDetector: () => ({ detectFaces: () => [] }),
}));
jest.mock('react-native-worklets-core', () => ({
  useRunOnJS: (fn: (...args: number[]) => void) => {
    mockHandleFrame = fn;
    return fn;
  },
}));
jest.mock('react-native-blob-util', () => ({ fs: {} }));

import { useFaceObservations } from '../camera';

// Argument order: count, leftEye, rightEye, smiling, yaw, nx, ny, nw, nh.
describe('useFaceObservations', () => {
  it('forwards each frame as a FaceObservation', () => {
    const seen: FaceObservation[] = [];
    const { result } = renderHook(() =>
      useFaceObservations((o) => seen.push(o))
    );
    act(() => mockHandleFrame(1, 0.9, 0.8, -1, -25, 0.1, 0.2, 0.3, 0.4));

    expect(result.current.faceCount).toBe(1);
    expect(seen[0]).toMatchObject({
      faceCount: 1,
      leftEyeOpenProbability: 0.9,
      rightEyeOpenProbability: 0.8,
      smilingProbability: undefined, // -1 means "not available"
      headYawDegrees: -25,
    });
    expect(result.current.getLastFaceBox()).toEqual({
      nx: 0.1,
      ny: 0.2,
      nw: 0.3,
      nh: 0.4,
    });
  });

  it('drops the face box when zero or several faces are visible', () => {
    const { result } = renderHook(() => useFaceObservations());
    act(() => mockHandleFrame(1, 1, 1, 0, 0, 0.1, 0.2, 0.3, 0.4));
    act(() => mockHandleFrame(2, 1, 1, 0, 0, 0.1, 0.2, 0.3, 0.4));
    expect(result.current.faceCount).toBe(2);
    expect(result.current.getLastFaceBox()).toBeNull();
  });
});
