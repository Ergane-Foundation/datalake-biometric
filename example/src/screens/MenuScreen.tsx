import { Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { colors, s } from '../theme';
import type { InitStatus, Screen } from '../types';

type Props = {
  navigate: (screen: Screen) => void;
  initStatus: InitStatus;
};

const ITEMS: { key: Screen; title: string; body: string; emoji: string }[] = [
  {
    key: 'enroll',
    title: 'Enroll Worker',
    body: 'Capture 3 frames and store a face embedding on-device.',
    emoji: '🧑‍🏭',
  },
  {
    key: 'verify',
    title: 'Verify + Liveness',
    body: 'Blink twice to prove liveness, then match against enrolled workers.',
    emoji: '🔎',
  },
  {
    key: 'benchmark',
    title: 'Benchmark',
    body: 'Model sizes, inference latency and device info.',
    emoji: '📊',
  },
  {
    key: 'sync',
    title: 'Sync Status',
    body: 'Pending offline attendance records queued for upload.',
    emoji: '☁️',
  },
];

function StatusPill({ status }: { status: InitStatus }) {
  const map = {
    pending: { bg: colors.cardAlt, fg: colors.textDim, label: 'Initialising…' },
    ready: { bg: '#0E3D2E', fg: colors.success, label: 'SDK Ready' },
    failed: { bg: '#3D1414', fg: colors.danger, label: 'Init Failed' },
  }[status];
  return (
    <View style={[s.pill, { backgroundColor: map.bg }]}>
      <Text style={[s.pillText, { color: map.fg }]}>● {map.label}</Text>
    </View>
  );
}

export default function MenuScreen({ navigate, initStatus }: Props) {
  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 30 }}>
      <View style={[s.row, { marginBottom: 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Datalake Biometric</Text>
          <Text style={s.subtitle}>Offline face recognition + liveness</Text>
        </View>
        <StatusPill status={initStatus} />
      </View>

      {ITEMS.map((it) => (
        <TouchableOpacity
          key={it.key}
          activeOpacity={0.8}
          style={s.card}
          onPress={() => navigate(it.key)}
        >
          <View style={s.row}>
            <Text style={s.cardTitle}>
              {it.emoji} {it.title}
            </Text>
            <Text style={{ color: colors.textDim, fontSize: 22 }}>›</Text>
          </View>
          <Text style={s.cardBody}>{it.body}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
