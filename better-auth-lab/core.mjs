import { betterAuth } from 'better-auth';
import { withActorTransaction } from '../neon/runtime/with-actor.mjs';

// Isolated local-only implementation: never publish test emails or auth tokens.
export function createLabAuth({ authPool, baseURL, secret, mail }) {
  const auth = betterAuth({
    baseURL,
    basePath: '/api/better-auth-lab',
    secret,
    database: authPool,
    trustedOrigins: [baseURL],
    advanced: { database: { generateId: 'uuid' }, cookiePrefix: 'paidflow_ba_lab', disableCSRFCheck: false, disableOriginCheck: false },
    verification: { storeIdentifier: 'hashed' },
    session: { expiresIn: 86400, updateAge: 60, cookieCache: { enabled: false } },
    emailAndPassword: {
      enabled: true, autoSignIn: false, requireEmailVerification: true,
      minPasswordLength: 8, maxPasswordLength: 72, resetPasswordTokenExpiresIn: 900,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url, token }) => mail({ kind:'reset', email:user.email, url, token }),
    },
    emailVerification: { sendOnSignUp: true, autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url, token }) => mail({ kind:'verify', email:user.email, url, token }),
    },
    telemetry: { enabled: false },
    logger: { disabled: true },
    // Unknown failures must not be printed by better-call, whose default error
    // logger can include sensitive database error details.
    onAPIError: { throw: true },
  });
  const handler = auth.handler;
  auth.handler = async request => {
    try { return await handler(request); }
    catch { return new Response(null, {status:500, headers:{"Cache-Control":"no-store"}}); }
  };
  return auth;
}

// The business id is only a selector; the actor is never accepted from the caller.
export async function withVerifiedBusiness({ auth, runtimePool, headers, businessId, allowedRoles, work }) {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id || !session.user.emailVerified) throw new Error('UNAUTHENTICATED');
  if (typeof businessId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(businessId)) throw new Error('FORBIDDEN');
  return withActorTransaction(runtimePool, session.user.id, async (db) => {
    const result = await db.query("SELECT role FROM public.business_members WHERE business_id=$1 AND user_id=$2 AND status='active'", [businessId, session.user.id]);
    const membership = result.rows[0];
    if (!membership || !allowedRoles.includes(membership.role)) throw new Error('FORBIDDEN');
    return work(db, { userId: session.user.id, role: membership.role });
  });
}

// The one protected operation that necessarily precedes having a membership.
export async function createInitialBusiness({ auth, runtimePool, headers, input, key }) {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id || !session.user.emailVerified) throw new Error('UNAUTHENTICATED');
  return withActorTransaction(runtimePool, session.user.id, async (db) => {
    const result = await db.query('SELECT public.onboard_business($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) AS id', [
      key, input.name, input.legalName ?? null, input.businessType, input.address, input.city,
      input.district, input.stateCode, input.pincode, input.gstRegistered, input.gstin ?? null,
      input.udyam ?? null, input.invoicePrefix, input.termsDays,
    ]);
    return result.rows[0].id;
  });
}
