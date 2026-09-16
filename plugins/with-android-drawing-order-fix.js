const {
  withAppBuildGradle,
  withGradleProperties,
  withSettingsGradle,
} = require("expo/config-plugins");
const {
  patchAndroidAppBuildGradle,
  patchAndroidGradleProperties,
  patchAndroidSettingsGradle,
} = require("../scripts/patches/android-drawing-order-instrumentation.cjs");

function withAndroidDrawingOrderFix(config) {
  const configWithSettingsGuard = withSettingsGradle(config, (modConfig) => {
    const result = patchAndroidSettingsGradle(modConfig.modResults.contents);
    modConfig.modResults.contents = result.source;
    return modConfig;
  });

  const configWithAppPlugin = withAppBuildGradle(
    configWithSettingsGuard,
    (modConfig) => {
      const result = patchAndroidAppBuildGradle(
        modConfig.modResults.contents,
      );
      modConfig.modResults.contents = result.source;
      return modConfig;
    },
  );

  return withGradleProperties(configWithAppPlugin, (modConfig) => {
    const result = patchAndroidGradleProperties(modConfig.modResults);
    modConfig.modResults = result.properties;
    return modConfig;
  });
}

module.exports = withAndroidDrawingOrderFix;
