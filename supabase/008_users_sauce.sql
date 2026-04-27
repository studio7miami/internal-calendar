-- Role / discipline label chosen at signup ("what's your sauce").
alter table public.users add column if not exists sauce text;
