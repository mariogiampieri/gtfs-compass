/*
 * ui_state.h — view/navigation state + identity reconciliation (plan U1).
 *
 * Split out of ui.h so this stays platform-free: it includes model.h only,
 * no LVGL — which is what lets ui_reconcile() run in the host test suite,
 * where the M2 identity races (indices shifting under the 30 s model swap,
 * R6/KTD-1) are actually caught. ui.h includes this header, so LVGL callers
 * see one surface.
 */
#ifndef GTFS_COMPASS_UI_STATE_H
#define GTFS_COMPASS_UI_STATE_H

#include <stdbool.h>
#include <stdint.h>

#include "model.h"
#include "pair_fsm.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Transport status only (KTD-7): what fetches are doing. STALE is not a
 * transport fact — it is derived per system from age_s[] at render time
 * (fetches can succeed while one system's upstream data ages past 90 s). */
typedef enum {
  UI_CONN_LOADING = 0, /* skeleton: no data yet */
  UI_CONN_LIVE,
  UI_CONN_OFFLINE,     /* fetches failing (red chip) */
  UI_CONN_NO_LOCATION, /* API 422 — the R10 screen */
} ui_conn_t;

/* Carousel positions in handoff order (rail ↔ bus ↔ bike, clamped). */
typedef enum {
  UI_SYS_RAIL = 0,
  UI_SYS_BUS = 1,
  UI_SYS_BIKE = 2,
  UI_SYS_COUNT = 3,
} ui_sys_t;

typedef enum {
  UI_VIEW_BOARD = 0,
  UI_VIEW_DETAIL,      /* trunk detail — rail only (handoff §2) */
  UI_VIEW_BIKE_NEARBY, /* nearby-compare list (handoff §4) */
  UI_VIEW_PAIRING,     /* RFC 8628 code display (pairing plan U5) */
} ui_view_t;

/* One cap for both identity kinds: GBFS station ids are UUIDs (36 chars),
 * the longest id the API sends (>= MODEL_STOP_ID_LEN). */
#define UI_STOP_ID_LEN MODEL_BIKE_ID_LEN

typedef struct {
  /* Transport status is global (KTD-7): fetch outcomes, not data age. */
  ui_conn_t conn;
  uint32_t secs_since_fetch; /* transport-level: seconds since the last
                                successful fetch landed — feeds "offline · Xm"
                                and the chip fallback for systems with no
                                data (age_s = -1, R3). (uint32: an overnight
                                offline device must not wrap at 18.2h and
                                re-age from zero) */
  int8_t battery_pct;        /* -1 = unknown (sim default feeds a constant) */
  bool flash_now;            /* 1.4 s green "now" flash after a fetch lands */

  /* Navigation (handoff state machine: sys, stopIdx[3], view, trunkIdx, dir). */
  uint8_t sys;   /* UI_SYS_* — carousel position */
  ui_view_t view;
  uint8_t dir;   /* 0/1 — global across board & detail, all trunks (R2) */

  /* Viewed-entity identity — what survives a model swap (R6). Written on
   * every navigation/selection; indices below are derived render-time cache
   * only, corrected by ui_reconcile() on every model arrival. */
  char stop_id[UI_SYS_COUNT][UI_STOP_ID_LEN]; /* rail stop / bike station id;
                                                 bus unused (KTD-6); "" = never
                                                 selected (adopt entity 0) */
  uint8_t stop_idx[UI_SYS_COUNT];
  char trunk_key[MODEL_TRUNK_KEY_LEN]; /* "" unless a detail view is open */
  uint8_t trunk_idx;                   /* render cache for trunk_key */

  /* Per-system data age, seconds; -1 = unknown. Seeded from each system's
   * initial_age_s on reconcile, ticked at 1 Hz by the caller. STALE is
   * evaluated per system — a system with no data never renders "stale"
   * (KTD-7). */
  int32_t age_s[UI_SYS_COUNT];

  /* Pairing (plan U5). pair_phase mirrors the net task's FSM snapshot; an
   * active session forces UI_VIEW_PAIRING via ui_pairing_update. pair_view_
   * dismissed tracks a swipe/tap away from a still-active session so the
   * code screen stays dismissed until re-requested (console `pair`).
   * pair_seconds decrements locally at 1 Hz from the published point-in-time
   * value (the departures minutes convention). `unpaired` is the revoked
   * marker: a token died since the last successful pair — rendered distinct
   * from never-paired, and outranking offline/no-location in the chip
   * (plan R11 precedence). */
  pair_state_t pair_phase;
  char pair_code[PAIR_USER_CODE_LEN];
  int32_t pair_seconds;
  uint8_t pair_epoch;        /* bumps on every console `pair`; a bump undoes
                                a dismissal so the live code re-displays */
  bool pair_rate_limited;    /* FAILED because the server said 429 — the
                                screen says "server busy", not "retry now" */
  bool pair_view_dismissed;
  bool unpaired;
  ui_view_t pair_prior_view; /* where dismissal/completion returns to */
} ui_state_t;

/* A published pairing snapshot, as ui_pairing_update consumes it. Mirrors
 * the net task's pairing message without depending on its header (the ui
 * component stays platform-free). */
typedef struct {
  pair_state_t phase;
  const char *code; /* NUL-terminated; may be "" */
  int32_t seconds;
  uint8_t epoch;
  bool rate_limited;
  bool unpaired;
} ui_pair_snapshot_t;

/* Canonical initializer: zeroes the struct (memcmp-safe padding) and sets
 * the unknown sentinels (age_s = -1, battery_pct = -1). Plain zeroing would
 * make every system read "0 s old", which KTD-7 forbids before a fetch. */
void ui_state_init(ui_state_t *state);

/* Re-find the viewed entities of a freshly parsed model by identity and
 * correct the index caches (R6: raw indices never survive a model swap).
 * Pure over (state, model): no I/O, no clock, no LVGL.
 *   - viewed rail stop / bike station found → index updated, view kept;
 *     gone → view = BOARD, index 0, identity adopts the new entity 0.
 *   - open trunk detail re-found by key (order shuffles are fine);
 *     gone → pops to board.
 *   - age_s seeded per present system from initial_age_s.
 *   - absent or cold (no_data) systems are left untouched — connectivity
 *     failures change treatment, never the view (R6). */
void ui_reconcile(ui_state_t *state, const model_nearby_t *model);

/* ui_reconcile for a model whose apply was deferred (R6 deferral contract):
 * the message sat staged for defer_s seconds while a press/animation was in
 * progress, so each system seeded this reconcile gets its age bumped by
 * defer_s — staleness is never under-reported. defer_s <= 0 is plain
 * reconcile. Pure like ui_reconcile (the caller supplies the elapsed time). */
void ui_reconcile_deferred(ui_state_t *state, const model_nearby_t *model, int32_t defer_s);

/*
 * Fold a published pairing snapshot into the state (pairing plan U5). Pure
 * like ui_reconcile. Rules:
 *   - STARTING/CODE_ACTIVE/EXPIRED/FAILED force UI_VIEW_PAIRING (saving the
 *     prior view) unless the user dismissed the session's screen;
 *   - PAIRED and IDLE restore the prior view;
 *   - an epoch bump (console `pair` re-issued) clears the dismissal so a
 *     live code re-displays;
 *   - model applies never touch the pairing view (reconcile leaves it be).
 * Returns true when the visible view changed (caller re-renders).
 */
bool ui_pairing_update(ui_state_t *state, const ui_pair_snapshot_t *snap);

/* A tap/swipe on the pairing screen: leave the view (session untouched —
 * dismissing the VIEW never cancels the session; the net task owns the FSM).
 * Returns false when the pairing view is not showing. */
bool ui_pairing_dismiss_view(ui_state_t *state);

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_UI_STATE_H */
