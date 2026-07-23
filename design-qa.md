# Design QA

- Reference: administrator exam-applicant detail screenshot supplied on 2026-07-24.
- Target: move the payment-proof section from the left information column into the right reception-status card, below the status summary and above the reception action.
- Source verification: passed. `PaymentProofCard` is rendered only inside the `lg: 4` right column and precedes the `mt="auto"` reception action.
- Responsive contract: passed by source contract. The grid collapses both columns to `base: 12` while preserving status summary → proof → action order.
- Browser capture: blocked. The local protected route redirected to `/auth`, and no authenticated administrator session was available in the in-app browser. No credentials were guessed or read.
- Remaining visual check: inspect the authenticated detail page after deployment at desktop and single-column widths.

final result: blocked
