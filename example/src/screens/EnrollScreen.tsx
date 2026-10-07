// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from 'react';
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Camera, useCameraPermission } from 'react-native-vision-camera';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BiometricSDK } from 'faceproof';
import { FaceCamera } from '../FaceCamera';
import { useFaceObservations, takePhotoBase64 } from '../camera';
import { useTheme } from '../ThemeContext';
import { s } from '../theme';
import type { Screen } from '../types';

// One-time note shown on the Enroll screen for the very first launch on a
// fresh install - warns the user about the Android first-grant black-preview
// quirk. Dismissing it writes the flag to AsyncStorage so it never re-appears.
const FIRST_LAUNCH_NOTE_KEY = '@enroll_first_launch_note_seen';

type Props = {
  navigate: (screen: Screen) => void;
  isActive: boolean;
};

const FRAMES = 3;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function EnrollScreen({ navigate, isActive }: Props) {
  const { colors } = useTheme();
  const camera = useRef<Camera>(null);
  const { frameProcessor, faceCount, getLastFaceBox } = useFaceObservations();
  // Enrolling with two faces in view could store the wrong person's template.
  const oneFace = faceCount === 1;
  const faceCountRef = useRef(faceCount);
  faceCountRef.current = faceCount;
  // Gate the first-launch note on actual camera permission so it never shows
  // when the user denied access - at that point there's no camera mount, so
  // the "black on first launch" warning is irrelevant.
  const { hasPermission } = useCameraPermission();

  const [workerId, setWorkerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [hasSeenNote, setHasSeenNote] = useState(true);
  const [noteLoaded, setNoteLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(FIRST_LAUNCH_NOTE_KEY)
      .then((seen) => {
        setHasSeenNote(seen === '1');
        setNoteLoaded(true);
      })
      .catch(() => setNoteLoaded(true));
  }, []);

  const showFirstLaunchNote = noteLoaded && hasPermission && !hasSeenNote;

  const dismissFirstLaunchNote = () => {
    setHasSeenNote(true);
    AsyncStorage.setItem(FIRST_LAUNCH_NOTE_KEY, '1').catch(() => {});
  };

  const canEnroll = workerId.trim().length > 0 && oneFace && !busy;

  const enroll = async () => {
    if (!camera.current || workerId.trim().length === 0) return;
    setBusy(true);
    setMessage(null);
    setProgress(0);
    try {
      const frames: string[] = [];
      for (let i = 0; i < FRAMES; i++) {
        if (faceCountRef.current !== 1) {
          throw new Error('Keep exactly one face in view while capturing.');
        }
        const b64 = await takePhotoBase64(camera.current);
        frames.push(b64);
        setProgress(i + 1);
        if (i < FRAMES - 1) await delay(500);
      }
      // One box for all frames: the person holds still during the short capture.
      const box = getLastFaceBox() ?? undefined;
      const result = await BiometricSDK.enrollWorker(
        workerId.trim(),
        frames,
        box
      );
      setMessage(
        result.success
          ? `Enrolled "${workerId.trim()}" using ${result.framesUsed} frame(s).`
          : 'Enrollment failed: no usable face frames.'
      );
    } catch (e: any) {
      setMessage(e?.message ?? 'Enrollment error.');
    } finally {
      setBusy(false);
      setProgress(0);
    }
  };

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 30 }}
    >
      <Text style={[s.title, { color: colors.text }]}>Enroll</Text>
      <Text style={[s.subtitle, { color: colors.textDim }]}>
        Capture {FRAMES} frames to store an embedding
      </Text>

      {showFirstLaunchNote && (
        <View
          style={[
            s.card,
            { backgroundColor: colors.cardBg, borderColor: colors.warn },
          ]}
        >
          <Text style={[s.cardTitle, { color: colors.warn, marginBottom: 6 }]}>
            NOTE
          </Text>
          <Text style={[s.cardBody, { color: colors.textDim }]}>
            If camera shows black on first launch, tap Back and re-enter -
            happens once per fresh install.
          </Text>
          <TouchableOpacity
            style={[
              s.button,
              { backgroundColor: colors.primary, marginTop: 12 },
            ]}
            onPress={dismissFirstLaunchNote}
          >
            <Text style={s.buttonText}>Got it</Text>
          </TouchableOpacity>
        </View>
      )}

      <TextInput
        value={workerId}
        onChangeText={setWorkerId}
        placeholder="Worker ID (e.g. W-1042)"
        placeholderTextColor={colors.textDim}
        autoCapitalize="characters"
        style={[
          styles.input,
          {
            backgroundColor: colors.cardBg,
            borderColor: colors.border,
            color: colors.text,
          },
        ]}
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
              { backgroundColor: oneFace ? colors.success : colors.danger },
            ]}
          >
            <Text style={[s.pillText, { color: '#FFFFFF' }]}>
              {faceCount === 0
                ? 'No face'
                : oneFace
                  ? 'Face detected'
                  : 'Too many faces'}
            </Text>
          </View>
          {busy && (
            <Text style={styles.capturing}>
              Capturing {progress}/{FRAMES}...
            </Text>
          )}
        </View>
      </FaceCamera>

      {message && (
        <View
          style={[
            s.card,
            { backgroundColor: colors.cardBg, borderColor: colors.border },
          ]}
        >
          <Text style={[s.cardBody, { color: colors.textDim }]}>{message}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[
          s.button,
          { backgroundColor: colors.primary },
          !canEnroll && { opacity: 0.4 },
        ]}
        disabled={!canEnroll}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canEnroll }}
        onPress={enroll}
      >
        <Text style={s.buttonText}>
          {busy ? 'Enrolling...' : `Capture ${FRAMES} & Enroll`}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.button, s.buttonGhost, { borderColor: colors.border }]}
        onPress={() => navigate('menu')}
      >
        <Text style={[s.buttonText, { color: colors.text }]}>Back to menu</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
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
