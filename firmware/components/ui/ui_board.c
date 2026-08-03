/*
 * ui_board.c — the rail explore board renderer (M1; refactored in plan U3).
 *
 * U3 split: chrome (chip/battery/mode dots), the state screens (skeleton,
 * no-location, offline banner) and the view dispatch moved to ui_views.c;
 * this file renders exactly one thing — the rail board content — into the
 * dispatcher's content container, and reports its tappable objects (pill,
 * trunk rows) through ui_board_hits_t for the tap router.
 *
 * Direction-awareness (R2 board half): rows read directions[state->dir]
 * only; a trunk with no arrivals in the active direction renders "—"; the
 * pill shows the active direction's label and flips on tap (routed by
 * ui_views).
 *
 * Known approximations (documented, deliberate): the empty-state "dashed"
 * ring renders as a solid 2 px ring (LVGL borders don't dash).
 */
#include <stdio.h>
#include <string.h>

#include "ui.h"
#include "ui_internal.h"
#include "ui_tokens.h"

static lv_color_t hex(uint32_t rgb) { return lv_color_hex(rgb); }

/* Per-render context (LVGL is single-threaded; set at ui_board_render entry). */
static uint8_t g_dir;
static bool g_degraded; /* offline/stale: rows render ~ countdowns */

/* ---------- header ---------- */

static const lv_font_t *header_font(size_t name_len, bool *two_line) {
  *two_line = false;
  if (name_len <= 12) return TK_FONT_TITLE_LG;
  if (name_len <= 18) return TK_FONT_TITLE_MD;
  *two_line = true;
  return TK_FONT_TITLE_SM;
}

static void build_header(lv_obj_t *content, const model_rail_system_t *rail,
                         const model_stop_t *stop, bool *two_line, ui_board_hits_t *hits) {
  lv_obj_t *name = ui_make_label(content, stop->name,
                                 header_font(strlen(stop->name), two_line), TK_TEXT_PRIMARY);
  lv_obj_set_width(name, TK_SCREEN_W - 2 * TK_SIDE_INSET);
  lv_label_set_long_mode(name, LV_LABEL_LONG_DOT);
  lv_obj_set_pos(name, TK_SIDE_INSET, TK_HEADER_TOP);

  /* direction pill (tap → flip, the only flip path) + distance */
  lv_obj_t *sub = lv_obj_create(content);
  ui_style_plain(sub);
  lv_obj_set_size(sub, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(sub, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(sub, 10, 0);
  lv_obj_set_flex_align(sub, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_pos(sub, TK_SIDE_INSET, TK_HEADER_TOP + (*two_line ? 68 : 40));

  lv_obj_t *pill = lv_obj_create(sub);
  ui_style_plain(pill);
  lv_obj_set_size(pill, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_opa(pill, LV_OPA_COVER, 0);
  lv_obj_set_style_bg_color(pill, hex(TK_PILL_BG), 0);
  lv_obj_set_style_border_width(pill, 1, 0);
  lv_obj_set_style_border_color(pill, hex(TK_PILL_BORDER), 0);
  lv_obj_set_style_radius(pill, 16, 0);
  lv_obj_set_style_pad_hor(pill, 13, 0);
  lv_obj_set_style_pad_ver(pill, 5, 0);
  char pill_text[40];
  /* active direction's label (R2); bare pill when the feed has none */
  const char *label = rail->direction_labels[g_dir][0] ? rail->direction_labels[g_dir] : "";
  /* real ⇅ (U+21C5, merged from DejaVu) — the Plex faces carry no
   * FontAwesome symbols, so LV_SYMBOL_* would render as fallback boxes */
  snprintf(pill_text, sizeof(pill_text), "%s%s\xE2\x87\x85", label, label[0] ? "  " : "");
  ui_make_label(pill, pill_text, TK_FONT_PILL, TK_TEXT_MUTED);
  hits->pill = pill;

  ui_make_label(sub, stop->distance_label, TK_FONT_SUB, TK_TEXT_MUTED);
}

/* ---------- rows ---------- */

static void build_bullet(lv_obj_t *cluster, const model_route_t *route, uint32_t color,
                         uint32_t text_color, int idx) {
  bool pill = route->shape == MODEL_SHAPE_PILL;
  lv_obj_t *b = lv_obj_create(cluster);
  ui_style_plain(b);
  if (pill) {
    lv_obj_set_size(b, LV_SIZE_CONTENT, 40);
    lv_obj_set_style_pad_hor(b, 10, 0);
    lv_obj_set_style_radius(b, 9, 0);
  } else {
    lv_obj_set_size(b, TK_BULLET_D, TK_BULLET_D);
    lv_obj_set_style_radius(b, LV_RADIUS_CIRCLE, 0);
  }
  lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
  lv_obj_set_style_bg_color(b, hex(color), 0);
  /* 3 px black ring separates overlapped bullets */
  lv_obj_set_style_border_width(b, TK_BULLET_RING, 0);
  lv_obj_set_style_border_color(b, hex(TK_BG), 0);
  if (!pill && idx > 0) {
    lv_obj_set_style_margin_left(b, -TK_BULLET_OVERLAP, 0);
  }
  const lv_font_t *f = pill ? (strlen(route->label) > 4 ? TK_FONT_CHIP
                                                        : TK_FONT_DIRECTION)
                            : TK_FONT_BULLET;
  lv_obj_t *l = ui_make_label(b, route->label, f, text_color);
  lv_obj_center(l);
}

/* Soonest arrival in the ACTIVE direction only (R2): per-direction arrays
 * arrive ETA-sorted from the API, so it's the head or nothing. */
static const model_arrival_t *soonest(const model_trunk_t *t) {
  if (t->directions[g_dir].arrival_count == 0) return NULL;
  return &t->directions[g_dir].arrivals[0];
}

static lv_obj_t *build_row(lv_obj_t *parent, const model_trunk_t *t, int row_h) {
  lv_obj_t *row = lv_obj_create(parent);
  ui_style_plain(row);
  lv_obj_set_size(row, TK_SCREEN_W - 2 * TK_ROW_HPAD, row_h);
  lv_obj_set_style_border_side(row, LV_BORDER_SIDE_TOP, 0);
  lv_obj_set_style_border_width(row, 1, 0);
  lv_obj_set_style_border_color(row, hex(TK_HAIRLINE), 0);

  bool alerted = t->alert.severity != MODEL_ALERT_NONE;
  bool delay = t->alert.severity == MODEL_ALERT_DELAY;

  /* bullet cluster */
  lv_obj_t *cluster = lv_obj_create(row);
  ui_style_plain(cluster);
  lv_obj_set_size(cluster, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(cluster, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(cluster, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_align(cluster, LV_ALIGN_LEFT_MID, 0, 0);
  for (int i = 0; i < t->route_count; i++) {
    build_bullet(cluster, &t->routes[i], t->color, t->text_color, i);
  }
  if (delay) {
    /* amber alert badge at cluster top-right */
    lv_obj_t *badge = lv_obj_create(cluster);
    ui_style_plain(badge);
    lv_obj_set_size(badge, 22, 22);
    lv_obj_set_style_radius(badge, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(badge, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(badge, hex(TK_ALERT), 0);
    lv_obj_set_style_border_width(badge, 3, 0);
    lv_obj_set_style_border_color(badge, hex(TK_BG), 0);
    lv_obj_add_flag(badge, LV_OBJ_FLAG_IGNORE_LAYOUT);
    lv_obj_align_to(badge, cluster, LV_ALIGN_OUT_TOP_RIGHT, -6, 6);
    lv_obj_t *bang = ui_make_label(badge, "!", TK_FONT_SUB, TK_BG);
    lv_obj_center(bang);
  }

  /* headsign + optional sub-line */
  const model_arrival_t *a = soonest(t);
  lv_obj_t *mid = lv_obj_create(row);
  ui_style_plain(mid);
  lv_obj_set_flex_flow(mid, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(mid, 2, 0);
  lv_obj_set_size(mid, 160, LV_SIZE_CONTENT);
  int cluster_w = t->route_count * (TK_BULLET_D - TK_BULLET_OVERLAP) + TK_BULLET_OVERLAP;
  lv_obj_align(mid, LV_ALIGN_LEFT_MID, cluster_w + TK_ROW_GAP, 0);
  lv_obj_t *hs = ui_make_label(mid, a && a->headsign[0] ? a->headsign : "—",
                               TK_FONT_HEADSIGN, TK_TEXT_BODY);
  lv_obj_set_width(hs, 160);
  lv_label_set_long_mode(hs, LV_LABEL_LONG_DOT);
  if (alerted && t->alert.text[0]) {
    lv_obj_t *sub = ui_make_label(mid, t->alert.text, TK_FONT_SUB,
                                  delay ? TK_ALERT : TK_TEXT_MUTED);
    lv_obj_set_width(sub, 160);
    lv_label_set_long_mode(sub, LV_LABEL_LONG_DOT);
  }

  /* countdown */
  lv_obj_t *cd = lv_obj_create(row);
  ui_style_plain(cd);
  lv_obj_set_size(cd, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(cd, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(cd, 4, 0);
  lv_obj_set_flex_align(cd, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
  lv_obj_align(cd, LV_ALIGN_RIGHT_MID, 0, 0);
  /* Degraded data carries the handoff's `~` prefix — stale numbers are
   * estimates, never presented as live (spec constraint #4 / R6). */
  char num[12] = "—";
  if (a) snprintf(num, sizeof(num), "%s%d", g_degraded ? "~" : "", a->eta_min);
  ui_make_label(cd, num, TK_FONT_COUNTDOWN, delay ? TK_ALERT : TK_TEXT_PRIMARY);
  if (a) ui_make_label(cd, "min", TK_FONT_SUB, TK_TEXT_MUTED);
  return row;
}

static void build_rows(lv_obj_t *content, const model_stop_t *stop, bool two_line,
                       ui_board_hits_t *hits) {
  int top = two_line ? TK_ROWS_TOP_2LINE : TK_ROWS_TOP;
  lv_obj_t *list = lv_obj_create(content);
  ui_style_plain(list);
  lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_pos(list, TK_ROW_HPAD, top);
  lv_obj_set_size(list, TK_SCREEN_W - 2 * TK_ROW_HPAD, TK_SCREEN_H - top - TK_ROWS_BOTTOM);

  int shown = stop->trunk_count < TK_MAX_VISIBLE_ROWS ? stop->trunk_count : TK_MAX_VISIBLE_ROWS;
  bool overflow = stop->trunk_count > TK_MAX_VISIBLE_ROWS || stop->trunks_clamped > 0;
  int avail = TK_SCREEN_H - top - TK_ROWS_BOTTOM - (overflow ? 40 : 0);
  int row_h = shown > 0 ? avail / shown : avail;

  for (int i = 0; i < shown; i++) {
    hits->rows[i] = build_row(list, &stop->trunks[i], row_h);
  }
  hits->row_count = (uint8_t)shown;
  if (overflow) {
    /* 2a compressed pattern: dimmed overflow bullet tray */
    lv_obj_t *tray = lv_obj_create(list);
    ui_style_plain(tray);
    lv_obj_set_size(tray, TK_SCREEN_W - 2 * TK_ROW_HPAD, 40);
    lv_obj_set_flex_flow(tray, LV_FLEX_FLOW_ROW);
    lv_obj_set_style_pad_column(tray, 6, 0);
    lv_obj_set_style_opa(tray, LV_OPA_50, 0);
    for (int i = TK_MAX_VISIBLE_ROWS; i < stop->trunk_count; i++) {
      const model_trunk_t *t = &stop->trunks[i];
      lv_obj_t *b = lv_obj_create(tray);
      ui_style_plain(b);
      lv_obj_set_size(b, 28, 28);
      lv_obj_set_style_radius(b, LV_RADIUS_CIRCLE, 0);
      lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
      lv_obj_set_style_bg_color(b, hex(t->color), 0);
      if (t->route_count > 0) {
        lv_obj_t *l = ui_make_label(b, t->routes[0].label, TK_FONT_SUB, t->text_color);
        lv_obj_center(l);
      }
    }
  }
}

/* Stop dots stay rail-only (handoff: vertical position within system;
 * hidden in detail views — the dispatcher never draws them elsewhere). */
static void build_stop_dots(lv_obj_t *content, uint8_t count, uint8_t active) {
  if (count < 2) return;
  lv_obj_t *col = lv_obj_create(content);
  ui_style_plain(col);
  lv_obj_set_size(col, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(col, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(col, TK_STOP_DOT_GAP, 0);
  lv_obj_align(col, LV_ALIGN_RIGHT_MID, -TK_STOP_DOTS_RIGHT, 0);
  for (uint8_t i = 0; i < count; i++) {
    lv_obj_t *dot = lv_obj_create(col);
    ui_style_plain(dot);
    lv_obj_set_size(dot, TK_STOP_DOT, TK_STOP_DOT);
    lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(dot, hex(i == active ? TK_TEXT_PRIMARY : TK_DOT_INACTIVE), 0);
  }
}

/* ---------- the renderer seam ---------- */

void ui_board_render(lv_obj_t *content, const model_rail_system_t *rail,
                     const ui_state_t *state, bool degraded, ui_board_hits_t *hits) {
  g_dir = state->dir;
  g_degraded = degraded;

  uint8_t idx =
      state->stop_idx[UI_SYS_RAIL] < rail->stop_count ? state->stop_idx[UI_SYS_RAIL] : 0;
  if (rail->stop_count == 0) {
    /* empty-but-live: handoff §7 empty mode with nearest distance */
    char body[64] = "";
    if (rail->nearest_distance_label[0]) {
      snprintf(body, sizeof(body), "Closest station is %s away.", rail->nearest_distance_label);
    }
    ui_empty_mode(content, "No trains nearby", body[0] ? body : NULL, NULL);
    return;
  }

  bool two_line = false;
  build_header(content, rail, &rail->stops[idx], &two_line, hits);
  build_rows(content, &rail->stops[idx], two_line, hits);
  build_stop_dots(content, rail->stop_count, idx);
}
