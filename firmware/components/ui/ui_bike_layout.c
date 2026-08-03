/*
 * ui_bike_layout.c — pure bike-screen layout math (plan U5; R5).
 *
 * The degraded-trio distinctions live here as arithmetic: -1 is "unknown"
 * and renders "—"; 0 is a real count and renders "0". The capacity bar
 * exists only when every count AND the capacity are known — a proportion
 * over unknowns would be an invented fact.
 */
#include "ui_bike_layout.h"

#include <stdio.h>
#include <string.h>

void ui_bike_layout_compute(const model_bike_station_t *s, int16_t bar_w,
                            int16_t gap, ui_bike_layout_t *out) {
  memset(out, 0, sizeof(*out));

  bool bikes_known = s->bikes_classic >= 0 && s->bikes_electric >= 0;
  if (bikes_known) {
    snprintf(out->bikes, sizeof(out->bikes), "%d",
             (int)s->bikes_classic + (int)s->bikes_electric);
  } else {
    snprintf(out->bikes, sizeof(out->bikes), "—");
  }
  if (s->docks_open >= 0) {
    snprintf(out->docks, sizeof(out->docks), "%d", (int)s->docks_open);
  } else {
    snprintf(out->docks, sizeof(out->docks), "—");
  }

  out->counts_known = bikes_known && s->docks_open >= 0;
  out->show_bar = out->counts_known && s->capacity > 0;
  if (!out->show_bar) return;

  /* Segment counts: classic / electric / remainder-of-capacity ("empty" —
   * open docks plus anything disabled). Over-capacity counts clamp the
   * empty segment to absent rather than going negative. */
  int32_t classic = s->bikes_classic;
  int32_t electric = s->bikes_electric;
  int32_t empty = (int32_t)s->capacity - classic - electric;
  if (empty < 0) empty = 0;
  int32_t total = classic + electric + empty; /* >= capacity > 0 */

  int present = (classic > 0) + (electric > 0) + (empty > 0);
  if (present == 0) return; /* capacity > 0 but all counts 0: nothing to draw */
  int32_t usable = (int32_t)bar_w - (int32_t)gap * (present - 1);
  if (usable < present) usable = present; /* degenerate tiny bars */

  int32_t classic_w = classic > 0 ? usable * classic / total : 0;
  int32_t electric_w = electric > 0 ? usable * electric / total : 0;
  int32_t empty_w = 0;
  /* The last present segment absorbs the integer-division remainder so the
   * present widths always sum to `usable`. */
  if (empty > 0) {
    empty_w = usable - classic_w - electric_w;
  } else if (electric > 0) {
    electric_w = usable - classic_w;
  } else {
    classic_w = usable;
  }
  out->classic_w = (int16_t)classic_w;
  out->electric_w = (int16_t)electric_w;
  out->empty_w = (int16_t)empty_w;
}
