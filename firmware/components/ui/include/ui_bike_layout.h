/*
 * ui_bike_layout.h — pure layout math for the bike screens (plan U5; R5).
 *
 * LVGL-free like ui_state.h/ui_nav.h: hero strings and capacity-bar segment
 * widths are data facts over one model_bike_station_t, so the R5 degraded
 * permutations (-1 sentinels vs real zeros, missing capacity) are host-
 * testable where the conflation bugs would actually be caught. ui_bike.c
 * only draws what this computes; the §4 nearby mini-bars reuse it too.
 */
#ifndef GTFS_COMPASS_UI_BIKE_LAYOUT_H
#define GTFS_COMPASS_UI_BIKE_LAYOUT_H

#include <stdbool.h>
#include <stdint.h>

#include "model.h"

#ifdef __cplusplus
extern "C" {
#endif

#define UI_BIKE_HERO_LEN 8

typedef struct {
  /* Hero strings (R5): a real count renders its number ("0" is a fact —
   * an actually-empty station); an unknown renders "—", never zero.
   * bikes = classic + electric, only when BOTH are known — one unknown
   * addend makes the sum unknown. docks stands alone. */
  char bikes[UI_BIKE_HERO_LEN];
  char docks[UI_BIKE_HERO_LEN];

  /* All three live counts known (classic, electric, docks >= 0). False →
   * the renderer shows the muted "counts unavailable" note (R5). */
  bool counts_known;

  /* Bar drawable: counts_known AND capacity > 0 — without a capacity there
   * are no proportions to draw (R5: capacity == -1 with real counts →
   * counts shown, bar hidden). */
  bool show_bar;

  /* Segment pixel widths for a bar_w-wide bar with `gap` px between
   * present segments; 0 = segment absent (zero count draws nothing, not a
   * sliver). Present widths always sum to bar_w - gap * (present - 1). */
  int16_t classic_w;
  int16_t electric_w;
  int16_t empty_w;
} ui_bike_layout_t;

/* Compute hero strings + segment widths for one station. Counts above
 * capacity clamp the empty segment to absent (never negative). Pure:
 * no I/O, no LVGL, no clock. */
void ui_bike_layout_compute(const model_bike_station_t *s, int16_t bar_w,
                            int16_t gap, ui_bike_layout_t *out);

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_UI_BIKE_LAYOUT_H */
