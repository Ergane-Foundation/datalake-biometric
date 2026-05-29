import { StyleSheet } from 'react-native';

export const colors = {
  bg: '#0B1020',
  card: '#161C2E',
  cardAlt: '#1F2740',
  border: '#2A3350',
  text: '#E8ECF6',
  textDim: '#9AA6C4',
  primary: '#4F8CFF',
  success: '#34D399',
  warn: '#FBBF24',
  danger: '#F87171',
  accent: '#A78BFA',
};

export const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: 20,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    color: colors.textDim,
    fontSize: 14,
    marginBottom: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 14,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardBody: {
    color: colors.textDim,
    fontSize: 13,
    lineHeight: 19,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  buttonGhostText: {
    color: colors.text,
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
  statLabel: {
    color: colors.textDim,
    fontSize: 13,
  },
  statValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
