// Builds a disposable Expo project around the real native canvas and fictional fixture.
// Run: node scripts/testing/referral-graph-emulator.cjs (offline project preparation only)
/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const project = path.join(root, '.codex-tmp/referral-emulator');
const pkg = require(path.join(root, 'package.json'));
fs.mkdirSync(project, { recursive: true });
fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
  name: 'referral-graph-offline-qa', version: '1.0.0', private: true, main: 'index.js', dependencies: pkg.dependencies,
}, null, 2));
fs.writeFileSync(path.join(project, 'app.json'), JSON.stringify({ expo: {
  name: 'Referral graph offline QA', slug: 'referral-graph-offline-qa', scheme: 'hanwhafcpass',
  android: { package: 'com.jj8127.Garam_in' }, newArchEnabled: true,
} }, null, 2));
fs.writeFileSync(path.join(project, 'index.js'), "import { registerRootComponent } from 'expo';\nimport App from '../../scripts/testing/referral-graph-emulator/App';\nregisterRootComponent(App);\n");
fs.writeFileSync(path.join(project, 'babel.config.js'), "module.exports = { presets: ['babel-preset-expo'], plugins: ['react-native-reanimated/plugin'] };\n");
fs.writeFileSync(path.join(project, 'metro.config.js'), String.raw`
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const root = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);
config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.join(root, 'node_modules')];
config.resolver.blockList = [/[/\\]web[/\\]\.next[/\\]/];
config.resolver.resolveRequest = (context, name, platform) => {
  if (name.startsWith('@/')) return context.resolveRequest(context, path.join(root, name.slice(2)), platform);
  if (name === 'tslib' || name.startsWith('tslib/')) return { filePath: path.join(root, 'tslib-shim.js'), type: 'sourceFile' };
  return context.resolveRequest(context, name, platform);
};
module.exports = config;
`);
