// Server-only database primitive. The caller MUST derive actorId from a verified server-side
// session, never directly from a request. This module is not an authentication mechanism.
// A compromised server or runtime DB credential can impersonate identities by setting the GUC.
export async function withActorTransaction(pool, actorId, work) {
  if (typeof actorId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)) throw new Error('Verified actor UUID required');
  const client = await pool.connect();
  let open = false;
  let discard = false;
  try {
    await client.query('BEGIN');
    open = true;
    const check = await client.query(`SELECT current_user AS role,
      NULLIF(pg_catalog.current_setting('paidflow.actor_id', true), '') AS stale_actor,
      NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles p
        WHERE (p.rolsuper OR p.rolbypassrls OR p.rolcreatedb OR p.rolcreaterole OR p.rolreplication)
        AND pg_catalog.pg_has_role(current_user, p.oid, 'MEMBER')) AS restricted,
      NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND pg_catalog.pg_has_role(current_user,c.relowner,'MEMBER')) AS not_owner`);
    const state = check.rows[0];
    if (state?.role !== 'paidflow_runtime' || !state.restricted || !state.not_owner || state.stale_actor) {
      discard = true;
      throw new Error('Unsafe runtime role or stale actor context');
    }
    await client.query("SELECT pg_catalog.set_config('paidflow.actor_id', $1, true)", [actorId]);
    const result = await work(client);
    await client.query('COMMIT');
    open = false;
    // Never return a connection carrying session-scoped actor state to the pool. The
    // transaction already committed, so a cleanup failure must not report it as rolled back.
    try {
      const after = await client.query("SELECT NULLIF(pg_catalog.current_setting('paidflow.actor_id', true), '') AS actor");
      if (after.rows[0]?.actor) discard = true;
    } catch { discard = true; }
    return result;
  } catch (error) {
    if (open) {
      try { await client.query('ROLLBACK'); } catch { discard = true; }
    } else { discard = true; }
    throw error;
  } finally {
    client.release(discard);
  }
}
