alter table public.notifications
  drop constraint if exists notifications_recipient_role_check;

alter table public.notifications
  add constraint notifications_recipient_role_check
  check (recipient_role in ('admin','fc','manager'));
