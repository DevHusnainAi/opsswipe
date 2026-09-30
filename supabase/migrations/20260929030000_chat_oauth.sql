-- "Add to Slack" / "Add to Discord" finish on the server too, like GitHub and Google.
alter table oauth_states drop constraint oauth_states_kind_check;
alter table oauth_states add constraint oauth_states_kind_check check (kind in ('github', 'google', 'slack', 'discord'));
