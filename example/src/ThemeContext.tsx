import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'auto';

export interface ThemeColors {
  bg: string;
  bgAlt: string;
  text: string;
  textDim: string;
  primary: string;
  primaryLight: string;
  success: string;
  warn: string;
  danger: string;
  border: string;
  cardBg: string;
  cardAlt: string;
}

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
}

// ─── Palettes ────────────────────────────────────────────────────────────────

const lightColors: ThemeColors = {
  bg: '#F5F5F5',
  bgAlt: '#FFFFFF',
  text: '#222222',
  textDim: '#999999',
  primary: '#0B7285',
  primaryLight: '#D0E8E8',
  success: '#0E3D2E',
  warn: '#E67700',
  danger: '#C92A2A',
  border: '#CCCCCC',
  cardBg: '#FFFFFF',
  cardAlt: '#EEEEEE',
};

const darkColors: ThemeColors = {
  bg: '#121212',
  bgAlt: '#1E1E1E',
  text: '#FFFFFF',
  textDim: '#BBBBBB',
  primary: '#4DD0E1',
  primaryLight: '#0B7285',
  success: '#66BB6A',
  warn: '#FFA726',
  danger: '#EF5350',
  border: '#333333',
  cardBg: '#1E1E1E',
  cardAlt: '#2C2C2C',
};

// ─── Storage key ─────────────────────────────────────────────────────────────

const STORAGE_KEY = '@theme_mode';

// ─── Context ─────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'auto',
  isDark: false,
  colors: lightColors,
  setMode: () => {},
});

// ─── Provider ────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null
  const [mode, setModeState] = useState<ThemeMode>('auto');

  // Load persisted mode on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'auto') {
          setModeState(stored);
        }
      })
      .catch(() => {
        // If storage fails, stay with 'auto'
      });
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const isDark = useMemo(() => {
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return systemScheme === 'dark';
  }, [mode, systemScheme]);

  const colors = isDark ? darkColors : lightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, isDark, colors, setMode }),
    [mode, isDark, colors, setMode]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
