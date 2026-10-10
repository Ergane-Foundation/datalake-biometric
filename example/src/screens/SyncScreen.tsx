// SPDX-License-Identifier: Apache-2.0
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { BiometricSDK, type AttendanceRecord } from 'faceproof';
import { DEFAULT_SYNC_ENDPOINT } from '../config';
import { useTheme } from '../ThemeContext';
import { s } from '../theme';
import type { Screen } from '../types';

type Props = {
  navigate: (screen: Screen) => void;
};

type ServerResult = { id: string; status: string };

/**
 * Uploads queued attendance records to a self-hosted backend
 * (backend/template.yaml). Endpoint and token live only in memory for this
 * screen, so they are never written to disk or committed.
 */
export default function SyncScreen({ navigate }: Props) {
  const { colors } = useTheme();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [endpoint, setEndpoint] = useState(DEFAULT_SYNC_ENDPOINT ?? '');
  const [token, setToken] = useState('');
  const configured = endpoint.trim().length > 0 && token.trim().length > 0;

  // Latest values for the NetInfo listener, which is registered only once.
  const latest = useRef({ configured, syncing });
  latest.current = { configured, syncing };
  const wasOfflineRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRecords(await BiometricSDK.getPendingRecords());
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const syncRecords = useCallback(
    async (toSync: AttendanceRecord[]) => {
      if (toSync.length === 0 || !configured) return;
      setSyncing(true);
      try {
        const response = await fetch(endpoint.trim(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token.trim()}`,
          },
          body: JSON.stringify({ records: toSync }),
        });
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}.`);
        }
        const body = await response.json();
        const results: ServerResult[] = Array.isArray(body?.results)
          ? body.results
          : [];
        // Only records the server confirmed are marked synced and purged.
        // Anything else stays pending and is retried next time.
        const accepted = results
          .filter((r) => r.status === 'stored' || r.status === 'duplicate')
          .map((r) => r.id);
        if (accepted.length > 0) {
          await BiometricSDK.markSynced(accepted);
          await BiometricSDK.purgeSyncedRecords();
        }
        const failed = toSync.length - accepted.length;
        Alert.alert(
          failed > 0 ? 'Synced with errors' : 'Synced',
          `${accepted.length} of ${toSync.length} record(s) uploaded and removed from the device.` +
            (failed > 0 ? ` ${failed} will be retried.` : '')
        );
        await refresh();
      } catch (e: any) {
        Alert.alert('Sync failed', e?.message ?? 'Unknown error.');
      } finally {
        setSyncing(false);
      }
    },
    [configured, endpoint, token, refresh]
  );

  const syncRef = useRef(syncRecords);
  syncRef.current = syncRecords;

  // Auto-sync once per offline -> online transition, if sync is configured.
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online =
        state.isConnected === true && state.isInternetReachable !== false;
      if (!online) {
        wasOfflineRef.current = true;
        return;
      }
      if (!wasOfflineRef.current) return;
      wasOfflineRef.current = false;
      if (!latest.current.configured || latest.current.syncing) return;
      BiometricSDK.getPendingRecords()
        .then((pending) => {
          setRecords(pending);
          return syncRef.current(pending);
        })
        .catch(() => {});
    });
    return unsubscribe;
  }, []);

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.cardBg,
      borderColor: colors.border,
      color: colors.text,
    },
  ];

  // Uploading must need a configured endpoint, a token and at least one
  // record, and must not start twice while a sync is already running.
  const canSync = configured && records.length > 0 && !syncing;

  return (
    <ScrollView
      style={[s.screen, { backgroundColor: colors.bg }]}
      contentContainerStyle={{ paddingBottom: 30 }}
    >
      <Text style={[s.title, { color: colors.text }]}>Sync</Text>
      <Text style={[s.subtitle, { color: colors.textDim }]}>
        Optional upload to your own backend
      </Text>

      <TextInput
        value={endpoint}
        onChangeText={setEndpoint}
        placeholder="https://<api-id>.execute-api.<region>.amazonaws.com/sync"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={inputStyle}
      />
      <TextInput
        value={token}
        onChangeText={setToken}
        placeholder="Access token"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        style={inputStyle}
      />

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
          Records are signed and kept in the encrypted local database until a
          sync succeeds. With sync not configured, they simply stay on the
          device.
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} />
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
              {r.latitude != null && r.longitude != null
                ? `${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}`
                : 'No location'}
              {`, similarity ${r.confidence.toFixed(2)}`}
            </Text>
          </View>
        ))
      )}

      <TouchableOpacity
        style={[
          s.button,
          { backgroundColor: colors.primary },
          (!configured || records.length === 0) && { opacity: 0.4 },
        ]}
        disabled={!canSync}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSync }}
        onPress={() => syncRecords(records)}
      >
        <Text style={s.buttonText}>
          {syncing
            ? 'Uploading...'
            : configured
              ? `Sync ${records.length} record(s)`
              : 'Enter endpoint and token to sync'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[s.button, s.buttonGhost, { borderColor: colors.border }]}
        accessibilityRole="button"
        onPress={refresh}
      >
        <Text style={[s.buttonText, { color: colors.text }]}>Refresh</Text>
      </TouchableOpacity>

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

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
});
