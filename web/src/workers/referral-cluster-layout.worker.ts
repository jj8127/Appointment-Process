import { buildReferralClusterLayout } from '../lib/referral-graph-cluster-layout';

// Only anonymous geometry crosses this boundary; never profile or session fields.
self.onmessage = (event: MessageEvent<Parameters<typeof buildReferralClusterLayout>[0]>) => {
  try {
    self.postMessage({ ok: true, layout: buildReferralClusterLayout(event.data) });
  } catch {
    self.postMessage({ ok: false });
  }
};
