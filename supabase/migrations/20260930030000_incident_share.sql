-- A public link per resolved incident, made the first time its owner shares it (a random id, not the incident id).
alter table incidents add column share_slug text unique check (share_slug ~ '^[a-z0-9]{12}$');
