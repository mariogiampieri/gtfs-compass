/**
 * relay.ts — the one seam that owns `device_fixes` (Phase 5 plan, U7;
 * requirements R11, R14).
 *
 * **This file exists early, and holds one function.** The relay proper —
 * `putFixForUser` (the account-scoped fan-out write) and `getFix` (the
 * per-device read the locate chain consumes) — is U7, milestone 3. What landed
 * ahead of it is `clearFix`, because U10 ships the control that revokes
 * `read:fix`, and R9 is explicit that revocation is *immediate on both sides,
 * not merely prospective*: turning the grant off has to remove the position
 * already delivered, not just stop the next one. Had that DELETE been deferred
 * with the rest of the relay, every deployment between M2 and M3 would have had
 * a revocation control that silently left the last fix sitting in the table for
 * a device the user had just cut off — and there would have been no honest test
 * to write for it, only a pending one.
 *
 * The function lives here rather than inline in `routes/config.ts` on purpose.
 * The plan's Definition of Done makes it a shipped property that **no SQL
 * touches `device_fixes` outside this seam**, which is what keeps the
 * documented D1→Durable-Object upgrade a three-function change with no data
 * migration. A `DELETE FROM device_fixes` in a route would have cost that
 * property for one line of convenience.
 *
 * Shape is RPC, deliberately — `(env, id) => Promise<…>`, never an exported
 * `D1PreparedStatement`. A statement builder would let a caller batch the
 * delete into its own transaction, which is tempting (see `routes/config.ts`,
 * where revoke-then-clear is two writes) and is exactly the coupling that would
 * make the storage swap a rewrite of every call site rather than a rewrite of
 * this file.
 *
 * **Residual, tracked and deliberately not papered over:** R9's other half —
 * "the locate chain skips the phone provider unless the resolved credential
 * currently carries the scope" — is U8's, and cannot exist yet because the
 * chain has no phone provider to skip (`locate.ts` resolves WiFi → unknown).
 * So `clearFix` closes the *stored-state* half of AE6d and nothing more: after
 * a revocation there is no row for a future chain to read. The read-side gate
 * is a separate control for a separate failure (a fix written between the
 * revocation and the delete, or by a fan-out that raced it), and U8 owns it.
 */

/**
 * Drop this device's stored fix. Idempotent: no row is a normal outcome, not
 * an error — a device that was never granted `read:fix`, or was granted it and
 * never had a phone post one, has nothing to clear.
 *
 * Callers revoke the grant *first* and clear *second*, never the other way
 * round. The order is what closes the window against a concurrent
 * `putFixForUser`, whose fan-out predicate is "this user's devices holding
 * `read:fix` and not revoked" (R11): a fan-out that begins after the revocation
 * selects nothing for this device, so the delete is the last write. Clearing
 * first would leave the grant live for the duration of the delete, and a post
 * landing in that gap would re-create the row that was just removed.
 *
 * @returns whether a row was actually removed — for the caller's logging and
 * for tests that need to tell "cleared" from "there was nothing to clear".
 */
export async function clearFix(env: Env, deviceId: string): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM device_fixes WHERE device_id = ?1")
    .bind(deviceId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
