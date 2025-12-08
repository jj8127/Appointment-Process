// Shim to ensure tslib has a default export for Metro (web/native)
const ts = require('tslib');

// Provide both named helpers and a default pointing to the same object
module.exports = {
  default: ts,
  ...ts,
};
