/**
 * Environment-variable parsing, in one place because more than one seam needs
 * it and none of them should own it.
 *
 * This module exists to break a cycle rather than to add a layer: `intVar`
 * lived in `locate.ts` for historical reasons, so once `locate.ts` needed
 * `hasScope` from `auth.ts` — which already read its session lifetimes through
 * `intVar` — the two files imported each other. That cycle happened to be
 * harmless (both directions are hoisted function declarations touched only
 * inside function bodies, never at module-eval time), but "harmless today" is
 * a poor property for the credential chokepoint to rest on, and any later
 * module-level constant on either side would have turned it into a real
 * initialization order bug.
 */

/**
 * Positive-integer env var with fallback.
 *
 * Note the `> 0`: this rejects `0` as well as garbage, which is correct for the
 * timeouts, windows and accuracy gates it was written for — none of them means
 * anything at zero. It is **not** correct for an abuse budget, where `0` is a
 * deliberate kill switch; `email.ts`'s `budgetVar` is the parser for those, and
 * the split is intentional.
 */
export function intVar(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
