/*
 * ui.h — the view layer's public contract (plan U3).
 *
 * IDF-free: this component includes only LVGL and model.h; the device and
 * the SDL simulator are both just callers. The seams:
 *   ui_render()        — full render dispatched over (model, state): view ×
 *                        system (KTD-3); applies a fresh ±4 px burn-in jitter.
 *   ui_tick()          — 1 Hz label-only chip update; no re-layout, no jitter.
 *   ui_jitter_nudge()  — burn-in nudge for label-only minute ticks in
 *                        long-dwell views (R7).
 *   ui_views_on_tap/ui_views_on_swipe — gesture routing: hit-test the last
 *                        render / map the swipe, mutate state via ui_nav,
 *                        return whether a re-render is due.
 */
#ifndef GTFS_COMPASS_UI_H
#define GTFS_COMPASS_UI_H

#include <stdbool.h>
#include <stdint.h>

#include "lvgl.h"
#include "model.h"
/* ui_state_t + ui_reconcile() (LVGL-free, plan U1) and the pure navigation
 * transitions (LVGL-free, plan U3) — re-exported for callers. */
#include "ui_input.h"
#include "ui_nav.h"
#include "ui_state.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Build the static screen tree onto the default display. Call once. */
void ui_init(void);

/* Full render of the current (view, system) from a parsed model. model may
 * be NULL before the first fetch (skeleton / R10 location-unknown screen). */
void ui_render(const model_nearby_t *model, const ui_state_t *state);

/* 1 Hz in-place update: countdown minutes NOT decremented here (the caller
 * owns time math per the spec — it decrements model etas and re-renders on
 * its minute clock); this refreshes the freshness chip text/color only. */
void ui_tick(const ui_state_t *state);

/* Re-roll the jitter container position without a rebuild (R7: label-only
 * minute ticks in long-dwell views). */
void ui_jitter_nudge(void);

/* R7 minute-decrement hook for the detail view: the caller has already
 * decremented the model's etas; this rewrites the visible countdown labels
 * in place — no tree rebuild, scroll offset untouched, so it needs no
 * press/animation gate. No-op unless the last full render was this detail
 * view. */
void ui_detail_minute_tick(const model_nearby_t *model, const ui_state_t *state);

/* Tap router: resolve (x, y) against the current view's tap targets (pill,
 * trunk rows, ‹ back, bike board) and apply the navigation. Returns true
 * when state changed and a re-render is due. */
bool ui_views_on_tap(int32_t x, int32_t y, const model_nearby_t *model, ui_state_t *state);

/* Swipe router: the handoff swipe vocabulary via ui_nav (system carousel /
 * stop cycling / pop-to-board). Returns true when a re-render is due. */
bool ui_views_on_swipe(ui_swipe_t swipe, const model_nearby_t *model, ui_state_t *state);

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_UI_H */
