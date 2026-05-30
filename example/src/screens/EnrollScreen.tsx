import { useRef, useState } from 'react';
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { BiometricSDK } from 'datalake-biometric';
import { FaceCamera } from '../FaceCamera';
import { useFaceState, takePhotoBase64 } from '../camera';
import { colors, s } from '../theme';
import type { Screen } from '../types';

type Props = {
  navigate: (screen: Screen) => void;
  isActive: boolean;
};

const FRAMES = 3;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function EnrollScreen({ navigate, isActive }: Props) {
  const camera = useRef<Camera>(null);
  const { frameProcessor, faceInFrame, getLastHint } = useFaceState();

  const [workerId, setWorkerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const canEnroll = workerId.trim().length > 0 && faceInFrame && !busy;

  const enroll = async () => {
    if (!camera.current || workerId.trim().length === 0) return;
    setBusy(true);
    setMessage(null);
    setProgress(0);
    try {
      const frames: string[] = [];
      for (let i = 0; i < FRAMES; i++) {
        const b64 = await takePhotoBase64(camera.current);
        frames.push(b64);
        setProgress(i + 1);
        if (i < FRAMES - 1) await delay(500);
      }
      // Single hint applied to all 3 frames — face is held still during capture.
      const hint = getLastHint() ?? undefined;
      const result = await BiometricSDK.enrollWorker(
        workerId.trim(),
        frames,
        hint
      );
      setMessage(
        result.success
          ? `✅ Enrolled "${workerId.trim()}" using ${result.framesUsed} frame(s).`
          : '❌ Enrolment failed — no usable face frames.'
      );
    } catch (e: any) {
      setMessage(`❌ ${e?.message ?? 'Enrolment error'}`);
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 30 }}>
      <Text style={s.title}>Enroll Worker</Text>
      <Text style={s.subtitle}>
        Capture {FRAMES} frames to store an embedding
      </Text>

      <TextInput
        value={workerId}
        onChangeText={setWorkerId}
        placeholder="Worker ID (e.g. W-1042)"
        placeholderTextColor={colors.textDim}
        autoCapitalize="characters"
        style={styles.input}
      />

      <FaceCamera
        ref={camera}
        isActive={isActive}
        frameProcessor={frameProcessor}
      >
        <View style={styles.overlay}>
          <View
            style={[
              s.pill,
              { backgroundColor: faceInFrame ? '#0E3D2E' : '#3D1414' },
            ]}
          >
            <Text
              style={[
                s.pillText,
                { color: faceInFrame ? colors.success : colors.danger },
              ]}
            >
              {faceInFrame ? '● Face detected' : '○ No face'}
            </Text>
          </View>
          {busy && (
            <Text style={styles.capturing}>
              Capturing {progress}/{FRAMES}…
            </Text>
          )}
        </View>
      </FaceCamera>

      {message && (
        <View style={s.card}>
          <Text style={s.cardBody}>{message}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[s.button, !canEnroll && { opacity: 0.4 }]}
        disabled={!canEnroll}
        onPress={enroll}
      >
        <Text style={s.buttonText}>
          {busy ? 'Enrolling…' : `Capture ${FRAMES} & Enroll`}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.button, s.buttonGhost]}
        onPress={() => navigate('menu')}
      >
        <Text style={[s.buttonText, s.buttonGhostText]}>← Back to menu</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 16,
    marginBottom: 16,
  },
  overlay: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  capturing: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
});
