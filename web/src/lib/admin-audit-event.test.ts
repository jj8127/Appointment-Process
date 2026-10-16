import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAdminAuditRow,
  describeAuditDetail,
  monthRange,
  summarizeFcActionPayload,
  toAuditAction,
} from './admin-audit-event.ts';

const FC_ID = '10000000-0000-4000-8000-000000000001';
const actor = { role: 'admin' as const, staffType: 'admin' as const, residentDigits: '010-0000-0001' };

test('audit rows keep actor digits, target and counts; managers carry no staff type', () => {
  assert.deepEqual(buildAdminAuditRow(actor, { category: 'fc_action', action: 'update_status', targetFcId: FC_ID, detail: { status: 'docs-approved' } }), {
    actor_role: 'admin', actor_staff_type: 'admin', actor_phone: '01000000001', category: 'fc_action', action: 'update_status',
    target_fc_id: FC_ID, target_count: 1, detail: { status: 'docs-approved' }, reason: null,
  });
  const manager = buildAdminAuditRow({ role: 'manager', staffType: null, residentDigits: '01000000002' }, { category: 'export', action: 'exam_applicants_xlsx', targetCount: 30, reason: ' 협회 시험 접수 ' });
  assert.equal(manager.actor_staff_type, null);
  assert.equal(manager.target_fc_id, null);
  assert.equal(manager.target_count, 30);
  assert.equal(manager.reason, '협회 시험 접수');
});

test('audit rows reject resident-number-shaped content, bad actors and bad actions', () => {
  assert.throws(() => buildAdminAuditRow(actor, { category: 'fc_action', action: 'x', detail: { note: '900101-1234567' } }), /detail_rejected/);
  assert.throws(() => buildAdminAuditRow(actor, { category: 'export', action: 'x', reason: '9001011234567' }), /reason_rejected/);
  assert.throws(() => buildAdminAuditRow({ ...actor, residentDigits: '12' }, { category: 'fc_action', action: 'x' }), /invalid_actor/);
  assert.throws(() => buildAdminAuditRow(actor, { category: 'fc_action', action: 'Update Status' }), /invalid_action/);
  assert.equal(buildAdminAuditRow(actor, { category: 'fc_action', action: 'x', targetFcId: 'not-a-uuid' }).target_fc_id, null);
});

test('FC action payloads keep codes and edited field names, never values', () => {
  const detail = summarizeFcActionPayload({
    fcId: FC_ID, status: 'docs-approved', docType: '시험 서류', title: '가상 제목', msg: '가상 본문',
    data: { name: '가상 이름', phone: '01000000003', temp_id: 'T-1' },
  });
  assert.deepEqual(detail, { status: 'docs-approved', docType: '시험 서류', fields: ['name', 'phone', 'temp_id'] });
  assert.equal(JSON.stringify(detail).includes('가상 이름'), false);
  assert.deepEqual(summarizeFcActionPayload(null), {});
});

test('API action names map to stored snake_case actions', () => {
  assert.equal(toAuditAction('updateDocStatus'), 'update_doc_status');
  assert.equal(toAuditAction('markDawichokUrlSent'), 'mark_dawichok_url_sent');
});

test('month ranges follow Korea time and reject malformed months', () => {
  assert.deepEqual(monthRange('2026-10'), { from: '2026-09-30T15:00:00.000Z', to: '2026-10-31T15:00:00.000Z' });
  assert.deepEqual(monthRange('2026-12'), { from: '2026-11-30T15:00:00.000Z', to: '2026-12-31T15:00:00.000Z' });
  assert.equal(monthRange('2026-13'), null);
  assert.equal(monthRange('2026-1'), null);
});

test('history descriptions summarize each category', () => {
  assert.equal(describeAuditDetail({ category: 'export', targetCount: 30, detail: {}, reason: '협회 시험 접수' }), '30명 · 협회 시험 접수');
  assert.equal(describeAuditDetail({ category: 'personal_info_view', targetCount: 3, detail: { source: 'exam_applicants' }, reason: null }), '3명 · 시험 신청자 목록');
  assert.equal(describeAuditDetail({ category: 'fc_action', targetCount: 1, detail: { from: 'applied', to: 'confirmed' }, reason: null }), 'applied → confirmed');
  assert.equal(describeAuditDetail({ category: 'fc_action', targetCount: 1, detail: { fields: ['name'] }, reason: null }), '항목: name');
});
