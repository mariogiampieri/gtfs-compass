/*
 * ui.h — the board screen's two-seam contract (plan U3).
 *
 * IDF-free: this component includes only LVGL and model.h; the device and
 * the SDL simulator are both just callers. Two seams, deliberately:
 *   ui_board_show()  — full render; applies a fresh ±4 px burn-in jitter.
 *   ui_board_tick()  — 1 Hz label-only update; no re-layout, no jitter.
 */
#ifndef GTFS_COMPASS_UI_H
#define GTFS_COMPASS_UI_H

#include <stdbool.h>
#include <stdint.h>

#include "lvgl.h"
#include "model.h"
/* ui_state_t + ui_reconcile() live in ui_state.h (LVGL-free, plan U1) so
 * the reconciler is host-testable; this header re-exports them for callers. */
#include "ui_state.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Build the static screen tree onto the default display. Call once. */
void ui_init(void);

/* Full render of the rail board (or state screen) from a parsed model. */
void ui_board_show(const model_nearby_t *model, const ui_state_t *state);

/* 1 Hz in-place update: countdown minutes NOT decremented here (the caller
 * owns time math per the spec — it decrements model etas and calls show on
 * poll); this refreshes the freshness chip text and flash only. */
void ui_board_tick(const ui_state_t *state);

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_UI_H */
