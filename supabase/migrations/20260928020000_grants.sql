-- Only the server (service role) may consume or refund free fixes. Explicit, rather than relying
-- on the platform's default privileges surviving the earlier revoke.
grant execute on function consume_free_run(uuid, int), refund_free_run(uuid) to service_role;
