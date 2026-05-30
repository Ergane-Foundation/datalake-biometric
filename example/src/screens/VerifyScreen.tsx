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
import { useFaceState, takePhotoBase64 } from '../camera';
import { colors, s } from '../theme';
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

export default function VerifyScreen({ navigate, isActive, onResult }: Props) {
  const camera = useRef<Camera>(null);
  const { frameProcessor, faceInFrame, blinkCount, reset, getLastHint } =
    useFaceState();

  const [phase, setPhase] = useState<Phase>('scanning');
  const [result, setResult] = useState<VerifyResult | null>(null);
  const phaseRef = useRef<Phase>('scanning');
  phaseRef.current = phase;

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

  // Trigger verification once liveness (2 blinks) is proven.
  useEffect(() => {
    if (phase === 'scanning' && blinkCount >= REQUIRED_BLINKS) {
      runVerify();
    }
  }, [blinkCount, phase, runVerify, getLastHint]);

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
    setPhase('scanning');
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 30 }}>
      <Text style={s.title}>Verify + Liveness</Text>
      <Text style={s.subtitle}>Blink twice to prove you are live</Text>

      <FaceCamera
        ref={camera}
        isActive={isActive && phase !== 'result' && phase !== 'spoof'}
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

          {(phase === 'scanning' || phase === 'verifying') && (
            <View style={styles.blinkBox}>
              <Text style={styles.blinkLabel}>
                {phase === 'verifying' ? 'Matching…' : 'Blink twice'}
              </Text>
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
            </View>
          )}
        </View>
      </FaceCamera>

      {phase === 'spoof' && (
        <View style={[s.card, { borderColor: colors.danger }]}>
          <Text style={[s.cardTitle, { color: colors.danger }]}>
            ⛔ SPOOF / NO LIVENESS
          </Text>
          <Text style={s.cardBody}>
            No blink detected within {LIVENESS_TIMEOUT_MS / 1000}s. A printed
            photo or video replay cannot pass liveness.
          </Text>
        </View>
      )}

      {phase === 'result' && result && <ResultCard result={result} />}

      {(phase === 'result' || phase === 'spoof') && (
        <TouchableOpacity style={s.button} onPress={retry}>
          <Text style={s.buttonText}>Try again</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[s.button, s.buttonGhost]}
        onPress={() => navigate('menu')}
      >
        <Text style={[s.buttonText, s.buttonGhostText]}>← Back to menu</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function ResultCard({ result }: { result: VerifyResult }) {
  const isMatch = result.status === 'MATCH';
  const tone = isMatch ? colors.success : colors.warn;
  return (
    <View style={[s.card, { borderColor: tone }]}>
      <Text style={[s.cardTitle, { color: tone }]}>
        {isMatch ? '✅ MATCH' : `⚠️ ${result.status}`}
      </Text>
      {isMatch && (
        <>
          <Text style={s.cardBody}>Worker: {result.workerId}</Text>
          <Text style={s.cardBody}>
            Confidence: {((result.confidence ?? 0) * 100).toFixed(1)}%
          </Text>
        </>
      )}
      <Text style={[s.cardBody, { marginTop: 6 }]}>
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
});
