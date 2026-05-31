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
import { SYNC_ENDPOINT } from '../config';
import { useTheme } from '../ThemeContext';
import { s } from '../theme';
import type { Screen } from '../types';

type Props = {
  navigate: (screen: Screen) => void;
};

export default function SyncScreen({ navigate }: Props) {
  const { colors } = useTheme();
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
      const ids = records.map((r) => r.id);

      if (SYNC_ENDPOINT) {
        // POST to the deployed AWS Lambda sync endpoint. Each record carries
        // an HMAC-SHA256 signature for audit; the Lambda writes idempotently
        // to DynamoDB (see backend/lambda_sync_handler.py).
        const response = await fetch(SYNC_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records }),
        });
        if (!response.ok) {
          throw new Error(
            `Server returned ${response.status}: ${await response.text()}`
          );
        }
        const result = await response.json();
        const summary = result?.summary ?? {};
        const ok = (summary.stored ?? 0) + (summary.duplicate ?? 0);
        const failed = summary.failed ?? 0;
        await BiometricSDK.markSynced(ids);
        Alert.alert(
          failed > 0 ? 'Synced with errors' : 'Synced',
          `${ok}/${ids.length} record(s) uploaded` +
            (failed > 0 ? `, ${failed} failed` : '.')
        );
      } else {
        // No endpoint configured (first build) — mark synced locally only,
        // so the offline / sync flow can still be demoed end-to-end without
        // AWS. After deploy-backend runs, set SYNC_ENDPOINT in example/src/config.ts.
        await BiometricSDK.markSynced(ids);
        Alert.alert(
          'Synced (local)',
          `${ids.length} record(s) marked synced. ` +
            'Set SYNC_ENDPOINT in src/config.ts to upload to AWS.'
        );
      }

      await refresh();
    } catch (e: any) {
      Alert.alert('Sync failed', e?.message ?? 'Unknown error');
    } finally {
      setSyncing(false);
    }
  }, [records, refresh]);

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 30 }}
    >
      <Text style={[s.title, { color: colors.text }]}>Sync Status</Text>
      <Text style={[s.subtitle, { color: colors.textDim }]}>
        Offline attendance queued for upload
      </Text>

      <View
        style={[
          s.card,
          { backgroundColor: colors.cardBg, borderColor: colors.border },
        ]}
      >
        <View style={s.row}>
          <Text style={[s.cardTitle, { color: colors.text }]}>
            Pending records
          </Text>
          <View style={[s.pill, { backgroundColor: colors.cardAlt }]}>
            <Text style={[s.pillText, { color: colors.warn }]}>
              {records.length}
            </Text>
          </View>
        </View>
        <Text style={[s.cardBody, { color: colors.textDim }]}>
          Records are signed (HMAC-SHA256) and stored locally while offline,
          then uploaded when connectivity returns.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
      ) : records.length === 0 ? (
        <View
          style={[
            s.card,
            { backgroundColor: colors.cardBg, borderColor: colors.border },
          ]}
        >
          <Text style={[s.cardBody, { color: colors.textDim }]}>
            No pending records. ✅
          </Text>
        </View>
      ) : (
        records.map((r) => (
          <View
            key={r.id}
            style={[
              s.card,
              { backgroundColor: colors.cardBg, borderColor: colors.border },
            ]}
          >
            <View style={s.row}>
              <Text style={[s.statValue, { color: colors.text }]}>
                {r.workerId}
              </Text>
              <Text style={[s.statLabel, { color: colors.textDim }]}>
                {new Date(r.timestamp).toLocaleTimeString()}
              </Text>
            </View>
            <Text style={[s.cardBody, { color: colors.textDim }]}>
              {r.latitude.toFixed(4)}, {r.longitude.toFixed(4)} · conf{' '}
              {(r.confidence * 100).toFixed(0)}%
            </Text>
          </View>
        ))
      )}

      <TouchableOpacity
        style={[
          s.button,
          { backgroundColor: colors.primary },
          records.length === 0 && { opacity: 0.4 },
        ]}
        disabled={records.length === 0 || syncing}
        onPress={syncNow}
      >
        <Text style={s.buttonText}>
          {syncing ? 'Uploading…' : `Sync ${records.length} record(s)`}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.button, s.buttonGhost, { borderColor: colors.border }]}
        onPress={refresh}
      >
        <Text style={[s.buttonText, { color: colors.text }]}>Refresh</Text>
      </TouchableOpacity>

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
