/*
 * ui_nav.h — pure navigation transitions over (state, model) (plan U3).
 *
 * LVGL-free like ui_state.h: this is the ONE implementation of the handoff
 * state machine that device gestures (via ui_views' tap/swipe routing) and
 * sim keys both call, so the two input paths cannot drift (R2). Every
 * function returns true when the state changed and a re-render is due;
 * identity strings (stop_id / trunk_key) are written here at navigation
 * time — ui_reconcile() re-finds them after the next model swap (R6).
 */
#ifndef GTFS_COMPASS_UI_NAV_H
#define GTFS_COMPASS_UI_NAV_H

#include <stdbool.h>
#include <stdint.h>

#include "model.h"
#include "ui_state.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Finger-travel direction (mirrors ui_input's ui_swipe_t values; kept
 * separate so this header stays LVGL-free — ui_views maps between them). */
typedef enum {
  UI_NAV_LEFT = 0, /* finger travelled left — next-system gesture */
  UI_NAV_RIGHT,
  UI_NAV_UP, /* finger travelled up — next-stop gesture */
  UI_NAV_DOWN,
} ui_nav_dir_t;

/* The handoff swipe vocabulary:
 *   - horizontal on the board: sys ± 1, clamped, no wrap;
 *     in DETAIL/BIKE_NEARBY: pops to the board instead (view first, R2);
 *   - vertical: stop cycling, rail board only, wraps (M1 j/k behavior),
 *     remembered per system; writes the new stop's identity. */
bool ui_nav_swipe(ui_state_t *st, const model_nearby_t *model, ui_nav_dir_t dir);

/* Board row tap: open the trunk detail for trunks[trunk_idx] of the viewed
 * rail stop; writes trunk_key + trunk_idx (identity first, index as cache). */
bool ui_nav_open_detail(ui_state_t *st, const model_nearby_t *model, uint8_t trunk_idx);

/* Bike board tap: open the nearby-compare list (handoff §4). */
bool ui_nav_open_nearby(ui_state_t *st, const model_nearby_t *model);

/* Nearby row tap: stations[idx] becomes the current station (identity
 * written to stop_id[bike], R6) and the view pops to the bike board — the
 * ONLY transition that changes the bike selection (R2). */
bool ui_nav_select_station(ui_state_t *st, const model_nearby_t *model, uint8_t idx);

/* ‹ back (or first horizontal swipe): pop to the board. Never touches the
 * bike station selection — only a nearby-row tap changes it (R2). */
bool ui_nav_back(ui_state_t *st);

/* ⇅ pill: flip direction. dir is global — board & detail, all trunks. */
bool ui_nav_flip_dir(ui_state_t *st);

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_UI_NAV_H */
