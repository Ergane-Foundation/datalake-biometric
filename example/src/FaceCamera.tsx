import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  type CameraProps,
} from 'react-native-vision-camera';
import { s } from './theme';

type Props = {
  frameProcessor?: CameraProps['frameProcessor'];
  isActive: boolean;
  children?: ReactNode;
};

export const FaceCamera = forwardRef<Camera, Props>(function FaceCamera(
  { frameProcessor, isActive, children },
  ref
) {
  const device = useCameraDevice('front');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [granted, setGranted] = useState(hasPermission);
  const [asked, setAsked] = useState(false);
  // First-grant users have to wait ~600 ms after permission flips before the
  // <Camera /> mounts, so Android's SurfaceView completes its first layout
  // pass — otherwise the capture session opens against an unlaid-out surface
  // and the preview stays black even though the OS shows the camera as active.
  const [readyToMount, setReadyToMount] = useState(hasPermission);
  // Safety net: bump once if onPreviewStarted hasn't fired ~1.5 s after mount.
  const [sessionKey, setSessionKey] = useState(0);
  const previewStartedRef = useRef(false);
  const remountTriedRef = useRef(false);

  useEffect(() => {
    if (hasPermission) setGranted(true);
  }, [hasPermission]);

  const ask = useCallback(async () => {
    setAsked(true);
    const ok = await requestPermission();
    if (ok) setGranted(true);
  }, [requestPermission]);

  useEffect(() => {
    if (!granted && !asked) ask();
  }, [granted, asked, ask]);

  useEffect(() => {
    if (granted && !readyToMount) {
      const id = setTimeout(() => setReadyToMount(true), 600);
      return () => clearTimeout(id);
    }
  }, [granted, readyToMount]);

  useEffect(() => {
    if (!readyToMount || device == null) return;
    previewStartedRef.current = false;
    const id = setTimeout(() => {
      if (!previewStartedRef.current && !remountTriedRef.current) {
        remountTriedRef.current = true;
        setSessionKey((k) => k + 1);
      }
    }, 1500);
    return () => clearTimeout(id);
  }, [readyToMount, device, sessionKey]);

  if (!granted) {
    return (
      <View style={[s.card, { alignItems: 'center' }]}>
        <Text style={s.cardBody}>Camera permission is required.</Text>
        <TouchableOpacity style={s.button} onPress={ask}>
          <Text style={s.buttonText}>Grant camera access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!readyToMount || device == null) {
    return (
      <View style={[s.card, { alignItems: 'center' }]}>
        <Text style={s.cardBody}>Starting camera…</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Camera
        key={sessionKey}
        ref={ref}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        photo={true}
        frameProcessor={frameProcessor}
        onError={(e) => {
          console.warn('[FaceCamera] onError', e?.message ?? e);
        }}
        onPreviewStarted={() => {
          previewStartedRef.current = true;
        }}
      />
      <View style={StyleSheet.absoluteFill}>{children}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
    marginBottom: 16,
  },
});
