const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const exclusionList = require('metro-config/private/defaults/exclusionList').default;
const path = require('path');

const config = getSentryExpoConfig(__dirname);

// Keep development bundling bounded alongside Android Studio and other workspace tools.
config.maxWorkers = Math.min(config.maxWorkers || 2, 2);

config.resolver = config.resolver || {};

const escapePathForRegex = (filePath) => filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ignoredBuildDirs = [
  path.resolve(__dirname, 'web', '.next'),
  // Offline QA exports contain another app and generated native/build sources.
  // They must not enter the production development server's file map.
  path.resolve(__dirname, '.codex-tmp'),
].map((dir) => new RegExp(`${escapePathForRegex(dir)}(?:[/\\\\].*)?$`));

config.resolver.blockList = exclusionList([
  ...ignoredBuildDirs,
]);

// Use resolveRequest to intercept and redirect all tslib imports
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'tslib' || moduleName.startsWith('tslib/')) {
    return {
      filePath: path.resolve(__dirname, 'tslib-shim.js'),
      type: 'sourceFile',
    };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
