const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver = config.resolver || {};

// Force tslib (and its internal paths) to resolve to the shim so ESM default interop works in Metro (web/native).
config.resolver.alias = {
  ...(config.resolver.alias || {}),
  tslib: path.resolve(__dirname, 'tslib-shim.js'),
  'tslib/modules/index.js': path.resolve(__dirname, 'tslib-shim.js'),
  'tslib/tslib.js': path.resolve(__dirname, 'tslib-shim.js'),
};

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  tslib: path.resolve(__dirname, 'tslib-shim.js'),
};

module.exports = config;
