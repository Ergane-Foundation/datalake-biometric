import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { BiometricSDK, type VerifyResult } from 'datalake-biometric';
import { FaceCamera } from '../FaceCamera';
import { useFaceState, takePhotoBase64, type LivenessChallenge } from '../camera';
import { useTheme, type ThemeColors } from '../ThemeContext';
import { s } from '../theme';
import type { Screen } from '../types';

type Props = {
  navigate: (screen: Screen) => void;
  isActive: boolean;
  onResult: (result: VerifyResult) => void;
};

type Phase = 'scanning' | 'verifying' | 'result' | 'spoof';

const REQUIRED_BLINKS = 2;
const LIVENESS_TIMEOUT_MS = 12000;
// Placeholder coordinates for the attendance record.
const LAT = 10.0;
const LNG = 20.0;

const CHALLENGES: LivenessChallenge[] = ['blink', 'smile', 'turn'];

function pickChallenge(): LivenessChallenge {
  return CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)] as LivenessChallenge;
}

function getChallengeInstruction(challenge: LivenessChallenge): string {
  switch (challenge) {
    case 'blink': return 'Blink twice to prove you are live';
    case 'smile': return 'Smile to prove you are live';
    case 'turn':  return 'Turn your head left or right';
  }
}

export default function VerifyScreen({ navigate, isActive, onResult }: Props) {
  const { colors } = useTheme();
  const camera = useRef<Camera>(null);
  const {
    frameProcessor,
    faceInFrame,
    blinkCount,
    smileDetected,
    headTurned,
    reset,
    getLastHint,
  } = useFaceState();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const phaseRef = useRef<Phase>('scanning');
  phaseRef.current = phase;

  // Pick a random challenge once per session; re-pick on retry.
  const [challenge, setChallenge] = useState<LivenessChallenge>(pickChallenge);

  const runVerify = useCallback(async () => {
    if (!camera.current) return;
    setPhase('verifying');
    try {
      const b64 = await takePhotoBase64(camera.current);
      // Pass the most recent MLKit face box so native crops tight around it.
      const hint = getLastHint() ?? undefined;
      const res = await BiometricSDK.verifyWorker(b64, hint);
      setResult(res);
      onResult(res);
      setPhase('result');
      if (res.status === 'MATCH' && res.workerId) {
        try {
          await BiometricSDK.logAttendance(
            res.workerId,
            LAT,
            LNG,
            res.confidence ?? 0
          );
        } catch {
          // attendance logging is best-effort for the demo
        }
      }
    } catch {
      setResult({ status: 'NO_FACE' });
      setPhase('result');
    }
  }, [getLastHint, onResult]);

  // Trigger verification once the active liveness challenge is completed.
  useEffect(() => {
    if (phase !== 'scanning') return;
    const met =
      challenge === 'blink' ? blinkCount >= REQUIRED_BLINKS :
      challenge === 'smile' ? smileDetected :
      headTurned;
    if (met) runVerify();
  }, [blinkCount, smileDetected, headTurned, phase, challenge, runVerify]);

  // Liveness timeout -> treat as spoof / no live face.
  useEffect(() => {
    if (phase !== 'scanning' || !isActive) return;
    const t = setTimeout(() => {
      if (phaseRef.current === 'scanning') setPhase('spoof');
    }, LIVENESS_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [phase, isActive]);

  const retry = () => {
    reset();
    setResult(null);
    setChallenge(pickChallenge());
    setPhase('scanning');
  };

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 30 }}
    >
      <Text style={[s.title, { color: colors.text }]}>Verify + Liveness</Text>
      <Text style={[s.subtitle, { color: colors.textDim }]}>
        {getChallengeInstruction(challenge)}
      </Text>

      <FaceCamera
        ref={camera}
        isActive={isActive && phase !== 'result' && phase !== 'spoof'}
        frameProcessor={frameProcessor}
      >
        <View style={styles.overlay}>
          <View
            style={[
              s.pill,
              { backgroundColor: faceInFrame ? colors.success : colors.danger },
            ]}
          >
            <Text style={[s.pillText, { color: '#FFFFFF' }]}>
              {faceInFrame ? '● Face detected' : '○ No face'}
            </Text>
          </View>

          {(phase === 'scanning' || phase === 'verifying') && (
            <View style={styles.blinkBox}>
              <Text style={styles.blinkLabel}>
                {phase === 'verifying' ? 'Matching…' : getChallengeLabel(challenge, blinkCount, smileDetected, headTurned)}
              </Text>
              {challenge === 'blink' && (
                <View style={styles.dots}>
                  {Array.from({ length: REQUIRED_BLINKS }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.dot,
                        {
                          backgroundColor:
                            i < blinkCount
                              ? colors.success
                              : 'rgba(255,255,255,0.3)',
                        },
                      ]}
                    />
                  ))}
                </View>
              )}
              {challenge === 'smile' && (
                <View style={styles.dots}>
                  <View
                    style={[
                      styles.dot,
                      styles.dotLarge,
                      {
                        backgroundColor: smileDetected
                          ? colors.success
                          : 'rgba(255,255,255,0.3)',
                      },
                    ]}
                  />
                </View>
              )}
              {challenge === 'turn' && (
                <View style={styles.dots}>
                  <View
                    style={[
                      styles.dot,
                      styles.dotLarge,
                      {
                        backgroundColor: headTurned
                          ? colors.success
                          : 'rgba(255,255,255,0.3)',
                      },
                    ]}
                  />
                </View>
              )}
            </View>
          )}
        </View>
      </FaceCamera>

      {phase === 'spoof' && (
        <View
          style={[
            s.card,
            {
              backgroundColor: colors.cardBg,
              borderColor: colors.danger,
            },
          ]}
        >
          <Text style={[s.cardTitle, { color: colors.danger }]}>
            ⛔ SPOOF / NO LIVENESS
          </Text>
          <Text style={[s.cardBody, { color: colors.textDim }]}>
            Challenge not completed within {LIVENESS_TIMEOUT_MS / 1000}s.
            A printed photo or video replay cannot pass liveness.
          </Text>
        </View>
      )}

      {phase === 'result' && result && (
        <ResultCard result={result} colors={colors} />
      )}

      {(phase === 'result' || phase === 'spoof') && (
        <TouchableOpacity
          style={[s.button, { backgroundColor: colors.primary }]}
          onPress={retry}
        >
          <Text style={s.buttonText}>Try again</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[s.button, s.buttonGhost, { borderColor: colors.border }]}
        onPress={() => navigate('menu')}
      >
        <Text style={[s.buttonText, { color: colors.text }]}>
          ← Back to menu
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function getChallengeLabel(
  challenge: LivenessChallenge,
  blinkCount: number,
  smileDetected: boolean,
  headTurned: boolean
): string {
  switch (challenge) {
    case 'blink': return `Blink ${blinkCount}/${REQUIRED_BLINKS}`;
    case 'smile': return smileDetected ? '😊 Smile detected!' : 'Hold your smile…';
    case 'turn':  return headTurned    ? '✓ Head turned!'    : 'Turn head left or right…';
  }
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
      <Text style={[s.cardTitle, { color: tone }]}>
        {isMatch ? '✅ MATCH' : `⚠️ ${result.status}`}
      </Text>
      {isMatch && (
        <>
          <Text style={[s.cardBody, { color: colors.textDim }]}>
            Worker: {result.workerId}
          </Text>
          <Text style={[s.cardBody, { color: colors.textDim }]}>
            Confidence: {((result.confidence ?? 0) * 100).toFixed(1)}%
          </Text>
        </>
      )}
      <Text style={[s.cardBody, { color: colors.textDim, marginTop: 6 }]}>
        Inference {result.inferenceMs ?? '–'} ms · total {result.totalMs ?? '–'}{' '}
        ms
        {result.quality != null
          ? ` · quality ${result.quality.toFixed(2)}`
          : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  blinkBox: {
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
  },
  blinkLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  dots: {
    flexDirection: 'row',
    gap: 10,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  dotLarge: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
});
