/*
 * ui_state.c — ui_reconcile(): re-find viewed entities by identity (plan U1).
 *
 * Pure C over (state, model): no LVGL, no IDF, no clock — the host suite
 * drives every case, because the races this guards against (the 30 s model
 * swap shifting indices under an open view, R6) are data facts, not
 * rendering facts (KTD-1). The identity strings written at navigation time
 * are the source of truth; stop_idx/trunk_idx are cache this function owns.
 */
#include "ui_state.h"

#include <string.h>

void ui_state_init(ui_state_t *state) {
  memset(state, 0, sizeof(*state));
  state->battery_pct = -1;
  for (int i = 0; i < UI_SYS_COUNT; i++) state->age_s[i] = -1;
}

/* Bounded copy; src is a NUL-terminated model field (already under cap). */
static void id_copy(char *dst, size_t cap, const char *src) {
  size_t n = strlen(src);
  if (n >= cap) n = cap - 1;
  memcpy(dst, src, n);
  dst[n] = '\0';
}

static int find_stop(const model_rail_system_t *rail, const char *id) {
  for (int i = 0; i < rail->stop_count; i++) {
    if (strcmp(rail->stops[i].id, id) == 0) return i;
  }
  return -1;
}

static int find_station(const model_bike_system_t *bike, const char *id) {
  for (int i = 0; i < bike->station_count; i++) {
    if (strcmp(bike->stations[i].id, id) == 0) return i;
  }
  return -1;
}

static int find_trunk(const model_stop_t *stop, const char *key) {
  for (int i = 0; i < stop->trunk_count; i++) {
    if (strcmp(stop->trunks[i].key, key) == 0) return i;
  }
  return -1;
}

/* Viewed entity of system s vanished: snap to entity 0 (id per first_id, or
 * "" when the list is empty) and pop any open sub-view back to the board. */
static void snap_to_first(ui_state_t *st, ui_sys_t s, const char *first_id) {
  st->stop_idx[s] = 0;
  st->stop_id[s][0] = '\0';
  if (first_id != NULL) id_copy(st->stop_id[s], UI_STOP_ID_LEN, first_id);
  if (s == UI_SYS_RAIL) {
    /* any open detail belonged to the vanished stop */
    st->trunk_key[0] = '\0';
    st->trunk_idx = 0;
    if (st->view == UI_VIEW_DETAIL) st->view = UI_VIEW_BOARD;
  }
  if (s == UI_SYS_BIKE && st->view == UI_VIEW_BIKE_NEARBY) st->view = UI_VIEW_BOARD;
}

void ui_reconcile(ui_state_t *st, const model_nearby_t *model) {
  /* ---- rail ---- */
  if (model->rail.present) {
    st->age_s[UI_SYS_RAIL] = model->rail.initial_age_s; /* KTD-7 seed */
    if (model->rail.stop_count > 0) {
      if (st->stop_id[UI_SYS_RAIL][0] == '\0') {
        /* never navigated: adopt stop 0, no view change */
        st->stop_idx[UI_SYS_RAIL] = 0;
        id_copy(st->stop_id[UI_SYS_RAIL], UI_STOP_ID_LEN, model->rail.stops[0].id);
      } else {
        int idx = find_stop(&model->rail, st->stop_id[UI_SYS_RAIL]);
        if (idx >= 0) st->stop_idx[UI_SYS_RAIL] = (uint8_t)idx;
        else snap_to_first(st, UI_SYS_RAIL, model->rail.stops[0].id);
      }
      /* open detail: re-find the trunk by key on the reconciled stop */
      if (st->view == UI_VIEW_DETAIL) {
        const model_stop_t *stop = &model->rail.stops[st->stop_idx[UI_SYS_RAIL]];
        int t = st->trunk_key[0] != '\0' ? find_trunk(stop, st->trunk_key) : -1;
        if (t >= 0) {
          st->trunk_idx = (uint8_t)t;
        } else {
          st->view = UI_VIEW_BOARD;
          st->trunk_key[0] = '\0';
          st->trunk_idx = 0;
        }
      }
    } else if (!model->rail.no_data) {
      /* fetched-and-empty: the viewed stop is really gone, nothing to adopt */
      snap_to_first(st, UI_SYS_RAIL, NULL);
    }
    /* cold (no_data): identity kept — treatment changes, never the view (R6) */
  }

  /* ---- bus: presence only in v1 (KTD-6) — no entities, no age source ---- */

  /* ---- bike ---- */
  if (model->bike.present) {
    st->age_s[UI_SYS_BIKE] = model->bike.initial_age_s;
    if (model->bike.station_count > 0) {
      if (st->stop_id[UI_SYS_BIKE][0] == '\0') {
        st->stop_idx[UI_SYS_BIKE] = 0;
        id_copy(st->stop_id[UI_SYS_BIKE], UI_STOP_ID_LEN, model->bike.stations[0].id);
      } else {
        int idx = find_station(&model->bike, st->stop_id[UI_SYS_BIKE]);
        if (idx >= 0) st->stop_idx[UI_SYS_BIKE] = (uint8_t)idx;
        else snap_to_first(st, UI_SYS_BIKE, model->bike.stations[0].id);
      }
    } else if (!model->bike.no_data) {
      snap_to_first(st, UI_SYS_BIKE, NULL);
    }
  }
}

bool ui_pairing_update(ui_state_t *st, pair_state_t phase, const char *code,
                       int32_t seconds, bool unpaired, uint8_t epoch) {
  bool changed = false;
  st->unpaired = unpaired;
  if (code != NULL && code[0] != '\0') id_copy(st->pair_code, PAIR_USER_CODE_LEN, code);
  if (phase == PAIR_CODE_ACTIVE) st->pair_seconds = seconds;
  if (epoch != st->pair_epoch) {
    st->pair_epoch = epoch;
    st->pair_view_dismissed = false; /* `pair` re-issued: re-display the code */
  }
  st->pair_phase = phase;
  bool visible = phase == PAIR_STARTING || phase == PAIR_CODE_ACTIVE ||
                 phase == PAIR_EXPIRED || phase == PAIR_FAILED;
  if (visible && !st->pair_view_dismissed) {
    if (st->view != UI_VIEW_PAIRING) {
      st->pair_prior_view = st->view;
      st->view = UI_VIEW_PAIRING;
      changed = true;
    }
  } else if (!visible && st->view == UI_VIEW_PAIRING) {
    /* PAIRED or IDLE: the session is over — restore where the user was. */
    st->view = st->pair_prior_view;
    changed = true;
  }
  return changed;
}

bool ui_pairing_dismiss_view(ui_state_t *st) {
  if (st->view != UI_VIEW_PAIRING) return false;
  st->pair_view_dismissed = true;
  st->view = st->pair_prior_view;
  return true;
}

void ui_reconcile_deferred(ui_state_t *st, const model_nearby_t *model, int32_t defer_s) {
  ui_reconcile(st, model);
  if (defer_s <= 0) return;
  /* Only the systems this reconcile seeded (present, known age) aged in the
   * stash; absent/cold systems keep their old 1 Hz-ticked counters. */
  if (model->rail.present && st->age_s[UI_SYS_RAIL] >= 0) st->age_s[UI_SYS_RAIL] += defer_s;
  if (model->bike.present && st->age_s[UI_SYS_BIKE] >= 0) st->age_s[UI_SYS_BIKE] += defer_s;
}
