// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { BiometricSDK, type VerifyResult } from 'faceproof';
import { useTheme } from '../ThemeContext';
import { s } from '../theme';
import type { Screen } from '../types';

type Props = {
  navigate: (screen: Screen) => void;
  lastVerify: VerifyResult | null;
};

// Sizes of the files written by `yarn setup:models` (see docs on models).
const MODELS = [
  { name: 'BlazeFace short-range (face box)', size: '0.22 MB' },
  { name: 'MobileFaceNet, float32, 192-d', size: '5.00 MB' },
];

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={[s.row, { marginVertical: 5 }]}>
      <Text style={[s.statLabel, { color: colors.textDim }]}>{label}</Text>
      <Text style={[s.statValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

export default function BenchmarkScreen({ navigate, lastVerify }: Props) {
  const { colors } = useTheme();
  const [pending, setPending] = useState<number>(0);

  useEffect(() => {
    BiometricSDK.getPendingRecords()
      .then((r) => setPending(r.length))
      .catch(() => setPending(0));
  }, []);

  // Platform.constants on Android exposes Brand/Model; the cast keeps TS happy
  // against the cross-platform union type without affecting runtime behaviour.
  const c = Platform.constants as { Brand?: string; Model?: string };
  const device = `${c?.Brand ?? ''} ${c?.Model ?? 'Unknown'}`.trim();

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 30 }}
    >
      <Text style={[s.title, { color: colors.text }]}>Benchmark</Text>
      <Text style={[s.subtitle, { color: colors.textDim }]}>
        On-device performance & footprint
      </Text>

      <View
        style={[
          s.card,
          { backgroundColor: colors.cardBg, borderColor: colors.border },
        ]}
      >
        <Text style={[s.cardTitle, { color: colors.text }]}>
          Bundled models
        </Text>
        {MODELS.map((m) => (
          <Stat key={m.name} label={m.name} value={m.size} />
        ))}
        <View
          style={{
            height: 1,
            backgroundColor: colors.border,
            marginVertical: 8,
          }}
        />
        <Stat label="Total" value="~5.2 MB" />
      </View>

      <View
        style={[
          s.card,
          { backgroundColor: colors.cardBg, borderColor: colors.border },
        ]}
      >
        <Text style={[s.cardTitle, { color: colors.text }]}>
          Last verification
        </Text>
        {lastVerify ? (
          <>
            <Stat label="Status" value={lastVerify.status} />
            <Stat
              label="Inference"
              value={`${lastVerify.inferenceMs ?? '-'} ms`}
            />
            <Stat
              label="Total pipeline"
              value={`${lastVerify.totalMs ?? '-'} ms`}
            />
            <Stat
              label="Quality"
              value={
                lastVerify.quality != null ? lastVerify.quality.toFixed(2) : '-'
              }
            />
          </>
        ) : (
          <Text style={[s.cardBody, { color: colors.textDim }]}>
            Run a verification first to see live timings here.
          </Text>
        )}
      </View>

      <View
        style={[
          s.card,
          { backgroundColor: colors.cardBg, borderColor: colors.border },
        ]}
      >
        <Text style={[s.cardTitle, { color: colors.text }]}>Device</Text>
        <Stat label="Model" value={device || 'Unknown'} />
        <Stat label="OS" value={`${Platform.OS} ${Platform.Version}`} />
        <Stat label="Pending sync" value={String(pending)} />
      </View>

      <TouchableOpacity
        style={[s.button, s.buttonGhost, { borderColor: colors.border }]}
        onPress={() => navigate('menu')}
      >
        <Text style={[s.buttonText, { color: colors.text }]}>Back to menu</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
