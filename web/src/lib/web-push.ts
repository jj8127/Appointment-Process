type WebPushSubscription = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

type WebPushPayload = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/**
 * Backward-compatible no-op.
 *
 * Incoming administrator work is surfaced only through the canonical in-app
 * notification center. Keeping the function shape prevents older server code
 * from turning that policy change into a user-visible delivery failure while
 * guaranteeing that no Web Push provider request is made.
 */
export async function sendWebPush(
  subscriptions: WebPushSubscription[],
  payload: WebPushPayload,
) {
  void subscriptions;
  void payload;

  return {
    sent: 0,
    failed: 0,
    expired: [] as string[],
    mode: 'in_app_only' as const,
  };
}
