"use server";

// The old recovery marker was not proof that the exchanged code was a recovery
// code and was not bound to the current session. Until a provider-verified,
// session-bound recovery flow is implemented and tested against real Auth,
// direct calls must not update any password, even with an old marker or session.
export async function resetPassword(..._args: unknown[]) {
  void _args;
  return { error: true };
}
