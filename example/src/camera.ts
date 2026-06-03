import { useCallback, useRef, useState } from 'react';
import { useFrameProcessor, type Camera } from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { useRunOnJS } from 'react-native-worklets-core';
import ReactNativeBlobUtil from 'react-native-blob-util';

export type LivenessChallenge = 'blink' | 'smile' | 'turn';

export type FaceState = {
  faceInFrame: boolean;
  eyesOpen: boolean;
  blinkCount: number;
  smileDetected: boolean;
  headTurned: boolean;
};

export type FaceHint = { nx: number; ny: number; nw: number; nh: number };

const EYE_CLOSED = 0.3;
const EYE_OPEN = 0.7;
const SMILE_THRESHOLD = 0.7;
const YAW_THRESHOLD = 20; // degrees

/**
 * Live face + multi-challenge liveness state driven by the Vision Camera frame processor.
 *
 * Blink:  counted on open → closed → open transition (2 blinks = liveness proof).
 * Smile:  sticky flag set once smilingProbability > 0.7.
 * Turn:   sticky flag set once abs(headEulerAngleY) > 20 degrees.
 *
 * The hook also stashes the most recent normalized face bounding box (0..1 coords)
 * — call `getLastHint()` when capturing a photo and pass it through to
 * `BiometricSDK.verifyWorker(b64, hint)` / `enrollWorker(...)` so the native side
 * can crop tightly around the actual face instead of falling back to a heuristic.
 */
export function useFaceState() {
  const [state, setState] = useState<FaceState>({
    faceInFrame: false,
    eyesOpen: true,
    blinkCount: 0,
    smileDetected: false,
    headTurned: false,
  });
  const wasClosed = useRef(false);
  const lastHintRef = useRef<FaceHint | null>(null);

  const { detectFaces } = useFaceDetector({
    performanceMode: 'fast',
    classificationMode: 'all',
    landmarkMode: 'none',
    contourMode: 'none',
  });

  // Runs on the JS thread; receives only primitives from the frame-processor worklet.
  const onFace = useRunOnJS(
    (
      count: number,
      left: number,
      right: number,
      nx: number,
      ny: number,
      nw: number,
      nh: number,
      smiling: number,
      yaw: number
    ) => {
      if (count === 0) {
        lastHintRef.current = null;
      } else if (nw > 0 && nh > 0) {
        lastHintRef.current = { nx, ny, nw, nh };
      }
      setState((prev) => {
        if (count === 0) {
          return prev.faceInFrame ? { ...prev, faceInFrame: false } : prev;
        }
        const avg = (left + right) / 2;
        const closed = avg < EYE_CLOSED;
        const open = avg > EYE_OPEN;

        let blink = prev.blinkCount;
        if (closed) {
          wasClosed.current = true;
        } else if (open && wasClosed.current) {
          wasClosed.current = false;
          blink = prev.blinkCount + 1;
        }
        const eyesOpen = !closed;

        // Sticky flags — set once and stay true until reset()
        const smileDetected = prev.smileDetected || smiling > SMILE_THRESHOLD;
        const headTurned = prev.headTurned || Math.abs(yaw) > YAW_THRESHOLD;

        if (
          prev.faceInFrame &&
          prev.eyesOpen === eyesOpen &&
          blink === prev.blinkCount &&
          prev.smileDetected === smileDetected &&
          prev.headTurned === headTurned
        ) {
          return prev;
        }
        return { faceInFrame: true, eyesOpen, blinkCount: blink, smileDetected, headTurned };
      });
    },
    []
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      const faces = detectFaces(frame);
      if (!faces || faces.length === 0) {
        onFace(0, 1, 1, 0, 0, 0, 0, 0, 0);
        return;
      }
      const f = faces[0];
      if (!f) {
        onFace(0, 1, 1, 0, 0, 0, 0, 0, 0);
        return;
      }
      const left =
        typeof f.leftEyeOpenProbability === 'number'
          ? f.leftEyeOpenProbability
          : 1;
      const right =
        typeof f.rightEyeOpenProbability === 'number'
          ? f.rightEyeOpenProbability
          : 1;
      const smiling =
        typeof f.smilingProbability === 'number' ? f.smilingProbability : 0;
      const yaw =
        typeof f.headEulerAngleY === 'number' ? f.headEulerAngleY : 0;
      const fw = frame.width;
      const fh = frame.height;
      const b = f.bounds;
      // The front-camera preview is mirrored but `takePhoto` saves the un-mirrored
      // JPEG. Without this flip, the tight crop lands on the wrong horizontal side.
      const mirrored =
        (frame as unknown as { isMirrored?: boolean }).isMirrored === true;
      const nx = fw > 0 ? (mirrored ? 1 - (b.x + b.width) / fw : b.x / fw) : 0;
      const ny = fh > 0 ? b.y / fh : 0;
      const nw = fw > 0 ? b.width / fw : 0;
      const nh = fh > 0 ? b.height / fh : 0;
      onFace(faces.length, left, right, nx, ny, nw, nh, smiling, yaw);
    },
    [detectFaces, onFace]
  );

  const reset = useCallback(() => {
    wasClosed.current = false;
    lastHintRef.current = null;
    setState({ faceInFrame: false, eyesOpen: true, blinkCount: 0, smileDetected: false, headTurned: false });
  }, []);

  const getLastHint = useCallback(() => lastHintRef.current, []);

  return { frameProcessor, ...state, reset, getLastHint };
}

/** Capture a still from the camera and return it as a base64 JPEG string. */
export async function takePhotoBase64(camera: Camera): Promise<string> {
  const photo = await camera.takePhoto({ flash: 'off' });
  const path = photo.path.startsWith('file://')
    ? photo.path.replace('file://', '')
    : photo.path;
  return ReactNativeBlobUtil.fs.readFile(path, 'base64');
}
