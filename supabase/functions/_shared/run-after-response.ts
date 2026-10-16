// Lets a handler answer first and keep working afterwards. On Supabase Edge the
// runtime keeps the worker alive for promises handed to EdgeRuntime.waitUntil;
// elsewhere (local tests) the promise simply runs on. A failure never surfaces
// as an unhandled rejection: it goes to onError, which must not throw either.
type EdgeRuntimeLike = { waitUntil: (promise: Promise<unknown>) => void };

export function runAfterResponse(
  task: () => Promise<unknown>,
  onError?: (error: unknown) => void,
): Promise<void> {
  const guarded = Promise.resolve()
    .then(task)
    .then(() => undefined)
    .catch((error) => {
      try {
        onError?.(error);
      } catch {
        // A reporting failure must not escape the background task.
      }
    });
  const runtime = (globalThis as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;
  if (runtime && typeof runtime.waitUntil === 'function') {
    runtime.waitUntil(guarded);
  }
  return guarded;
}
