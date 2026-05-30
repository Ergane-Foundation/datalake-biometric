import { useEffect, useState } from 'react';
import { Platform, StatusBar, StyleSheet, View } from 'react-native';
import { BiometricSDK, type VerifyResult } from 'datalake-biometric';
import { ThemeProvider, useTheme } from './ThemeContext';
import type { InitStatus, Screen } from './types';
import MenuScreen from './screens/MenuScreen';
import EnrollScreen from './screens/EnrollScreen';
import VerifyScreen from './screens/VerifyScreen';
import BenchmarkScreen from './screens/BenchmarkScreen';
import SyncScreen from './screens/SyncScreen';

function AppInner() {
  const { isDark, colors } = useTheme();
  const [screen, setScreen] = useState<Screen>('menu');
  const [initStatus, setInitStatus] = useState<InitStatus>('pending');
  const [lastVerify, setLastVerify] = useState<VerifyResult | null>(null);

  useEffect(() => {
    let mounted = true;
    BiometricSDK.initialize()
      .then((ok) => mounted && setInitStatus(ok ? 'ready' : 'failed'))
      .catch(() => mounted && setInitStatus('failed'));
    return () => {
      mounted = false;
    };
  }, []);

  const navigate = (next: Screen) => setScreen(next);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={colors.bg}
      />
      {screen === 'menu' && (
        <MenuScreen navigate={navigate} initStatus={initStatus} />
      )}
      {screen === 'enroll' && (
        <EnrollScreen navigate={navigate} isActive={screen === 'enroll'} />
      )}
      {screen === 'verify' && (
        <VerifyScreen
          navigate={navigate}
          isActive={screen === 'verify'}
          onResult={setLastVerify}
        />
      )}
      {screen === 'benchmark' && (
        <BenchmarkScreen navigate={navigate} lastVerify={lastVerify} />
      )}
      {screen === 'sync' && <SyncScreen navigate={navigate} />}
    </View>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Push content below the system status bar (notch) — SafeAreaView was
    // deprecated, and react-native-safe-area-context would be another native dep.
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0,
  },
});
