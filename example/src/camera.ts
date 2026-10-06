// SPDX-License-Identifier: Apache-2.0
import { useCallback, useRef, useState } from 'react';
import { useFrameProcessor, type Camera } from 'react-native-vision-camera';
import { useFaceDetector } from 'react-native-vision-camera-face-detector';
import { useRunOnJS } from 'react-native-worklets-core';
import ReactNativeBlobUtil from 'react-native-blob-util';
import type { FaceBox, FaceObservation } from 'datalake-biometric';
import { readPhotoAndDelete } from './photoFile';

/**
 * Reference wiring between Vision Camera, ML Kit face detection and the SDK.
 *
 * The frame processor runs on the camera thread and sends only numbers to JS.
 * Each frame becomes a {@link FaceObservation} for the SDK's liveness session,
 * and the face box of the most recent single-face frame is kept so the native
 * side can crop around the real face.
 */
export function useFaceObservations(
  onObservation?: (observation: FaceObservation) => void
) {
  const [faceCount, setFaceCount] = useState(0);
  const lastBoxRef = useRef<FaceBox | null>(null);
  const onObservationRef = useRef(onObservation);
  onObservationRef.current = onObservation;

  const { detectFaces } = useFaceDetector({
    performanceMode: 'fast',
    classificationMode: 'all',
    landmarkMode: 'none',
    contourMode: 'none',
  });

  const handleFrame = useRunOnJS(
    (
      count: number,
      leftEyeOpen: number,
      rightEyeOpen: number,
      smiling: number,
      yaw: number,
      nx: number,
      ny: number,
      nw: number,
      nh: number
    ) => {
      // A box is only meaningful when exactly one face is visible.
      lastBoxRef.current =
        count === 1 && nw > 0 && nh > 0 ? { nx, ny, nw, nh } : null;
      setFaceCount((prev) => (prev === count ? prev : count));
      // ML Kit reports -1 when a classification is unavailable for a frame.
      const known = (v: number) => (v >= 0 ? v : undefined);
      onObservationRef.current?.({
        faceCount: count,
        leftEyeOpenProbability: known(leftEyeOpen),
        rightEyeOpenProbability: known(rightEyeOpen),
        smilingProbability: known(smiling),
        headYawDegrees: count === 1 ? yaw : undefined,
        timestampMs: Date.now(),
      });
    },
    []
  );

  const frameProcessor = useFrameProcessor(
    (frame) => {
      'worklet';
      const faces = detectFaces(frame);
      const f = faces && faces.length > 0 ? faces[0] : undefined;
      if (!f) {
        handleFrame(0, -1, -1, -1, 0, 0, 0, 0, 0);
        return;
      }
      const num = (v: unknown) => (typeof v === 'number' ? v : -1);
      const fw = frame.width;
      const fh = frame.height;
      const b = f.bounds;
      // The front-camera preview is mirrored but `takePhoto` saves the
      // un-mirrored JPEG, so the box is flipped horizontally to match the photo.
      const mirrored =
        (frame as unknown as { isMirrored?: boolean }).isMirrored === true;
      const nx = fw > 0 ? (mirrored ? 1 - (b.x + b.width) / fw : b.x / fw) : 0;
      const ny = fh > 0 ? b.y / fh : 0;
      const nw = fw > 0 ? b.width / fw : 0;
      const nh = fh > 0 ? b.height / fh : 0;
      handleFrame(
        faces.length,
        num(f.leftEyeOpenProbability),
        num(f.rightEyeOpenProbability),
        num(f.smilingProbability),
        typeof f.yawAngle === 'number' ? f.yawAngle : 0,
        nx,
        ny,
        nw,
        nh
      );
    },
    [detectFaces, handleFrame]
  );

  const getLastFaceBox = useCallback(() => lastBoxRef.current, []);

  return { frameProcessor, faceCount, getLastFaceBox };
}

/**
 * Captures a still and returns it as a base64 JPEG string.
 * The temporary file Vision Camera writes is deleted before this returns.
 */
export async function takePhotoBase64(camera: Camera): Promise<string> {
  const photo = await camera.takePhoto({ flash: 'off' });
  return readPhotoAndDelete(photo.path, ReactNativeBlobUtil.fs);
}
