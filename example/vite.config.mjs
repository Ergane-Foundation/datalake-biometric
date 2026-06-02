import { defineConfig, mergeConfig } from 'vite';

import config from 'react-native-builder-bob/vite-config';
import pack from '../package.json' with { type: 'json' };

const webStub = new URL('./web-stubs.js', import.meta.url);
const netinfoStub = new URL('./web-stubs-netinfo.js', import.meta.url);

export default defineConfig((env) =>
  mergeConfig(config(env), {
    resolve: {
      alias: {
        [pack.name]: new URL('..', import.meta.url),
        'react-native-vision-camera': webStub,
        'react-native-vision-camera-face-detector': webStub,
        'react-native-worklets-core': webStub,
        'react-native-blob-util': webStub,
        '@react-native-community/netinfo': netinfoStub,
      },
      dedupe: Object.keys(pack.peerDependencies),
    },
  })
);
