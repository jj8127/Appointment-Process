// Per-request phase timings sent back as a Server-Timing header, so a caller can
// see how long each step took inside the function (and whether the worker had
// just booted). Names and durations only; never request data.
const WORKER_STARTED_AT = performance.now();
let workerRequests = 0;

export type ServerTiming = {
  mark: (name: string) => void;
  header: () => string;
};

export function startServerTiming(): ServerTiming {
  workerRequests += 1;
  const started = performance.now();
  const first = workerRequests === 1;
  const workerAgeMs = Math.round(started - WORKER_STARTED_AT);
  let last = started;
  const phases: [string, number][] = [];
  return {
    mark(name) {
      const now = performance.now();
      phases.push([name, now - last]);
      last = now;
    },
    header() {
      const total = performance.now() - started;
      return [
        `worker;desc="${first ? 'cold' : 'warm'}";dur=${workerAgeMs}`,
        ...phases.map(([name, dur]) => `${name};dur=${dur.toFixed(1)}`),
        `total;dur=${total.toFixed(1)}`,
      ].join(', ');
    },
  };
}

export function withServerTiming(response: Response, timing: ServerTiming): Response {
  try {
    response.headers.set('Server-Timing', timing.header());
    return response;
  } catch {
    // Immutable headers: copy once rather than lose the response.
    const headers = new Headers(response.headers);
    headers.set('Server-Timing', timing.header());
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}
