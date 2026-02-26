# Manager Blocked Case CLI Evidence

- generatedAt: 2026-02-26T07:04:43.596Z
- scope: RB-08, P0-02(partial-api)
- managerPhoneSuffix: 3560

## RB-08
- manager login-with-password: 200
- request_board login(role=fc): 200
- fc-codes company-names: 200 (count=28)
- fc-codes create: 201 (id=452)
- fc-codes patch: 200
- fc-codes list after patch: 200
- fc-codes delete: 200
- fc-codes list after delete: 200

## P0-02 (partial API)
- manager admin-action unauthorized: 403

## Cleanup
- keepData: false
- executedAt: 2026-02-26T07:04:53.376Z

