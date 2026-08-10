import { adminAssistedSignupSchema } from '../admin-assisted-signup-validation';

function seoulDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const readPart = (type: 'year' | 'month' | 'day') => (
    Number(parts.find((part) => part.type === type)?.value ?? 0)
  );
  const date = new Date(Date.UTC(readPart('year'), readPart('month') - 1, readPart('day')));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

const validInput = () => ({
  requestId: '11111111-1111-4111-8111-111111111111',
  name: '가상사용자',
  phone: '01000000000',
  affiliation: '1본부 서선미',
  email: 'fictional@example.com',
  carrier: 'SKT',
  licenseStatuses: ['life', 'third'],
  inviterFcId: '22222222-2222-4222-8222-222222222222',
  consentObtainedOn: seoulDate(),
  evidenceReference: 'CONSENT-TEST-001',
  password: 'Temporary1!',
  confirmPassword: 'Temporary1!',
  consentAttested: true,
});

describe('administrator-assisted signup validation', () => {
  it('accepts a fictional complete request without phone OTP fields', () => {
    const result = adminAssistedSignupSchema.safeParse(validInput());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('phoneVerified');
      expect(result.data.evidenceReference).toBe('CONSENT-TEST-001');
    }
  });

  it('requires the written-consent attestation and a recent date', () => {
    const missingAttestation = adminAssistedSignupSchema.safeParse({
      ...validInput(),
      consentAttested: false,
    });
    const staleConsent = adminAssistedSignupSchema.safeParse({
      ...validInput(),
      consentObtainedOn: seoulDate(-91),
    });
    expect(missingAttestation.success).toBe(false);
    expect(staleConsent.success).toBe(false);
  });

  it('rejects mixed none status, password mismatch, and PII-like free-form references', () => {
    const result = adminAssistedSignupSchema.safeParse({
      ...validInput(),
      licenseStatuses: ['none', 'life'],
      confirmPassword: 'Different1!',
      evidenceReference: '동의서 본문을 입력하지 않습니다',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toEqual(expect.arrayContaining([
        'licenseStatuses',
        'confirmPassword',
        'evidenceReference',
      ]));
    }
  });
});
