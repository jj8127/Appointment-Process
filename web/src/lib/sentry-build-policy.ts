const SENTRY_UPLOAD_DISABLE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export type SentryBuildUploadPolicy = {
  disabled: boolean;
  authToken: string | undefined;
  telemetry: boolean | undefined;
  useRunAfterProductionCompileHook: boolean | undefined;
  release: { create: false; finalize: false } | undefined;
  sourcemaps: { disable: boolean };
};

export function isSentryUploadDisabled(value: string | undefined): boolean {
  return SENTRY_UPLOAD_DISABLE_VALUES.has(value?.trim().toLowerCase() ?? '');
}

export function resolveSentryBuildUploadPolicy(
  disableValue: string | undefined,
  configuredAuthToken: string | undefined,
): SentryBuildUploadPolicy {
  const disabled = isSentryUploadDisabled(disableValue);

  if (!disabled) {
    return {
      disabled: false,
      authToken: configuredAuthToken,
      telemetry: undefined,
      useRunAfterProductionCompileHook: undefined,
      release: undefined,
      sourcemaps: { disable: false },
    };
  }

  return {
    disabled: true,
    // The Sentry bundler plugin uses nullish fallback to SENTRY_AUTH_TOKEN.
    // An empty string is intentional: unlike undefined, it blocks that fallback.
    authToken: '',
    telemetry: false,
    useRunAfterProductionCompileHook: false,
    release: { create: false, finalize: false },
    sourcemaps: { disable: true },
  };
}
