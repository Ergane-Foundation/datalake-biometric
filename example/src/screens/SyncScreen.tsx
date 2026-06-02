import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
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
  // Track whether we're online so the auto-sync fires at most once per
  // offline→online transition (not on every NetInfo poll).
  const wasOfflineRef = useRef(false);

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

  // Auto-sync when connectivity is restored and there are pending records.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isOnline = state.isConnected && state.isInternetReachable !== false;
      if (isOnline && wasOfflineRef.current) {
        wasOfflineRef.current = false;
        // Re-fetch and sync if there are records waiting.
        BiometricSDK.getPendingRecords()
          .then((pending) => {
            if (pending.length > 0) {
              setRecords(pending);
              // Trigger sync without user interaction.
              syncRecords(pending);
            }
          })
          .catch(() => {});
      }
      if (!isOnline) {
        wasOfflineRef.current = true;
      }
    });
    return () => unsubscribe();
    // syncRecords intentionally not in deps — we use the stable reference below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncRecords = useCallback(
    async (toSync: AttendanceRecord[]) => {
      if (toSync.length === 0 || syncing) return;
      setSyncing(true);
      try {
        const ids = toSync.map((r) => r.id);

        if (SYNC_ENDPOINT) {
          // POST to the deployed AWS Lambda sync endpoint. Each record carries
          // an HMAC-SHA256 signature for audit; the Lambda writes idempotently
          // to DynamoDB (see backend/lambda_sync_handler.py).
          const response = await fetch(SYNC_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: toSync }),
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

          // Only mark records the server actually accepted (stored or duplicate).
          // Records the server rejected keep their pending status so they are
          // retried on the next sync.
          const perRecord: Array<{ id: string; status: string }> =
            result?.results ?? ids.map((id) => ({ id, status: 'stored' }));
          const syncedIds = perRecord
            .filter((r) => r.status === 'stored' || r.status === 'duplicate')
            .map((r) => r.id);

          if (syncedIds.length > 0) {
            await BiometricSDK.markSynced(syncedIds);
          }

          Alert.alert(
            failed > 0 ? 'Synced with errors' : 'Synced',
            `${ok}/${ids.length} record(s) uploaded` +
              (failed > 0 ? `, ${failed} failed (will retry).` : '.')
          );
        } else {
          // No endpoint configured — mark synced locally only so the offline /
          // sync flow can be demoed without AWS. Set SYNC_ENDPOINT in config.ts
          // after running deploy-backend.
          await BiometricSDK.markSynced(ids);
          Alert.alert(
            'Synced (local only)',
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
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refresh, syncing]
  );

  const syncNow = useCallback(
    () => syncRecords(records),
    [records, syncRecords]
  );

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
          Records are HMAC-SHA256 signed and stored locally while offline.
          Auto-sync fires when connectivity returns; tap below to sync now.
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
