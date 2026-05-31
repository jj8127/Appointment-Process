type BuildResidentNumberEdgeFallbackRequestOptions = {
  supabaseUrl: string;
  serviceKey: string;
  staffPhone: string;
  fcIds: string[];
};

export function buildResidentNumberEdgeFallbackRequest({
  supabaseUrl,
  serviceKey,
  staffPhone,
  fcIds,
}: BuildResidentNumberEdgeFallbackRequestOptions): { url: string; init: RequestInit } {
  return {
    url: `${supabaseUrl}/functions/v1/admin-action`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        adminPhone: staffPhone,
        action: 'getResidentNumbers',
        payload: { fcIds },
      }),
    },
  };
}
