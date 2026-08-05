/*
 * ui_nav.c — pure navigation transitions (plan U3; R2, R6).
 *
 * No LVGL, no clock, no I/O: host-testable next to ui_reconcile, because
 * the carousel clamp / pop-before-sys-change / identity-write rules are
 * data facts. Rendering reacts to the state these functions produce.
 */
#include "ui_nav.h"

#include <string.h>

#include "gc_str.h"

static bool sys_delta(ui_state_t *st, int delta) {
  int next = (int)st->sys + delta;
  if (next < 0 || next >= UI_SYS_COUNT) return false; /* clamped, no wrap */
  st->sys = (uint8_t)next;
  return true;
}

/* Vertical swipe cycles the current system's entities: rail stops AND bike
 * stations (handoff "swipe ↑/↓ = next/prev stop, board only" — Mario
 * expected station cycling on the bike board, on-device 2026-08-03; the
 * nearby list remains the compare/jump path). Bus has no entities (KTD-6).
 * Wraps, matching the M1 j/k behavior. */
static bool stop_delta(ui_state_t *st, const model_nearby_t *model, int delta) {
  if (model == NULL) return false;
  if (st->sys == UI_SYS_RAIL) {
    const model_rail_system_t *rail = &model->rail;
    if (!rail->present || rail->stop_count < 2) return false;
    int n = rail->stop_count;
    int next = ((int)st->stop_idx[UI_SYS_RAIL] + delta + n) % n;
    st->stop_idx[UI_SYS_RAIL] = (uint8_t)next;
    gc_copy_bounded(st->stop_id[UI_SYS_RAIL], UI_STOP_ID_LEN, rail->stops[next].id);
    return true;
  }
  if (st->sys == UI_SYS_BIKE) {
    const model_bike_system_t *bike = &model->bike;
    if (!bike->present || bike->no_data || bike->station_count < 2) return false;
    int n = bike->station_count;
    int next = ((int)st->stop_idx[UI_SYS_BIKE] + delta + n) % n;
    st->stop_idx[UI_SYS_BIKE] = (uint8_t)next;
    gc_copy_bounded(st->stop_id[UI_SYS_BIKE], UI_STOP_ID_LEN, bike->stations[next].id);
    return true;
  }
  return false;
}

bool ui_nav_swipe(ui_state_t *st, const model_nearby_t *model, ui_nav_dir_t dir) {
  bool horizontal = dir == UI_NAV_LEFT || dir == UI_NAV_RIGHT;
  if (st->view == UI_VIEW_PAIRING) {
    /* A swipe leaves the code screen (session untouched); vertical swipes
     * mean nothing here (pairing plan U5). */
    return horizontal ? ui_pairing_dismiss_view(st) : false;
  }
  if (st->view != UI_VIEW_BOARD) {
    /* In a detail view a horizontal swipe first pops to the board (R2);
     * vertical belongs to the scroll object (the tracker stands down when
     * one exists — a resolved vertical swipe here means nothing). */
    return horizontal ? ui_nav_back(st) : false;
  }
  switch (dir) {
    case UI_NAV_LEFT: return sys_delta(st, +1);
    case UI_NAV_RIGHT: return sys_delta(st, -1);
    case UI_NAV_UP: return stop_delta(st, model, +1);
    case UI_NAV_DOWN: return stop_delta(st, model, -1);
  }
  return false;
}

bool ui_nav_open_detail(ui_state_t *st, const model_nearby_t *model, uint8_t trunk_idx) {
  if (st->view != UI_VIEW_BOARD || st->sys != UI_SYS_RAIL || model == NULL) return false;
  const model_rail_system_t *rail = &model->rail;
  if (!rail->present || rail->stop_count == 0) return false;
  uint8_t s = st->stop_idx[UI_SYS_RAIL] < rail->stop_count ? st->stop_idx[UI_SYS_RAIL] : 0;
  const model_stop_t *stop = &rail->stops[s];
  if (trunk_idx >= stop->trunk_count) return false;
  st->view = UI_VIEW_DETAIL;
  st->trunk_idx = trunk_idx;
  gc_copy_bounded(st->trunk_key, MODEL_TRUNK_KEY_LEN, stop->trunks[trunk_idx].key);
  return true;
}

bool ui_nav_open_nearby(ui_state_t *st, const model_nearby_t *model) {
  if (st->view != UI_VIEW_BOARD || st->sys != UI_SYS_BIKE || model == NULL) return false;
  if (!model->bike.present || model->bike.station_count == 0) return false;
  st->view = UI_VIEW_BIKE_NEARBY;
  return true;
}

bool ui_nav_select_station(ui_state_t *st, const model_nearby_t *model, uint8_t idx) {
  if (st->view != UI_VIEW_BIKE_NEARBY || model == NULL) return false;
  const model_bike_system_t *bike = &model->bike;
  if (!bike->present || idx >= bike->station_count) return false;
  st->stop_idx[UI_SYS_BIKE] = idx;
  gc_copy_bounded(st->stop_id[UI_SYS_BIKE], UI_STOP_ID_LEN, bike->stations[idx].id);
  st->view = UI_VIEW_BOARD; /* §4: tap a row → that station, back to board */
  return true;
}

bool ui_nav_back(ui_state_t *st) {
  if (st->view == UI_VIEW_BOARD) return false;
  st->view = UI_VIEW_BOARD;
  st->trunk_key[0] = '\0';
  st->trunk_idx = 0;
  /* deliberately no touch of stop_id[UI_SYS_BIKE]: backing out of the
   * nearby list keeps the current station (R2) */
  return true;
}

bool ui_nav_flip_dir(ui_state_t *st) {
  st->dir ^= 1;
  return true;
}
