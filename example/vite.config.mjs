import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';

import config from 'react-native-builder-bob/vite-config';
import pack from '../package.json' with { type: 'json' };

// The web build only checks that the example bundles. Native-only packages are
// replaced with stubs that render the UI without any camera or SDK behavior.
const local = (file) => fileURLToPath(new URL(file, import.meta.url));
const webStub = local('./web-stubs.js');

export default defineConfig((env) =>
  mergeConfig(config(env), {
    resolve: {
      alias: [
        { find: pack.name, replacement: local('..') },
        // react-native-web has no TurboModuleRegistry.
        { find: /^\.\/NativeDatalakeBiometric$/, replacement: local('./web-stubs-native-module.js') },
        { find: 'react-native-vision-camera-face-detector', replacement: webStub },
        { find: 'react-native-vision-camera', replacement: webStub },
        { find: 'react-native-worklets-core', replacement: webStub },
        { find: 'react-native-blob-util', replacement: webStub },
        { find: '@react-native-community/netinfo', replacement: local('./web-stubs-netinfo.js') },
      ],
      dedupe: Object.keys(pack.peerDependencies),
    },
  })
);
