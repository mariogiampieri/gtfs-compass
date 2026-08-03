/*
 * ui_views.c — view dispatcher, chrome, carousel, tap/swipe routing (plan U3).
 *
 * KTD-3: views are functions over (model, state), full-rebuild style —
 * ui_render() deletes the whole tree and rebuilds for the current
 * (view, sys), which keeps state handling trivial and re-rolls the burn-in
 * jitter on every navigation. Chrome (status chip, battery, mode dots,
 * degraded overlay) is shared here; per-view content renders into one
 * content container.
 *
 * The carousel renders per-system from a descriptor table (KTD-6): bus
 * becoming a real feed is additive — model widening plus a new renderer,
 * never an unhardcoded "sys 1 is empty" special case in the dispatch.
 *
 * KTD-7 chip: freshness is the CURRENT system's data age (age_s[sys]);
 * a system with no data (-1) falls back to transport-level freshness and
 * never renders "stale". Transport failures (OFFLINE / NO_LOCATION) are
 * global. R3's partial indicator: a small amber dot beside the chip when
 * the current system's payload is incomplete.
 *
 * Tap routing hit-tests against the objects of the LAST full render; the
 * render-request deferral in main.c guarantees the tree cannot change
 * between press and release, so press-time and release-time hit-testing
 * see the same objects (KTD-2's snapshot requirement).
 *
 * DETAIL is the real §2 renderer (ui_detail.c, plan U4); the bike board and
 * BIKE_NEARBY are the real §3–4 renderers (ui_bike.c, plan U5).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ui.h"
#include "ui_input.h"
#include "ui_internal.h"
#include "ui_nav.h"
#include "ui_tokens.h"

static lv_obj_t *g_root;    /* black screen */
static lv_obj_t *g_jitter;  /* full-screen container carrying the offset */
static lv_obj_t *g_content; /* everything below the chip */
static lv_obj_t *g_chip_dot;
static lv_obj_t *g_chip_label;
static ui_board_hits_t g_hits;   /* rail board tap targets */
static ui_detail_hits_t g_detail_hits; /* trunk detail tap targets (U4) */
static ui_nearby_hits_t g_nearby_hits; /* §4 nearby-compare tap targets (U5) */
static bool g_skeleton_shown;    /* skeleton owns content opacity (its shimmer
                                    anim would fight the 60% degraded set) */

static lv_color_t hex(uint32_t rgb) { return lv_color_hex(rgb); }

const lv_font_t *ui_header_font(size_t name_len, bool *two_line) {
  *two_line = false;
  if (name_len <= 12) return TK_FONT_TITLE_LG;
  if (name_len <= 18) return TK_FONT_TITLE_MD;
  *two_line = true;
  return TK_FONT_TITLE_SM;
}

lv_obj_t *ui_make_label(lv_obj_t *parent, const char *text, const lv_font_t *font,
                        uint32_t color) {
  lv_obj_t *l = lv_label_create(parent);
  lv_label_set_text(l, text);
  lv_obj_set_style_text_font(l, font, 0);
  lv_obj_set_style_text_color(l, hex(color), 0);
  return l;
}

void ui_style_plain(lv_obj_t *o) {
  lv_obj_remove_style_all(o);
  lv_obj_clear_flag(o, LV_OBJ_FLAG_SCROLLABLE);
}

/* ---------- per-system staleness (KTD-7) ---------- */

static bool sys_stale(const ui_state_t *st) {
  return st->age_s[st->sys] > TK_STALE_AFTER_S; /* -1 (no data) is never stale */
}

/* Content treatment: global transport failure, or the CURRENT system's data
 * age past the 90 s contract. NO_LOCATION over a prior model degrades in
 * place — the view never changes on a failure (R6). */
static bool content_degraded(const ui_state_t *st, const model_nearby_t *model) {
  if (st->conn == UI_CONN_OFFLINE) return true;
  if (st->conn == UI_CONN_NO_LOCATION && model != NULL) return true;
  return st->conn == UI_CONN_LIVE && sys_stale(st);
}

static bool sys_partial(const ui_state_t *st, const model_nearby_t *model) {
  if (model == NULL) return false;
  if (st->sys == UI_SYS_RAIL) return model->rail.present && model->rail.partial;
  if (st->sys == UI_SYS_BIKE) return model->bike.present && model->bike.partial;
  return false; /* bus: presence only (KTD-6) */
}

/* ---------- chrome ---------- */

static void chip_text(char *buf, size_t cap, const ui_state_t *st) {
  switch (st->conn) {
    case UI_CONN_LOADING: snprintf(buf, cap, "…"); break;
    case UI_CONN_NO_LOCATION: snprintf(buf, cap, "no location"); break;
    case UI_CONN_OFFLINE:
      snprintf(buf, cap, "offline · %lum", (unsigned long)(st->secs_since_fetch / 60u));
      break;
    default: {
      int32_t age = st->age_s[st->sys];
      if (age < 0) {
        /* no data for this system yet: transport-level freshness (R3) */
        snprintf(buf, cap, "%lus", (unsigned long)st->secs_since_fetch);
      } else if (age > TK_STALE_AFTER_S) {
        snprintf(buf, cap, "stale · %ldm", (long)(age / 60));
      } else if (st->flash_now) {
        snprintf(buf, cap, "now");
      } else {
        snprintf(buf, cap, "%lds", (long)age);
      }
    }
  }
}

static uint32_t chip_color(const ui_state_t *st) {
  if (st->conn == UI_CONN_OFFLINE || st->conn == UI_CONN_NO_LOCATION) return TK_OFFLINE;
  if (st->conn == UI_CONN_LIVE && sys_stale(st)) return TK_ALERT;
  return TK_LIVE;
}

static void build_chrome(const ui_state_t *st, bool partial) {
  /* status chip row, centered at y=18 */
  lv_obj_t *row = lv_obj_create(g_jitter);
  ui_style_plain(row);
  lv_obj_set_size(row, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(row, TK_CHIP_GAP, 0);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_align(row, LV_ALIGN_TOP_MID, 0, TK_CHIP_Y);

  lv_obj_t *fresh = lv_obj_create(row);
  ui_style_plain(fresh);
  lv_obj_set_size(fresh, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(fresh, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(fresh, 6, 0);
  lv_obj_set_flex_align(fresh, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

  g_chip_dot = lv_obj_create(fresh);
  ui_style_plain(g_chip_dot);
  lv_obj_set_size(g_chip_dot, 8, 8);
  lv_obj_set_style_radius(g_chip_dot, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_opa(g_chip_dot, LV_OPA_COVER, 0);

  char buf[24];
  chip_text(buf, sizeof(buf), st);
  g_chip_label = ui_make_label(fresh, buf, TK_FONT_CHIP, chip_color(st));
  lv_obj_set_style_bg_color(g_chip_dot, hex(chip_color(st)), 0);

  if (partial) {
    /* R3: subtle chip-adjacent marker — this system's board is incomplete
     * (cold feed groups after DO idle suspend), distinct from stale */
    lv_obj_t *pd = lv_obj_create(fresh);
    ui_style_plain(pd);
    lv_obj_set_size(pd, TK_PARTIAL_DOT, TK_PARTIAL_DOT);
    lv_obj_set_style_radius(pd, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(pd, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(pd, hex(TK_ALERT), 0);
  }

  /* battery: outline glyph approximated as a bordered rect + fill bar */
  lv_obj_t *batt = lv_obj_create(row);
  ui_style_plain(batt);
  lv_obj_set_size(batt, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(batt, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(batt, 6, 0);
  lv_obj_set_flex_align(batt, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

  lv_obj_t *glyph = lv_obj_create(batt);
  ui_style_plain(glyph);
  lv_obj_set_size(glyph, 22, 11);
  lv_obj_set_style_radius(glyph, 3, 0);
  lv_obj_set_style_border_width(glyph, 2, 0);
  lv_obj_set_style_border_color(glyph, hex(TK_TEXT_BATTERY), 0);
  if (st->battery_pct > 0) {
    lv_obj_t *fill = lv_obj_create(glyph);
    ui_style_plain(fill);
    int w = (18 * st->battery_pct) / 100;
    lv_obj_set_size(fill, w > 0 ? w : 1, 5);
    lv_obj_set_style_bg_opa(fill, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(fill, hex(TK_TEXT_BATTERY), 0);
    lv_obj_align(fill, LV_ALIGN_LEFT_MID, 2, 0);
  }
  if (st->battery_pct >= 0) snprintf(buf, sizeof(buf), "%d%%", st->battery_pct);
  else snprintf(buf, sizeof(buf), "--%%");
  ui_make_label(batt, buf, TK_FONT_CHIP, TK_TEXT_BATTERY);
}

/* Mode dots go live in U3: active = the carousel position (state->sys). */
static void build_mode_dots(uint8_t active_idx) {
  lv_obj_t *row = lv_obj_create(g_jitter);
  ui_style_plain(row);
  lv_obj_set_size(row, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(row, TK_MODE_DOT_GAP, 0);
  lv_obj_align(row, LV_ALIGN_BOTTOM_MID, 0, -TK_MODE_DOTS_BOTTOM);
  for (int i = 0; i < UI_SYS_COUNT; i++) {
    lv_obj_t *dot = lv_obj_create(row);
    ui_style_plain(dot);
    lv_obj_set_size(dot, TK_MODE_DOT, TK_MODE_DOT);
    lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(dot, hex(i == active_idx ? TK_TEXT_PRIMARY : TK_DOT_INACTIVE), 0);
  }
}

/* ---------- shared state screens ---------- */

/* Proper two-arg anim trampoline: casting the three-arg style setter into
 * lv_anim_exec_xcb_t hands LVGL a garbage style selector (the sim froze on
 * exactly that). */
static void skeleton_opa_cb(void *var, int32_t v) {
  lv_obj_set_style_opa((lv_obj_t *)var, (lv_opa_t)v, 0);
}

static void build_skeleton(void) {
  g_skeleton_shown = true;
  /* board bones: name bar, 3 rows of circle+bars; opacity sweep */
  lv_obj_t *name = lv_obj_create(g_content);
  ui_style_plain(name);
  lv_obj_set_size(name, 220, 28);
  lv_obj_set_style_radius(name, 6, 0);
  lv_obj_set_style_bg_opa(name, LV_OPA_COVER, 0);
  lv_obj_set_style_bg_color(name, hex(TK_SKELETON_BASE), 0);
  lv_obj_set_pos(name, TK_SIDE_INSET, TK_HEADER_TOP);

  for (int i = 0; i < 3; i++) {
    int y = TK_ROWS_TOP + i * 90;
    lv_obj_t *circ = lv_obj_create(g_content);
    ui_style_plain(circ);
    lv_obj_set_size(circ, TK_BULLET_D, TK_BULLET_D);
    lv_obj_set_style_radius(circ, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(circ, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(circ, hex(TK_SKELETON_BASE), 0);
    lv_obj_set_pos(circ, TK_ROW_HPAD, y);
    lv_obj_t *bar = lv_obj_create(g_content);
    ui_style_plain(bar);
    lv_obj_set_size(bar, 140, 16);
    lv_obj_set_style_radius(bar, 4, 0);
    lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(bar, hex(TK_SKELETON_BASE), 0);
    lv_obj_set_pos(bar, TK_ROW_HPAD + TK_BULLET_D + TK_ROW_GAP, y + 14);
  }
  /* 1.4 s shimmer approximated as a container opacity sweep */
  lv_anim_t a;
  lv_anim_init(&a);
  lv_anim_set_var(&a, g_content);
  lv_anim_set_values(&a, LV_OPA_60, LV_OPA_COVER);
  lv_anim_set_duration(&a, 1400);
  lv_anim_set_playback_duration(&a, 1400);
  lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
  lv_anim_set_exec_cb(&a, skeleton_opa_cb);
  lv_anim_start(&a);
}

void ui_empty_mode(lv_obj_t *content, const char *title, const char *line1,
                   const char *line2) {
  /* §7 pattern. Solid ring stands in for the dashed circle — LVGL borders
   * don't dash. */
  lv_obj_t *ring = lv_obj_create(content);
  ui_style_plain(ring);
  lv_obj_set_size(ring, 56, 56);
  lv_obj_set_style_radius(ring, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_border_width(ring, 2, 0);
  lv_obj_set_style_border_color(ring, hex(TK_EMPTY_RING), 0);
  lv_obj_align(ring, LV_ALIGN_TOP_MID, 0, TK_EMPTY_RING_Y);

  lv_obj_t *t = ui_make_label(content, title, TK_FONT_TITLE_SM, TK_EMPTY_TITLE);
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, TK_EMPTY_TITLE_Y);

  if (line1 != NULL || line2 != NULL) {
    char body[128];
    snprintf(body, sizeof(body), "%s%s%s", line1 ? line1 : "",
             (line1 && line2) ? "\n" : "", line2 ? line2 : "");
    lv_obj_t *b = ui_make_label(content, body, TK_FONT_BODY, TK_TEXT_MUTED);
    lv_obj_set_style_text_align(b, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(b, LV_ALIGN_TOP_MID, 0, TK_EMPTY_BODY_Y);
  }
}

static void build_degraded_banner(const ui_state_t *st) {
  char text[64];
  if (st->conn == UI_CONN_NO_LOCATION) {
    snprintf(text, sizeof(text), "location unknown — retrying automatically");
  } else if (st->conn == UI_CONN_OFFLINE) {
    snprintf(text, sizeof(text), "last fetch %lum ago — retrying automatically",
             (unsigned long)(st->secs_since_fetch / 60u));
  } else {
    /* per-system stale with fetches succeeding (KTD-7) */
    snprintf(text, sizeof(text), "data %ldm old — retrying automatically",
             (long)(st->age_s[st->sys] / 60));
  }
  lv_obj_t *banner = ui_make_label(g_jitter, text, TK_FONT_PILL,
                                   st->conn == UI_CONN_LIVE ? TK_ALERT : TK_OFFLINE);
  lv_obj_align(banner, LV_ALIGN_BOTTOM_MID, 0, -40);
}

/* ---------- per-system board renderers (KTD-6 descriptor table) ---------- */

static void render_rail_board(lv_obj_t *content, const model_nearby_t *model,
                              const ui_state_t *state, bool degraded) {
  if (!model->rail.present || model->rail.no_data) {
    build_skeleton(); /* cold system: bones, honest, same as pre-first-fetch */
    return;
  }
  ui_board_render(content, &model->rail, state, degraded, &g_hits);
}

/* Bus is presence-only until a feed exists (KTD-6; MTA Bus epic gc-4wk):
 * this renderer IS the additive seam — widen the model and replace it. */
static void render_bus_board(lv_obj_t *content, const model_nearby_t *model,
                             const ui_state_t *state, bool degraded) {
  (void)model;
  (void)state;
  (void)degraded;
  ui_empty_mode(content, "No bus service yet",
                "Swipe \xE2\x86\x92 for bikes, \xE2\x86\x90 for trains.", NULL);
}

/* Bike board (U5, handoff §3): the R5 degraded trio splits across layers —
 * no_data → skeleton (cold source: bones, honest, same treatment as
 * pre-first-fetch), zero stations LIVE → §7 empty mode with the nearest
 * distance (a different fact from "no data"), and per-station -1 sentinels
 * are ui_bike.c's job ("—" heroes + hidden bar + muted note). */
static void render_bike_board(lv_obj_t *content, const model_nearby_t *model,
                              const ui_state_t *state, bool degraded) {
  (void)degraded;
  const model_bike_system_t *bike = &model->bike;
  if (!bike->present || bike->no_data) {
    build_skeleton();
    return;
  }
  if (bike->station_count == 0) {
    char body[64] = "";
    if (bike->nearest_distance_label[0]) {
      snprintf(body, sizeof(body), "Closest station is %s away.",
               bike->nearest_distance_label);
    }
    ui_empty_mode(content, "No bikeshare nearby", body[0] ? body : NULL,
                  "Swipe \xE2\x86\x90 for trains.");
    return;
  }
  ui_bike_board_render(content, bike, state);
}

typedef void (*sys_render_fn)(lv_obj_t *content, const model_nearby_t *model,
                              const ui_state_t *state, bool degraded);

static const sys_render_fn k_sys_render[UI_SYS_COUNT] = {
    [UI_SYS_RAIL] = render_rail_board,
    [UI_SYS_BUS] = render_bus_board,
    [UI_SYS_BIKE] = render_bike_board,
};

/* Nearby compare (U5, handoff §4). The reconciler pops this view when the
 * station list empties under a refresh; the guard is belt-and-braces. */
static void render_nearby(lv_obj_t *content, const model_nearby_t *model,
                          const ui_state_t *state) {
  const model_bike_system_t *bike = &model->bike;
  if (!bike->present || bike->no_data || bike->station_count == 0) {
    render_bike_board(content, model, state, false);
    return;
  }
  ui_bike_nearby_render(content, bike, state, &g_nearby_hits);
}

/* ---------- public seams ---------- */

void ui_init(void) {
  g_root = lv_screen_active();
  lv_obj_set_style_bg_color(g_root, hex(TK_BG), 0);
  lv_obj_set_style_bg_opa(g_root, LV_OPA_COVER, 0);
  lv_obj_clear_flag(g_root, LV_OBJ_FLAG_SCROLLABLE);
  g_jitter = NULL;
}

static void jitter_roll(void) {
  /* spec burn-in requirement: whole-layout jitter, re-rolled per render */
  int jx = (rand() % (2 * TK_JITTER_PX + 1)) - TK_JITTER_PX;
  int jy = (rand() % (2 * TK_JITTER_PX + 1)) - TK_JITTER_PX;
  lv_obj_set_pos(g_jitter, jx, jy);
}

void ui_jitter_nudge(void) {
  /* R7: label-only minute ticks in long-dwell views move the whole layout
   * without a rebuild — same burn-in defense, no re-layout */
  if (g_jitter) jitter_roll();
}

void ui_render(const model_nearby_t *model, const ui_state_t *state) {
  memset(&g_hits, 0, sizeof(g_hits));
  memset(&g_detail_hits, 0, sizeof(g_detail_hits));
  memset(&g_nearby_hits, 0, sizeof(g_nearby_hits));
  ui_detail_prepare(state); /* countdown labels are about to dangle (U4) */
  g_skeleton_shown = false;

  if (g_jitter) lv_obj_delete(g_jitter);
  g_jitter = lv_obj_create(g_root);
  ui_style_plain(g_jitter);
  lv_obj_set_size(g_jitter, TK_SCREEN_W, TK_SCREEN_H);
  jitter_roll();

  build_chrome(state, sys_partial(state, model));

  g_content = lv_obj_create(g_jitter);
  ui_style_plain(g_content);
  lv_obj_set_size(g_content, TK_SCREEN_W, TK_SCREEN_H);

  if (state->conn == UI_CONN_NO_LOCATION && model == NULL) {
    /* R10 screen — only when there is no prior model to degrade in place */
    ui_empty_mode(g_content, "Can't find you", "No known WiFi networks nearby.",
                  "Retrying automatically.");
    build_mode_dots(state->sys);
    return;
  }
  if (model == NULL || state->conn == UI_CONN_LOADING) {
    build_skeleton(); /* LOADING (M1 semantics — review: the sim's '1' key
                         regressed to a live board), or OFFLINE before
                         anything ever arrived */
    build_mode_dots(state->sys);
    return;
  }

  bool degraded = content_degraded(state, model);
  switch (state->view) {
    case UI_VIEW_BOARD:
      k_sys_render[state->sys < UI_SYS_COUNT ? state->sys : 0](g_content, model, state,
                                                               degraded);
      break;
    case UI_VIEW_DETAIL:
      ui_detail_render(g_content, model, state, degraded, &g_detail_hits);
      break;
    case UI_VIEW_BIKE_NEARBY: render_nearby(g_content, model, state); break;
  }
  build_mode_dots(state->sys);

  if (degraded && !g_skeleton_shown) {
    /* shared degraded content treatment; the chip distinguishes the causes
     * (offline red vs no-location red vs per-system stale amber) */
    lv_obj_set_style_opa(g_content, LV_OPA_60, 0);
    build_degraded_banner(state);
  }
}

void ui_tick(const ui_state_t *state) {
  if (!g_chip_label) return;
  /* label-only: no re-layout, no jitter (R7) */
  char buf[24];
  chip_text(buf, sizeof(buf), state);
  lv_label_set_text(g_chip_label, buf);
  lv_obj_set_style_text_color(g_chip_label, hex(chip_color(state)), 0);
  if (g_chip_dot) lv_obj_set_style_bg_color(g_chip_dot, hex(chip_color(state)), 0);
}

/* ---------- input routing (R2) ---------- */

bool ui_views_on_tap(int32_t x, int32_t y, const model_nearby_t *model, ui_state_t *state) {
  switch (state->view) {
    case UI_VIEW_BOARD:
      if (state->sys == UI_SYS_RAIL) {
        if (g_hits.pill && ui_input_hit(g_hits.pill, x, y, UI_INPUT_HIT_MIN_PX)) {
          return ui_nav_flip_dir(state); /* the only flip path (R2) */
        }
        for (uint8_t i = 0; i < g_hits.row_count; i++) {
          if (g_hits.rows[i] && ui_input_hit(g_hits.rows[i], x, y, UI_INPUT_HIT_MIN_PX)) {
            return ui_nav_open_detail(state, model, i);
          }
        }
      } else if (state->sys == UI_SYS_BIKE) {
        return ui_nav_open_nearby(state, model); /* §3: tap anywhere → nearby */
      }
      return false;
    case UI_VIEW_DETAIL:
      /* §2: ⇅ cluster flips in place, ‹ back pops; anywhere else — nothing
       * (both targets 44 px padded, KTD-2) */
      if (g_detail_hits.flip && ui_input_hit(g_detail_hits.flip, x, y, UI_INPUT_HIT_MIN_PX)) {
        return ui_nav_flip_dir(state);
      }
      if (g_detail_hits.back && ui_input_hit(g_detail_hits.back, x, y, UI_INPUT_HIT_MIN_PX)) {
        return ui_nav_back(state);
      }
      return false;
    case UI_VIEW_BIKE_NEARBY:
      /* ‹ back exits without touching the selection (R2); a row tap is the
       * only path that changes the current station (U5) */
      if (g_nearby_hits.back &&
          ui_input_hit(g_nearby_hits.back, x, y, UI_INPUT_HIT_MIN_PX)) {
        return ui_nav_back(state);
      }
      for (uint8_t i = 0; i < g_nearby_hits.row_count; i++) {
        if (g_nearby_hits.rows[i] &&
            ui_input_hit(g_nearby_hits.rows[i], x, y, UI_INPUT_HIT_MIN_PX)) {
          return ui_nav_select_station(state, model, i);
        }
      }
      return false;
  }
  return false;
}

bool ui_views_on_swipe(ui_swipe_t swipe, const model_nearby_t *model, ui_state_t *state) {
  switch (swipe) {
    case UI_SWIPE_LEFT: return ui_nav_swipe(state, model, UI_NAV_LEFT);
    case UI_SWIPE_RIGHT: return ui_nav_swipe(state, model, UI_NAV_RIGHT);
    case UI_SWIPE_UP: return ui_nav_swipe(state, model, UI_NAV_UP);
    case UI_SWIPE_DOWN: return ui_nav_swipe(state, model, UI_NAV_DOWN);
  }
  return false;
}
