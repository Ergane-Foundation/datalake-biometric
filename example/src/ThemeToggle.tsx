import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme, type ThemeMode } from './ThemeContext';

const BUTTONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'light', label: '☀️' },
  { mode: 'dark', label: '🌙' },
  { mode: 'auto', label: '🔄' },
];

export function ThemeToggle() {
  const { mode, setMode, colors } = useTheme();

  return (
    <View style={styles.row}>
      {BUTTONS.map((btn) => {
        const active = mode === btn.mode;
        return (
          <TouchableOpacity
            key={btn.mode}
            activeOpacity={0.75}
            onPress={() => setMode(btn.mode)}
            style={[
              styles.button,
              {
                backgroundColor: active ? colors.primary : colors.cardAlt,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={styles.label}>{btn.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 18,
  },
});
