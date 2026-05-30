import { forwardRef, useEffect, type ReactNode } from 'react';
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

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  if (!hasPermission) {
    return (
      <View style={[s.card, { alignItems: 'center' }]}>
        <Text style={s.cardBody}>Camera permission is required.</Text>
        <TouchableOpacity style={s.button} onPress={requestPermission}>
          <Text style={s.buttonText}>Grant camera access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (device == null) {
    return (
      <View style={[s.card, { alignItems: 'center' }]}>
        <Text style={s.cardBody}>No front camera found on this device.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Camera
        ref={ref}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        photo={true}
        frameProcessor={frameProcessor}
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
