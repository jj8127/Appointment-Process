// Directly require the original tslib file using a static path to satisfy Metro's static analyzer
// This assumes tslib-shim.js is in the project root and tslib is installed in node_modules
const tslib = require('./node_modules/tslib/tslib.js');

// Ensure we export a valid default for ESM/CommonJS interop
module.exports = {
  ...tslib,
  default: tslib,
  __esModule: true,
};
