import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('notification delivery attempt audit migration', () => {
  it('stores only aggregate provider outcomes behind service-role access', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260806080624_add_notification_delivery_attempt_audit.sql',
      ),
      'utf8',
    );

    expect(source).toContain('create table if not exists public.notification_delivery_attempts');
    expect(source).toContain('notification_id uuid not null references public.notifications(id) on delete cascade');
    expect(source).toContain('provider_response_status smallint');
    expect(source).toContain('accepted integer not null check (accepted between 0 and attempted)');
    expect(source).toContain('revoke all privileges on table public.notification_delivery_attempts');
    expect(source).toContain('to service_role');
    expect(source).not.toContain('expo_push_token');
    expect(source).not.toContain('ticket_id');
  });
});
