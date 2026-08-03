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

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
  UI_CONN_LOADING = 0, /* skeleton: no data yet */
  UI_CONN_LIVE,
  UI_CONN_STALE,       /* fetches succeed, data age > 90 s (amber chip) */
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
} ui_view_t;

/* One cap for both identity kinds: GBFS station ids are UUIDs (36 chars),
 * the longest id the API sends (>= MODEL_STOP_ID_LEN). */
#define UI_STOP_ID_LEN MODEL_BIKE_ID_LEN

typedef struct {
  /* Transport status is global (KTD-7): fetch outcomes, not data age. */
  ui_conn_t conn;
  uint32_t secs_since_fetch; /* M1 chip counter; migrates to age_s in U3.
                                (uint32: an overnight offline device must
                                not wrap at 18.2h and re-age from zero) */
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
} ui_state_t;

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

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_UI_STATE_H */
