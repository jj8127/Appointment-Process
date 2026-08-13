export type ExamApplicationHistoryGuardState =
  | 'not-required'
  | 'loading'
  | 'error'
  | 'ready';

type ExamApplicationHistoryQueryState = {
  enabled: boolean;
  isLoading: boolean;
  isFetching: boolean;
  hasError: boolean;
};

export function getExamApplicationHistoryGuardState({
  enabled,
  isLoading,
  isFetching,
  hasError,
}: ExamApplicationHistoryQueryState): ExamApplicationHistoryGuardState {
  if (!enabled) return 'not-required';
  if (hasError) return 'error';
  if (isLoading || isFetching) return 'loading';
  return 'ready';
}

type ExamApplicationRouteHydrationKeyInput = {
  actorId?: string | null;
  examType: 'life' | 'nonlife';
  registrationId?: string | null;
  roundId?: string | null;
};

export function getExamApplicationRouteHydrationKey({
  actorId,
  examType,
  registrationId,
  roundId,
}: ExamApplicationRouteHydrationKeyInput): string | null {
  const normalizedActorId = actorId?.trim();
  const normalizedRegistrationId = registrationId?.trim();
  const normalizedRoundId = roundId?.trim();

  if (!normalizedActorId) return null;
  if (!!normalizedRegistrationId === !!normalizedRoundId) return null;

  return normalizedRegistrationId
    ? `${normalizedActorId}:${examType}:registration:${normalizedRegistrationId}`
    : `${normalizedActorId}:${examType}:round:${normalizedRoundId}`;
}
