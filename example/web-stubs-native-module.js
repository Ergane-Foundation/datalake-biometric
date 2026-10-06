// The SDK's native module does not exist in a browser. Exporting null makes
// BiometricSDK raise its "native module is not available" error on first use,
// instead of the bundle failing to load.
export default null;
