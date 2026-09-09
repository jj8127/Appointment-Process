const { withSettingsGradle } = require("expo/config-plugins");
const {
  patchAndroidSettingsGradle,
} = require("../scripts/patches/apply-android-drawing-order-fix.cjs");

function withAndroidDrawingOrderFix(config) {
  return withSettingsGradle(config, (modConfig) => {
    const result = patchAndroidSettingsGradle(modConfig.modResults.contents);
    modConfig.modResults.contents = result.source;
    return modConfig;
  });
}

module.exports = withAndroidDrawingOrderFix;
