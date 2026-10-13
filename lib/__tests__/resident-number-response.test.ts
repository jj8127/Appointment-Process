import {
  buildUnavailableResidentNumberEntries,
  parseResidentNumberEntries,
  parseResidentNumberReceipt,
} from '../resident-number-response';

describe('resident number response contract', () => {
  it('parses one canonical raw receipt for mobile and web adapters', () => {
    expect(parseResidentNumberReceipt({
      ok: true,
      residentNumbers: { 'fc-1': null },
      residentNumberStatuses: { 'fc-1': 'unavailable' },
    }, ['fc-1'])).toEqual({
      residentNumbers: { 'fc-1': null },
      residentNumberStatuses: { 'fc-1': 'unavailable' },
    });
    expect(parseResidentNumberReceipt({
      ok: true,
      residentNumbers: { 'fc-1': null },
      residentNumberStatuses: { 'fc-1': 'ready' },
    }, ['fc-1'])).toBeNull();
  });

  it('accepts the exact requested id set and distinguishes missing from unavailable', () => {
    expect(parseResidentNumberEntries({
      ok: true,
      residentNumbers: {
        'fc-ready': '900101-1234567',
        'fc-missing': null,
        'fc-unavailable': null,
      },
      residentNumberStatuses: {
        'fc-ready': 'ready',
        'fc-missing': 'missing',
        'fc-unavailable': 'unavailable',
      },
    }, ['fc-ready', 'fc-missing', 'fc-unavailable'])).toEqual({
      'fc-ready': { status: 'success', value: '900101-1234567' },
      'fc-missing': { status: 'success', value: null },
      'fc-unavailable': { status: 'error', value: null },
    });
  });

  it('builds a fail-closed per-row fallback without hiding the parent list', () => {
    expect(buildUnavailableResidentNumberEntries(['fc-1', 'fc-2'])).toEqual({
      'fc-1': { status: 'error', value: null },
      'fc-2': { status: 'error', value: null },
    });
  });

  it.each([
    {
      ok: true,
      residentNumbers: { 'fc-1': null },
      residentNumberStatuses: {},
    },
    {
      ok: true,
      residentNumbers: { 'fc-1': null, extra: null },
      residentNumberStatuses: { 'fc-1': 'missing', extra: 'missing' },
    },
    {
      ok: true,
      residentNumbers: { 'fc-1': '9001011234567' },
      residentNumberStatuses: { 'fc-1': 'ready' },
    },
    {
      ok: true,
      residentNumbers: { 'fc-1': null },
      residentNumberStatuses: { 'fc-1': 'ready' },
    },
  ])('rejects malformed or contradictory payload %#', (value) => {
    expect(() => parseResidentNumberEntries(value, ['fc-1']))
      .toThrow('resident_number_response_contract_invalid');
  });
});
