const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver = config.resolver || {};

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
