# Plan

## Increment 9
- Goal: send internal messenger reminders to the remaining blocked missing-recommender rows and regenerate the operator list with send status.
- Outcome: complete.
- Notes:
  - Verified that `01058006018` is a `developer` account, so the internal messenger actor id must stay the phone number itself, not `admin`.
  - Sent `34` internal messages with two variants: `31 missing_candidate`, `3 self_referral`.
  - Generated `fc-missing-recommender-2026-04-22-outreach.*` with `outreach_required`, `blocked_reason`, and `message_status`.

## Increment 8
- Goal: classify and reconcile unresolved legacy recommender links with a policy-safe exact-unique batch.
- Outcome: complete.
- Notes:
  - Dry-run classification found `4 ready + 3 needs_code + 31 missing_candidate + 3 self_referral`.
  - Applied exact-unique reconciliation for 7 invitees after issuing 2 missing inviter codes.
  - Remaining 34 are intentionally blocked pending manual operator review.

## Increment 1
- Goal: move internal messenger list/unread aggregation to shared server helpers and typed mobile clients.
- Outcome: complete.

## Increment 2
- Goal: remove repeated client-side polling/N+1 paths from admin messenger, chat, messenger hub, home, notifications, and request-board refresh flow.
- Outcome: complete.

## Increment 3
- Goal: deploy `fc-notify` changes, capture Android QA evidence, and validate unread/read behavior in the emulator.
- Outcome: partially complete.
- Notes:
  - Internal admin messenger list/chat/read evidence was captured.
  - Provided developer/admin login path still shows session-sync instability and remains for manual follow-up.

## Increment 4
- Goal: restore missing back buttons on `메신저` and `가람지사 메신저` found during QA.
- Outcome: complete.

## Increment 5
- Goal: update harness/log/mistake docs and leave a clean remaining manual QA checklist for the user.
- Outcome: complete.

## Increment 6
- Goal: expand the new animated loading treatment from messenger-only screens to every remaining `ActivityIndicator` surface in `app/*` and `components/*`.
- Outcome: complete.

## Increment 7
- Goal: stabilize mobile login after backend auth success by removing font-backed pending spinner dependency, avoiding eager landing-route replacement, and damping repeated push-token registration attempts.
- Outcome: complete.
