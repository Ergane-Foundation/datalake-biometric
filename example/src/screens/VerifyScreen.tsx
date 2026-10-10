// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Switch,
} from 'react-native';
import { Camera } from 'react-native-vision-camera';
import {
  BiometricSDK,
  createLivenessState,
  currentChallenge,
  expireLiveness,
  pickChallenges,
  updateLiveness,
  type FaceObservation,
  type LivenessChallenge,
  type LivenessState,
  type VerifyResult,
} from 'faceproof';
import { FaceCamera } from '../FaceCamera';
import { useFaceObservations, takePhotoBase64 } from '../camera';
import { useTheme, type ThemeColors } from '../ThemeContext';
import { s } from '../theme';
import type { Screen } from '../types';

type Props = {
  navigate: (screen: Screen) => void;
  isActive: boolean;
  onResult: (result: VerifyResult) => void;
};

type Phase = 'preparing' | 'scanning' | 'verifying' | 'result' | 'failed';

/** Number of challenges per session, drawn at random from blink, smile, turn. */
const CHALLENGE_COUNT = 2;

const INSTRUCTIONS: Record<LivenessChallenge, string> = {
  blink: 'Blink twice',
  smile: 'Start with a neutral face, then smile',
  turn: 'Look at the camera, then turn your head',
};

export default function VerifyScreen({ navigate, isActive, onResult }: Props) {
  const { colors } = useTheme();
  const camera = useRef<Camera>(null);
  const [phase, setPhase] = useState<Phase>('preparing');
  const [liveness, setLiveness] = useState<LivenessState | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Off = send no face box, so Android runs its own BlazeFace detector.
  const [useFaceBox, setUseFaceBox] = useState(true);

  const onObservation = useCallback((observation: FaceObservation) => {
    setLiveness((prev) => (prev ? updateLiveness(prev, observation) : prev));
  }, []);
  const { frameProcessor, faceCount, getLastFaceBox } =
    useFaceObservations(onObservation);
  const faceCountRef = useRef(faceCount);
  faceCountRef.current = faceCount;

  const startSession = useCallback(async () => {
    setPhase('preparing');
    setResult(null);
    setFailure(null);
    try {
      const randomInt = await BiometricSDK.createSecureRandomInt();
      const challenges = pickChallenges(CHALLENGE_COUNT, randomInt);
      setLiveness(createLivenessState(challenges, {}, Date.now()));
      setPhase('scanning');
    } catch (e: any) {
      setFailure(e?.message ?? 'Could not start a liveness session.');
      setPhase('failed');
    }
  }, []);

  useEffect(() => {
    startSession();
  }, [startSession]);

  // Frames can stop arriving (camera paused), so time out from a timer too.
  useEffect(() => {
    if (phase !== 'scanning') return;
    const id = setInterval(() => {
      setLiveness((prev) => (prev ? expireLiveness(prev, Date.now()) : prev));
    }, 500);
    return () => clearInterval(id);
  }, [phase]);

  const runVerify = useCallback(async () => {
    if (!camera.current) return;
    setPhase('verifying');
    try {
      // Re-check right before capture: liveness passed, but the photo must
      // still show exactly one face.
      if (faceCountRef.current !== 1) {
        setFailure('Exactly one face must be visible when the photo is taken.');
        setPhase('failed');
        return;
      }
      const box = useFaceBox ? (getLastFaceBox() ?? undefined) : undefined;
      const b64 = await takePhotoBase64(camera.current);
      const res = await BiometricSDK.verifyWorker(b64, box);
      setResult(res);
      onResult(res);
      setPhase('result');
      if (res.status === 'MATCH' && res.workerId) {
        // The example has no location provider, so the record has no location.
        await BiometricSDK.logAttendance(
          res.workerId,
          res.confidence ?? 0
        ).catch(() => {});
      }
    } catch (e: any) {
      setFailure(e?.message ?? 'Verification failed.');
      setPhase('failed');
    }
  }, [getLastFaceBox, onResult, useFaceBox]);

  useEffect(() => {
    if (phase !== 'scanning' || !liveness) return;
    if (liveness.status === 'PASSED') {
      runVerify();
    } else if (liveness.status === 'FAILED') {
      setFailure(
        liveness.failure === 'MULTIPLE_FACES'
          ? 'More than one face was in view.'
          : `Challenges not completed within ${liveness.config.timeoutMs / 1000} s.`
      );
      setPhase('failed');
    }
  }, [liveness, phase, runVerify]);

  const challenge = liveness ? currentChallenge(liveness) : null;
  const step = liveness
    ? Math.min(liveness.currentIndex + 1, liveness.challenges.length)
    : 0;

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 30 }}
    >
      <Text style={[s.title, { color: colors.text }]}>Verify + Liveness</Text>
      <Text style={[s.subtitle, { color: colors.textDim }]}>
        {challenge && liveness
          ? `Step ${step} of ${liveness.challenges.length}: ${INSTRUCTIONS[challenge]}`
          : 'Follow the on-screen challenges'}
      </Text>

      <View style={[s.row, styles.toggle]}>
        <Text style={[s.cardBody, { color: colors.textDim, flex: 1 }]}>
          Crop with ML Kit face box (off: on-device BlazeFace, Android)
        </Text>
        <Switch
          value={useFaceBox}
          onValueChange={setUseFaceBox}
          disabled={phase === 'verifying'}
          // The description is a sibling Text, not a label, so the switch needs
          // its own name for a screen reader.
          accessibilityLabel="Crop with ML Kit face box"
        />
      </View>

      <FaceCamera
        ref={camera}
        isActive={isActive && (phase === 'scanning' || phase === 'verifying')}
        frameProcessor={frameProcessor}
      >
        <View style={styles.overlay}>
          <View
            style={[
              s.pill,
              {
                backgroundColor:
                  faceCount === 1 ? colors.success : colors.danger,
              },
            ]}
          >
            <Text style={[s.pillText, { color: '#FFFFFF' }]}>
              {faceCount === 0
                ? 'No face'
                : faceCount === 1
                  ? 'Face detected'
                  : 'Too many faces'}
            </Text>
          </View>
          {(phase === 'scanning' || phase === 'verifying') && liveness && (
            <View style={styles.statusBox}>
              <Text style={styles.statusLabel}>
                {phase === 'verifying'
                  ? 'Matching...'
                  : challenge === 'blink'
                    ? `Blinks ${liveness.blinkCount}/${liveness.config.requiredBlinks}`
                    : challenge
                      ? INSTRUCTIONS[challenge]
                      : ''}
              </Text>
            </View>
          )}
        </View>
      </FaceCamera>

      {phase === 'failed' && (
        <View
          style={[
            s.card,
            { backgroundColor: colors.cardBg, borderColor: colors.danger },
          ]}
        >
          <Text style={[s.cardTitle, { color: colors.danger }]}>
            Not verified
          </Text>
          <Text style={[s.cardBody, { color: colors.textDim }]}>{failure}</Text>
        </View>
      )}

      {phase === 'result' && result && (
        <ResultCard result={result} colors={colors} />
      )}

      {(phase === 'result' || phase === 'failed') && (
        <TouchableOpacity
          style={[s.button, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          onPress={startSession}
        >
          <Text style={s.buttonText}>Try again</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[s.button, s.buttonGhost, { borderColor: colors.border }]}
        accessibilityRole="button"
        onPress={() => navigate('menu')}
      >
        <Text style={[s.buttonText, { color: colors.text }]}>Back to menu</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function ResultCard({
  result,
  colors,
}: {
  result: VerifyResult;
  colors: ThemeColors;
}) {
  const isMatch = result.status === 'MATCH';
  const tone = isMatch ? colors.success : colors.warn;
  return (
    <View
      style={[s.card, { backgroundColor: colors.cardBg, borderColor: tone }]}
    >
      <Text style={[s.cardTitle, { color: tone }]}>{result.status}</Text>
      {isMatch && (
        <>
          <Text style={[s.cardBody, { color: colors.textDim }]}>
            ID: {result.workerId}
          </Text>
          <Text style={[s.cardBody, { color: colors.textDim }]}>
            Similarity: {(result.confidence ?? 0).toFixed(3)}
          </Text>
        </>
      )}
      <Text style={[s.cardBody, { color: colors.textDim, marginTop: 6 }]}>
        Inference {result.inferenceMs ?? '-'} ms, total {result.totalMs ?? '-'}{' '}
        ms
        {result.quality != null ? `, quality ${result.quality.toFixed(2)}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    marginBottom: 12,
    gap: 12,
  },
  overlay: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  statusBox: {
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
  },
  statusLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
