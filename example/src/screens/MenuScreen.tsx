import {
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  View,
} from 'react-native';
import { useTheme } from '../ThemeContext';
import { ThemeToggle } from '../ThemeToggle';
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
  const { colors } = useTheme();
  const map = {
    pending: { bg: colors.cardAlt, fg: colors.textDim, label: 'Initialising…' },
    ready: { bg: colors.success, fg: '#FFFFFF', label: 'SDK Ready' },
    failed: { bg: colors.danger, fg: '#FFFFFF', label: 'Init Failed' },
  }[status];
  return (
    <View style={[s.pill, { backgroundColor: map.bg }]}>
      <Text style={[s.pillText, { color: map.fg }]}>● {map.label}</Text>
    </View>
  );
}

export default function MenuScreen({ navigate, initStatus }: Props) {
  const { colors } = useTheme();

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 30 }}
    >
      <View style={[s.row, { marginBottom: 16 }]}>
        <View style={{ flex: 1 }}>
          <Text style={[s.title, { color: colors.text }]}>
            Datalake Biometric
          </Text>
          <Text style={[s.subtitle, { color: colors.textDim }]}>
            Offline face recognition + liveness
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <ThemeToggle />
          <StatusPill status={initStatus} />
        </View>
      </View>

      {ITEMS.map((it) => (
        <TouchableOpacity
          key={it.key}
          activeOpacity={0.8}
          style={[
            s.card,
            {
              backgroundColor: colors.cardBg,
              borderColor: colors.border,
            },
          ]}
          onPress={() => navigate(it.key)}
        >
          <View style={s.row}>
            <Text
              style={[s.cardTitle, { color: colors.text, flex: 1 }]}
              numberOfLines={1}
            >
              {it.emoji} {it.title}
            </Text>
            <Text style={{ color: colors.textDim, fontSize: 22, marginLeft: 8 }}>
              ›
            </Text>
          </View>
          <Text style={[s.cardBody, { color: colors.textDim }]}>{it.body}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 20,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  pillText: {
    fontWeight: '700',
    fontSize: 13,
  },
});
