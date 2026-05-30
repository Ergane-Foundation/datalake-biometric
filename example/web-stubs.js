// Stubs for native-only packages used in the example app.
// On web these packages don't exist; vite aliases them here so the build succeeds.
// None of these APIs will function in a browser — the web build is for bundling
// validation only, not runtime use.

// react-native-vision-camera
export const Camera = 'Camera';
export const useFrameProcessor = () => null;
export const useCameraDevice = () => null;
export const useCameraPermission = () => ({ hasPermission: false, requestPermission: async () => false });
export const useCameraFormat = () => null;
export const useCameraPermissions = () => [false, async () => false];

// react-native-vision-camera-face-detector
export const useFaceDetector = () => ({ detectFaces: () => [] });

// react-native-worklets-core
export const useRunOnJS = (fn) => fn;
export const useSharedValue = (v) => ({ value: v });
export const runOnJS = (fn) => fn;
export const Worklets = {};

// react-native-blob-util (default import)
export default {
  fs: {
    readFile: async () => '',
    writeFile: async () => {},
    unlink: async () => {},
    exists: async () => false,
  },
};
