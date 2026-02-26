export type CommissionCompletionStatus = 'none' | 'life_only' | 'nonlife_only' | 'both';

export function normalizeCommissionStatus(input?: string): CommissionCompletionStatus {
  if (input === 'life_only' || input === 'nonlife_only' || input === 'both') return input;
  return 'none';
}

export function mapCommissionToProfileState(input: CommissionCompletionStatus): {
  status: 'draft' | 'final-link-sent';
  lifeCompleted: boolean;
  nonlifeCompleted: boolean;
} {
  if (input === 'both') {
    return { status: 'final-link-sent', lifeCompleted: true, nonlifeCompleted: true };
  }
  if (input === 'life_only') {
    return { status: 'draft', lifeCompleted: true, nonlifeCompleted: false };
  }
  if (input === 'nonlife_only') {
    return { status: 'draft', lifeCompleted: false, nonlifeCompleted: true };
  }
  return { status: 'draft', lifeCompleted: false, nonlifeCompleted: false };
}
