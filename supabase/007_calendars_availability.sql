-- Per-calendar weekly availability (JS weekday: 0=Sun .. 6=Sat). Used for member requests + UI slot hints.
alter table public.calendars
  add column if not exists availability_weekly jsonb not null default '[
    {"weekday":1,"start":"09:00","end":"17:00"},
    {"weekday":2,"start":"09:00","end":"17:00"},
    {"weekday":3,"start":"09:00","end":"17:00"},
    {"weekday":4,"start":"09:00","end":"17:00"},
    {"weekday":5,"start":"09:00","end":"17:00"}
  ]'::jsonb;

comment on column public.calendars.availability_weekly is 'Weekly open windows; weekday matches JS Date.getDay() (Sun=0).';
