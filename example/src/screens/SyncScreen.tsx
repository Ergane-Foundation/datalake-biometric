import { useCallback, useEffect, useState } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { BiometricSDK, type AttendanceRecord } from 'datalake-biometric';
import { colors, s } from '../theme';
import type { Screen } from '../types';

type Props = {
  navigate: (screen: Screen) => void;
};

export default function SyncScreen({ navigate }: Props) {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const pending = await BiometricSDK.getPendingRecords();
      setRecords(pending);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load records');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const syncNow = useCallback(async () => {
    if (records.length === 0) return;
    setSyncing(true);
    try {
      // In production this POSTs to the AWS Lambda sync endpoint, which verifies
      // each HMAC signature and writes idempotently to DynamoDB. For the demo we
      // mark them synced locally once "uploaded".
      const ids = records.map((r) => r.id);
      await BiometricSDK.markSynced(ids);
      Alert.alert('Synced', `${ids.length} record(s) uploaded.`);
      await refresh();
    } catch (e: any) {
      Alert.alert('Sync failed', e?.message ?? 'Unknown error');
    } finally {
      setSyncing(false);
    }
  }, [records, refresh]);

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 30 }}>
      <Text style={s.title}>Sync Status</Text>
      <Text style={s.subtitle}>Offline attendance queued for upload</Text>

      <View style={s.card}>
        <View style={s.row}>
          <Text style={s.cardTitle}>Pending records</Text>
          <View style={[s.pill, { backgroundColor: colors.cardAlt }]}>
            <Text style={[s.pillText, { color: colors.warn }]}>
              {records.length}
            </Text>
          </View>
        </View>
        <Text style={s.cardBody}>
          Records are signed (HMAC-SHA256) and stored locally while offline,
          then uploaded when connectivity returns.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      ) : records.length === 0 ? (
        <View style={s.card}>
          <Text style={s.cardBody}>No pending records. ✅</Text>
        </View>
      ) : (
        records.map((r) => (
          <View key={r.id} style={s.card}>
            <View style={s.row}>
              <Text style={s.statValue}>{r.workerId}</Text>
              <Text style={s.statLabel}>
                {new Date(r.timestamp).toLocaleTimeString()}
              </Text>
            </View>
            <Text style={s.cardBody}>
              {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)} · conf{' '}
              {(r.confidence * 100).toFixed(0)}%
            </Text>
          </View>
        ))
      )}

      <TouchableOpacity
        style={[s.button, records.length === 0 && { opacity: 0.4 }]}
        disabled={records.length === 0 || syncing}
        onPress={syncNow}
      >
        <Text style={s.buttonText}>
          {syncing ? 'Uploading…' : `Sync ${records.length} record(s)`}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={[s.button, s.buttonGhost]} onPress={refresh}>
        <Text style={[s.buttonText, s.buttonGhostText]}>Refresh</Text>
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
