const path = require('path');
const { getConfig } = require('react-native-builder-bob/babel-config');
const pkg = require('../package.json');

const root = path.resolve(__dirname, '..');

module.exports = getConfig(
  {
    presets: ['module:@react-native/babel-preset'],
    // Must stay last in the plugin list — handles Vision Camera frame-processor worklets.
    plugins: ['react-native-worklets-core/plugin'],
  },
  { root, pkg }
);
