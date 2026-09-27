-- An incident now offers several allowlisted fixes, with one suggested (by rules or AI) and why.
alter table incidents add column actions text[] not null default '{}';
alter table incidents add column reason text;
alter table incidents add column suggested_by text check (suggested_by in ('rules', 'ai'));
alter table incidents add column context jsonb not null default '{}';
