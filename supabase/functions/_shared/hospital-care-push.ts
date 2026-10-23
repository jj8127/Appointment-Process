import { collectUnregisteredExpoTokens } from './expo-push-delivery.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_PUSH_CHUNK_SIZE = 100;
const EXPO_PUSH_TIMEOUT_MS = 10_000;

/** Push data the app routes to the care reservation screen without a notification inbox row. */
export const HOSPITAL_CARE_PUSH_DATA = { kind: 'hospital_care' } as const;

export type HospitalCarePushMessage = { title: string; body: string };

/** Message to the member for a staff decision. No name, hospital or health detail leaves the server. */
export function careAnswerMessage(status: string): HospitalCarePushMessage | null {
  if (status === 'confirmed') return { title: '간병 예약 확정', body: '간병 예약이 확정되었습니다. 간병 시작 전 확인할 내용을 봐 주세요.' };
  if (status === 'adjusted') return { title: '간병 예약 일정 조정', body: '간병 예약 일정 조정 안내가 도착했습니다.' };
  if (status === 'declined') return { title: '간병 예약 답변', body: '간병 예약 답변이 도착했습니다.' };
  return null;
}

export const NEW_CARE_REQUEST_MESSAGE: HospitalCarePushMessage = {
  title: '새 간병 예약 요청',
  body: '새 간병 예약 요청이 접수되었습니다. 제휴·정산 관리에서 확인해 주세요.',
};

export function overdueCareMessage(count: number): HospitalCarePushMessage {
  return { title: '간병 예약 첫 연락 지연', body: `첫 연락 기한을 넘긴 간병 예약 요청이 ${count}건 있습니다.` };
}

export function buildCarePushPayloads(tokens: readonly string[], message: HospitalCarePushMessage) {
  return [...new Set(tokens.filter((token) => typeof token === 'string' && token.length > 0))].map((to) => ({
    to, title: message.title, body: message.body, sound: 'default', channelId: 'alerts', data: HOSPITAL_CARE_PUSH_DATA,
  }));
}

/** Sends in Expo-sized chunks and returns tokens Expo reports as no longer registered. */
export async function sendCarePush(
  tokens: readonly string[],
  message: HospitalCarePushMessage,
  fetcher: typeof fetch = fetch,
): Promise<string[]> {
  const payloads = buildCarePushPayloads(tokens, message);
  const unregistered: string[] = [];
  for (let index = 0; index < payloads.length; index += EXPO_PUSH_CHUNK_SIZE) {
    const chunk = payloads.slice(index, index + EXPO_PUSH_CHUNK_SIZE);
    const response = await fetcher(EXPO_PUSH_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(EXPO_PUSH_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    unregistered.push(...collectUnregisteredExpoTokens(chunk, response.status, body));
  }
  return unregistered;
}
