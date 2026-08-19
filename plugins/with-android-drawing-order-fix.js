const {
  withGradleProperties,
  withSettingsGradle,
} = require("expo/config-plugins");
const {
  patchAndroidGradleProperties,
  patchAndroidSettingsGradle,
} = require("../scripts/patches/apply-android-drawing-order-fix.cjs");

function withAndroidDrawingOrderFix(config) {
  const configWithSettingsGuard = withSettingsGradle(config, (modConfig) => {
    const result = patchAndroidSettingsGradle(modConfig.modResults.contents);
    modConfig.modResults.contents = result.source;
    return modConfig;
  });

  return withGradleProperties(configWithSettingsGuard, (modConfig) => {
    const result = patchAndroidGradleProperties(modConfig.modResults);
    modConfig.modResults = result.properties;
    return modConfig;
  });
}

module.exports = withAndroidDrawingOrderFix;
