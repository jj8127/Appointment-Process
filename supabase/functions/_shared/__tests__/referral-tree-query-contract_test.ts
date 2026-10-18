/// <reference lib="deno.ns" />

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  parseActiveReferralCodeRows,
  parseReferralAdminAccountRows,
  parseReferralAdminPhoneRows,
  parseReferralChildProfiles,
  parseReferralChildRows,
  parseReferralCodeHistoryRows,
  parseReferralManagerAccountRows,
  parseReferralProfilesForIds,
  parseReferralProfilesForPhone,
  parseReferralTreeRows,
} from '../referral-tree-query-contract.ts';

const rootId = '10000000-0000-4000-8000-000000000001';
const childId = '20000000-0000-4000-8000-000000000001';
const foreignId = '30000000-0000-4000-8000-000000000001';
const rowId = '40000000-0000-4000-8000-000000000001';
const phone = '01012345678';

const profile = {
  id: rootId,
  name: '조회자',
  phone,
  affiliation: '가상본부',
  recommender_fc_id: null,
  is_manager_referral_shadow: false,
  signup_completed: true,
  appointment_date_life: null,
  appointment_date_nonlife: '2026-10-13',
  life_commission_completed: false,
  nonlife_commission_completed: true,
};

const rootRow = {
  fc_id: rootId,
  name: '조회자',
  affiliation: '가상본부',
  active_code: 'ABCD1234',
  parent_fc_id: null,
  node_depth: 0,
  relationship_source: 'root' as const,
  direct_invitee_count: 1,
  total_descendant_count: 1,
  is_ancestor: false,
};

const childRow = {
  ...rootRow,
  fc_id: childId,
  active_code: null,
  parent_fc_id: rootId,
  node_depth: 1,
  relationship_source: 'linked' as const,
  direct_invitee_count: 0,
  total_descendant_count: 0,
};

Deno.test('referral profile rows require a complete unique requested ID set', () => {
  assertEquals(parseReferralProfilesForIds([profile], [rootId]), [profile]);
  assertEquals(parseReferralProfilesForIds(null, [rootId]), null);
  assertEquals(parseReferralProfilesForIds([], [rootId]), null);
  assertEquals(parseReferralProfilesForIds([{ ...profile, id: foreignId }], [rootId]), null);
  assertEquals(parseReferralProfilesForIds([profile, profile], [rootId]), null);
  assertEquals(parseReferralProfilesForIds([{ ...profile, signup_completed: null }], [rootId]), null);
  assertEquals(parseReferralProfilesForIds([{ ...profile, appointment_date_nonlife: '2026-02-30' }], [rootId]), null);
  assertEquals(parseReferralProfilesForIds([], [rootId], false), []);
});

Deno.test('referral profile phone reads bind the only row to the signed phone', () => {
  assertEquals(parseReferralProfilesForPhone([profile], phone), [profile]);
  assertEquals(parseReferralProfilesForPhone(null, phone), null);
  assertEquals(parseReferralProfilesForPhone([profile, profile], phone), null);
  assertEquals(parseReferralProfilesForPhone([{ ...profile, phone: 'invalid' }], phone), null);
  assertEquals(parseReferralProfilesForPhone([{ ...profile, phone: '01099999999' }], phone), null);
});

Deno.test('referral code reads reject malformed, duplicate, and unrequested rows', () => {
  const history = { id: rowId, fc_id: rootId };
  assertEquals(parseReferralCodeHistoryRows([history], [rootId]), [history]);
  assertEquals(parseReferralCodeHistoryRows(null, [rootId]), null);
  assertEquals(parseReferralCodeHistoryRows([history, history], [rootId]), null);
  assertEquals(parseReferralCodeHistoryRows([{ ...history, fc_id: foreignId }], [rootId]), null);

  const active = { ...history, code: 'ABCD1234', created_at: '2026-10-13T00:00:00Z' };
  assertEquals(parseActiveReferralCodeRows([active], [rootId]), [active]);
  assertEquals(parseActiveReferralCodeRows([{ ...active, code: null }], [rootId]), null);
  assertEquals(parseActiveReferralCodeRows([
    active,
    { ...active, id: foreignId },
  ], [rootId]), null);
});

Deno.test('referral child reads reject duplicate, self-linked, and unrequested parents', () => {
  const child = { id: childId, recommender_fc_id: rootId, is_manager_referral_shadow: false };
  assertEquals(parseReferralChildRows([child], [rootId]), [child]);
  assertEquals(parseReferralChildRows(null, [rootId]), null);
  assertEquals(parseReferralChildRows([child, child], [rootId]), null);
  assertEquals(parseReferralChildRows([{ ...child, recommender_fc_id: foreignId }], [rootId]), null);
  assertEquals(parseReferralChildRows([{ ...child, id: rootId }], [rootId]), null);

  const childProfile = { ...profile, id: childId, recommender_fc_id: rootId };
  assertEquals(parseReferralChildProfiles([childProfile], [rootId]), [childProfile]);
  assertEquals(
    parseReferralChildProfiles([{ ...childProfile, phone: 'invalid' }], [rootId]),
    [{ ...childProfile, phone: 'invalid' }],
  );
  assertEquals(parseReferralChildProfiles([{ ...childProfile, recommender_fc_id: null }], [rootId]), null);
});

Deno.test('referral staff reads bind exact phones and reject malformed success payloads', () => {
  const manager = { id: rowId, name: '본부장', phone, active: true };
  const admin = { id: rowId, phone, staff_type: 'admin', active: true };
  assertEquals(parseReferralManagerAccountRows([manager], phone), [manager]);
  assertEquals(parseReferralManagerAccountRows(null, phone), null);
  assertEquals(parseReferralManagerAccountRows([{ ...manager, phone: '01099999999' }], phone), null);
  assertEquals(parseReferralManagerAccountRows([{ ...manager, active: false }], phone, true), null);
  assertEquals(parseReferralAdminAccountRows([admin], phone), [admin]);
  assertEquals(parseReferralAdminAccountRows([{ ...admin, staff_type: 'manager' }], phone), null);
  assertEquals(parseReferralAdminAccountRows([{ ...admin, active: false }], phone, true), null);

  const adminPhone = { id: rowId, phone };
  assertEquals(parseReferralAdminPhoneRows([adminPhone]), [adminPhone]);
  assertEquals(parseReferralAdminPhoneRows([adminPhone, adminPhone]), null);
  assertEquals(parseReferralAdminPhoneRows([{ ...adminPhone, phone: null }]), null);
});

Deno.test('referral RPC rows require one exact root and a coherent unique tree', () => {
  assertEquals(parseReferralTreeRows([rootRow, childRow], rootId, 2), [rootRow, childRow]);
  assertEquals(parseReferralTreeRows([], rootId, 2), []);
  assertEquals(parseReferralTreeRows(null, rootId, 2), null);
  assertEquals(parseReferralTreeRows([rootRow, rootRow], rootId, 2), null);
  assertEquals(parseReferralTreeRows([{ ...rootRow, fc_id: foreignId }], rootId, 2), null);
  assertEquals(parseReferralTreeRows([rootRow, { ...childRow, parent_fc_id: foreignId }], rootId, 2), null);
  assertEquals(parseReferralTreeRows([rootRow, { ...childRow, node_depth: 3 }], rootId, 2), null);
  assertEquals(parseReferralTreeRows([rootRow, { ...childRow, total_descendant_count: null }], rootId, 2), null);
  assertEquals(parseReferralTreeRows([rootRow, { ...childRow, direct_invitee_count: 1 }], rootId, 2), null);
  assertEquals(parseReferralTreeRows([rootRow, {
    ...childRow,
    fc_id: foreignId,
    parent_fc_id: null,
    node_depth: -2,
    is_ancestor: true,
  }], rootId, 2), null);
  assertEquals(parseReferralTreeRows([rootRow, {
    ...childRow,
    fc_id: foreignId,
    parent_fc_id: rootId,
    node_depth: -1,
    is_ancestor: true,
  }], rootId, 2), null);
});
