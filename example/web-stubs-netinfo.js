// Stub for @react-native-community/netinfo on web.
// Web build is for bundling validation only — NetInfo APIs are no-ops here.
export default {
  addEventListener: () => () => {},
  fetch: async () => ({ isConnected: true, isInternetReachable: true, type: 'unknown' }),
  configure: () => {},
  useNetInfo: () => ({ isConnected: true, type: 'unknown' }),
};
