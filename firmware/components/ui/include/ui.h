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

typedef struct {
  ui_conn_t conn;
  uint32_t secs_since_fetch; /* chip counter; ticks locally at 1 Hz
                                (uint32: an overnight offline device must
                                not wrap at 18.2h and re-age from zero) */
  int8_t battery_pct;        /* -1 = unknown (sim default feeds a constant) */
  bool flash_now;            /* 1.4 s green "now" flash after a fetch lands */
  uint8_t stop_idx;          /* which stop of the rail system is shown */
} ui_state_t;

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
