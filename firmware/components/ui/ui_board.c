/*
 * ui_board.c — the explore board per the design handoff, M1 states.
 *
 * Rendering strategy: the screen is rebuilt on every ui_board_show (LVGL
 * object churn at this scale is cheap and a full rebuild keeps state
 * handling trivial); ui_board_tick touches only the chip labels. The whole
 * layout hangs off one jitter container so the spec's ±4 px burn-in offset
 * is a single position change on full renders.
 *
 * Known M1 approximations (documented, deliberate):
 *  - Fonts: built-in Montserrat mapped 15→14, 17→16, 25→24, 27→26.
 *  - The empty-state "dashed" ring renders as a solid 2 px ring (LVGL
 *    borders don't dash); revisit in the font/polish pass.
 *  - Offline banner copy says "retrying automatically" (shake lands in M2).
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "ui.h"
#include "ui_tokens.h"

static lv_obj_t *g_root;    /* black screen */
static lv_obj_t *g_jitter;  /* full-screen container carrying the offset */
static lv_obj_t *g_chip_dot;
static lv_obj_t *g_chip_label;
static lv_obj_t *g_batt_label;
static lv_obj_t *g_content; /* everything below the chip */
static ui_conn_t g_conn_at_show;

static lv_color_t hex(uint32_t rgb) { return lv_color_hex(rgb); }

static lv_obj_t *make_label(lv_obj_t *parent, const char *text, const lv_font_t *font,
                            uint32_t color) {
  lv_obj_t *l = lv_label_create(parent);
  lv_label_set_text(l, text);
  lv_obj_set_style_text_font(l, font, 0);
  lv_obj_set_style_text_color(l, hex(color), 0);
  return l;
}

static void style_plain(lv_obj_t *o) {
  lv_obj_remove_style_all(o);
  lv_obj_clear_flag(o, LV_OBJ_FLAG_SCROLLABLE);
}

/* ---------- chrome ---------- */

static void chip_text(char *buf, size_t cap, const ui_state_t *st) {
  switch (st->conn) {
    case UI_CONN_LOADING: snprintf(buf, cap, "…"); break;
    case UI_CONN_OFFLINE: snprintf(buf, cap, "offline · %um", st->secs_since_fetch / 60u); break;
    case UI_CONN_STALE: snprintf(buf, cap, "stale · %um", st->secs_since_fetch / 60u); break;
    default:
      if (st->flash_now) snprintf(buf, cap, "now");
      else snprintf(buf, cap, "%us", st->secs_since_fetch);
  }
}

static uint32_t chip_color(const ui_state_t *st) {
  if (st->conn == UI_CONN_OFFLINE || st->conn == UI_CONN_NO_LOCATION) return TK_OFFLINE;
  if (st->conn == UI_CONN_STALE) return TK_ALERT;
  return TK_LIVE;
}

static void build_chrome(const ui_state_t *st) {
  /* status chip row, centered at y=18 */
  lv_obj_t *row = lv_obj_create(g_jitter);
  style_plain(row);
  lv_obj_set_size(row, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(row, TK_CHIP_GAP, 0);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_align(row, LV_ALIGN_TOP_MID, 0, TK_CHIP_Y);

  lv_obj_t *fresh = lv_obj_create(row);
  style_plain(fresh);
  lv_obj_set_size(fresh, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(fresh, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(fresh, 6, 0);
  lv_obj_set_flex_align(fresh, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

  g_chip_dot = lv_obj_create(fresh);
  style_plain(g_chip_dot);
  lv_obj_set_size(g_chip_dot, 8, 8);
  lv_obj_set_style_radius(g_chip_dot, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_opa(g_chip_dot, LV_OPA_COVER, 0);

  char buf[24];
  chip_text(buf, sizeof(buf), st);
  g_chip_label = make_label(fresh, buf, &lv_font_montserrat_16, chip_color(st));
  lv_obj_set_style_bg_color(g_chip_dot, hex(chip_color(st)), 0);

  /* battery: outline glyph approximated as a bordered rect + fill bar */
  lv_obj_t *batt = lv_obj_create(row);
  style_plain(batt);
  lv_obj_set_size(batt, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(batt, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(batt, 6, 0);
  lv_obj_set_flex_align(batt, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

  lv_obj_t *glyph = lv_obj_create(batt);
  style_plain(glyph);
  lv_obj_set_size(glyph, 22, 11);
  lv_obj_set_style_radius(glyph, 3, 0);
  lv_obj_set_style_border_width(glyph, 2, 0);
  lv_obj_set_style_border_color(glyph, hex(TK_TEXT_BATTERY), 0);
  if (st->battery_pct > 0) {
    lv_obj_t *fill = lv_obj_create(glyph);
    style_plain(fill);
    int w = (18 * st->battery_pct) / 100;
    lv_obj_set_size(fill, w > 0 ? w : 1, 5);
    lv_obj_set_style_bg_opa(fill, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(fill, hex(TK_TEXT_BATTERY), 0);
    lv_obj_align(fill, LV_ALIGN_LEFT_MID, 2, 0);
  }
  if (st->battery_pct >= 0) snprintf(buf, sizeof(buf), "%d%%", st->battery_pct);
  else snprintf(buf, sizeof(buf), "--%%");
  g_batt_label = make_label(batt, buf, &lv_font_montserrat_16, TK_TEXT_BATTERY);
}

static void build_mode_dots(uint8_t active_idx) {
  lv_obj_t *row = lv_obj_create(g_jitter);
  style_plain(row);
  lv_obj_set_size(row, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(row, TK_MODE_DOT_GAP, 0);
  lv_obj_align(row, LV_ALIGN_BOTTOM_MID, 0, -TK_MODE_DOTS_BOTTOM);
  for (int i = 0; i < 3; i++) {
    lv_obj_t *dot = lv_obj_create(row);
    style_plain(dot);
    lv_obj_set_size(dot, TK_MODE_DOT, TK_MODE_DOT);
    lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(dot, hex(i == active_idx ? TK_TEXT_PRIMARY : TK_DOT_INACTIVE), 0);
  }
}

static void build_stop_dots(uint8_t count, uint8_t active) {
  if (count < 2) return;
  lv_obj_t *col = lv_obj_create(g_jitter);
  style_plain(col);
  lv_obj_set_size(col, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(col, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(col, TK_STOP_DOT_GAP, 0);
  lv_obj_align(col, LV_ALIGN_RIGHT_MID, -TK_STOP_DOTS_RIGHT, 0);
  for (uint8_t i = 0; i < count; i++) {
    lv_obj_t *dot = lv_obj_create(col);
    style_plain(dot);
    lv_obj_set_size(dot, TK_STOP_DOT, TK_STOP_DOT);
    lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(dot, hex(i == active ? TK_TEXT_PRIMARY : TK_DOT_INACTIVE), 0);
  }
}

/* ---------- board ---------- */

static const lv_font_t *header_font(size_t name_len, bool *two_line) {
  *two_line = false;
  if (name_len <= 12) return &lv_font_montserrat_30;
  if (name_len <= 18) return &lv_font_montserrat_26; /* handoff 27 → 26 */
  *two_line = true;
  return &lv_font_montserrat_24;
}

static void build_header(const model_rail_system_t *rail, const model_stop_t *stop,
                         bool *two_line) {
  lv_obj_t *name = make_label(g_content, stop->name,
                              header_font(strlen(stop->name), two_line), TK_TEXT_PRIMARY);
  lv_obj_set_width(name, TK_SCREEN_W - 2 * TK_SIDE_INSET);
  lv_label_set_long_mode(name, LV_LABEL_LONG_DOT);
  lv_obj_set_pos(name, TK_SIDE_INSET, TK_HEADER_TOP);

  /* direction pill (inert in M1) + distance */
  lv_obj_t *sub = lv_obj_create(g_content);
  style_plain(sub);
  lv_obj_set_size(sub, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(sub, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(sub, 10, 0);
  lv_obj_set_flex_align(sub, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_pos(sub, TK_SIDE_INSET, TK_HEADER_TOP + (*two_line ? 68 : 40));

  lv_obj_t *pill = lv_obj_create(sub);
  style_plain(pill);
  lv_obj_set_size(pill, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_style_bg_opa(pill, LV_OPA_COVER, 0);
  lv_obj_set_style_bg_color(pill, hex(TK_PILL_BG), 0);
  lv_obj_set_style_border_width(pill, 1, 0);
  lv_obj_set_style_border_color(pill, hex(TK_PILL_BORDER), 0);
  lv_obj_set_style_radius(pill, 16, 0);
  lv_obj_set_style_pad_hor(pill, 13, 0);
  lv_obj_set_style_pad_ver(pill, 5, 0);
  char pill_text[40];
  const char *dir0 = rail->direction_labels[0][0] ? rail->direction_labels[0] : "Dir 0";
  snprintf(pill_text, sizeof(pill_text), "%s  " LV_SYMBOL_SHUFFLE, dir0);
  make_label(pill, pill_text, &lv_font_montserrat_14, TK_TEXT_MUTED); /* 15 → 14 */

  make_label(sub, stop->distance_label, &lv_font_montserrat_14, TK_TEXT_MUTED);
}

static void build_bullet(lv_obj_t *cluster, const model_route_t *route, uint32_t color,
                         uint32_t text_color, int idx) {
  bool pill = route->shape == MODEL_SHAPE_PILL;
  lv_obj_t *b = lv_obj_create(cluster);
  style_plain(b);
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
  const lv_font_t *f = pill ? (strlen(route->label) > 4 ? &lv_font_montserrat_16
                                                        : &lv_font_montserrat_20)
                            : &lv_font_montserrat_24; /* 25 → 24 */
  lv_obj_t *l = make_label(b, route->label, f, text_color);
  lv_obj_center(l);
}

static const model_arrival_t *soonest(const model_trunk_t *t) {
  const model_arrival_t *best = NULL;
  for (int d = 0; d < 2; d++) {
    if (t->directions[d].arrival_count > 0) {
      const model_arrival_t *a = &t->directions[d].arrivals[0];
      if (!best || a->eta_min < best->eta_min) best = a;
    }
  }
  return best;
}

static void build_row(lv_obj_t *parent, const model_trunk_t *t, int row_h) {
  lv_obj_t *row = lv_obj_create(parent);
  style_plain(row);
  lv_obj_set_size(row, TK_SCREEN_W - 2 * TK_ROW_HPAD, row_h);
  lv_obj_set_style_border_side(row, LV_BORDER_SIDE_TOP, 0);
  lv_obj_set_style_border_width(row, 1, 0);
  lv_obj_set_style_border_color(row, hex(TK_HAIRLINE), 0);

  bool alerted = t->alert.severity != MODEL_ALERT_NONE;
  bool delay = t->alert.severity == MODEL_ALERT_DELAY;

  /* bullet cluster */
  lv_obj_t *cluster = lv_obj_create(row);
  style_plain(cluster);
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
    style_plain(badge);
    lv_obj_set_size(badge, 22, 22);
    lv_obj_set_style_radius(badge, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(badge, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(badge, hex(TK_ALERT), 0);
    lv_obj_set_style_border_width(badge, 3, 0);
    lv_obj_set_style_border_color(badge, hex(TK_BG), 0);
    lv_obj_add_flag(badge, LV_OBJ_FLAG_IGNORE_LAYOUT);
    lv_obj_align_to(badge, cluster, LV_ALIGN_OUT_TOP_RIGHT, -6, 6);
    lv_obj_t *bang = make_label(badge, "!", &lv_font_montserrat_14, TK_BG);
    lv_obj_center(bang);
  }

  /* headsign + optional sub-line */
  const model_arrival_t *a = soonest(t);
  lv_obj_t *mid = lv_obj_create(row);
  style_plain(mid);
  lv_obj_set_flex_flow(mid, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(mid, 2, 0);
  lv_obj_set_size(mid, 160, LV_SIZE_CONTENT);
  int cluster_w = t->route_count * (TK_BULLET_D - TK_BULLET_OVERLAP) + TK_BULLET_OVERLAP;
  lv_obj_align(mid, LV_ALIGN_LEFT_MID, cluster_w + TK_ROW_GAP, 0);
  lv_obj_t *hs = make_label(mid, a && a->headsign[0] ? a->headsign : "—",
                            &lv_font_montserrat_18, TK_TEXT_BODY);
  lv_obj_set_width(hs, 160);
  lv_label_set_long_mode(hs, LV_LABEL_LONG_DOT);
  if (alerted && t->alert.text[0]) {
    lv_obj_t *sub = make_label(mid, t->alert.text, &lv_font_montserrat_14,
                               delay ? TK_ALERT : TK_TEXT_MUTED);
    lv_obj_set_width(sub, 160);
    lv_label_set_long_mode(sub, LV_LABEL_LONG_DOT);
  }

  /* countdown */
  lv_obj_t *cd = lv_obj_create(row);
  style_plain(cd);
  lv_obj_set_size(cd, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(cd, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(cd, 4, 0);
  lv_obj_set_flex_align(cd, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
  lv_obj_align(cd, LV_ALIGN_RIGHT_MID, 0, 0);
  char num[8] = "—";
  if (a) snprintf(num, sizeof(num), "%d", a->eta_min);
  make_label(cd, num, &lv_font_montserrat_36, delay ? TK_ALERT : TK_TEXT_PRIMARY);
  if (a) make_label(cd, "min", &lv_font_montserrat_14, TK_TEXT_MUTED);
}

static void build_rows(const model_stop_t *stop, bool two_line) {
  int top = two_line ? TK_ROWS_TOP_2LINE : TK_ROWS_TOP;
  lv_obj_t *list = lv_obj_create(g_content);
  style_plain(list);
  lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_pos(list, TK_ROW_HPAD, top);
  lv_obj_set_size(list, TK_SCREEN_W - 2 * TK_ROW_HPAD, TK_SCREEN_H - top - TK_ROWS_BOTTOM);

  int shown = stop->trunk_count < TK_MAX_VISIBLE_ROWS ? stop->trunk_count : TK_MAX_VISIBLE_ROWS;
  bool overflow = stop->trunk_count > TK_MAX_VISIBLE_ROWS || stop->trunks_clamped > 0;
  int avail = TK_SCREEN_H - top - TK_ROWS_BOTTOM - (overflow ? 40 : 0);
  int row_h = shown > 0 ? avail / shown : avail;

  for (int i = 0; i < shown; i++) {
    build_row(list, &stop->trunks[i], row_h);
  }
  if (overflow) {
    /* 2a compressed pattern: dimmed overflow bullet tray */
    lv_obj_t *tray = lv_obj_create(list);
    style_plain(tray);
    lv_obj_set_size(tray, TK_SCREEN_W - 2 * TK_ROW_HPAD, 40);
    lv_obj_set_flex_flow(tray, LV_FLEX_FLOW_ROW);
    lv_obj_set_style_pad_column(tray, 6, 0);
    lv_obj_set_style_opa(tray, LV_OPA_50, 0);
    for (int i = TK_MAX_VISIBLE_ROWS; i < stop->trunk_count; i++) {
      const model_trunk_t *t = &stop->trunks[i];
      lv_obj_t *b = lv_obj_create(tray);
      style_plain(b);
      lv_obj_set_size(b, 28, 28);
      lv_obj_set_style_radius(b, LV_RADIUS_CIRCLE, 0);
      lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
      lv_obj_set_style_bg_color(b, hex(t->color), 0);
      if (t->route_count > 0) {
        lv_obj_t *l = make_label(b, t->routes[0].label, &lv_font_montserrat_14, t->text_color);
        lv_obj_center(l);
      }
    }
  }
}

/* ---------- state screens ---------- */

static void build_skeleton(void) {
  /* board bones: name bar, pill bar, 3 rows of circle+bars; opacity sweep */
  lv_obj_t *name = lv_obj_create(g_content);
  style_plain(name);
  lv_obj_set_size(name, 220, 28);
  lv_obj_set_style_radius(name, 6, 0);
  lv_obj_set_style_bg_opa(name, LV_OPA_COVER, 0);
  lv_obj_set_style_bg_color(name, hex(TK_SKELETON_BASE), 0);
  lv_obj_set_pos(name, TK_SIDE_INSET, TK_HEADER_TOP);

  for (int i = 0; i < 3; i++) {
    int y = TK_ROWS_TOP + i * 90;
    lv_obj_t *circ = lv_obj_create(g_content);
    style_plain(circ);
    lv_obj_set_size(circ, TK_BULLET_D, TK_BULLET_D);
    lv_obj_set_style_radius(circ, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_opa(circ, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(circ, hex(TK_SKELETON_BASE), 0);
    lv_obj_set_pos(circ, TK_ROW_HPAD, y);
    lv_obj_t *bar = lv_obj_create(g_content);
    style_plain(bar);
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
  lv_anim_set_exec_cb(&a, (lv_anim_exec_xcb_t)lv_obj_set_style_opa);
  lv_anim_start(&a);
}

static void build_no_location(void) {
  /* R10: adapted empty-mode pattern (Mario's call). Solid ring stands in
   * for the dashed circle — LVGL borders don't dash. */
  lv_obj_t *ring = lv_obj_create(g_content);
  style_plain(ring);
  lv_obj_set_size(ring, 56, 56);
  lv_obj_set_style_radius(ring, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_border_width(ring, 2, 0);
  lv_obj_set_style_border_color(ring, hex(TK_EMPTY_RING), 0);
  lv_obj_align(ring, LV_ALIGN_TOP_MID, 0, 150);

  lv_obj_t *title = make_label(g_content, "Can't find you", &lv_font_montserrat_24, TK_EMPTY_TITLE);
  lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 230);
  lv_obj_t *body = make_label(g_content, "No known WiFi networks nearby.\nRetrying automatically.",
                              &lv_font_montserrat_16, TK_TEXT_MUTED); /* 17 → 16 */
  lv_obj_set_style_text_align(body, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(body, LV_ALIGN_TOP_MID, 0, 270);
}

static void build_offline_banner(const ui_state_t *st) {
  char text[64];
  snprintf(text, sizeof(text), "last fetch %um ago — retrying automatically",
           st->secs_since_fetch / 60u);
  lv_obj_t *banner = make_label(g_jitter, text, &lv_font_montserrat_14, TK_OFFLINE); /* 15→14 */
  lv_obj_align(banner, LV_ALIGN_BOTTOM_MID, 0, -40);
}

/* ---------- public seams ---------- */

void ui_init(void) {
  g_root = lv_screen_active();
  lv_obj_set_style_bg_color(g_root, hex(TK_BG), 0);
  lv_obj_set_style_bg_opa(g_root, LV_OPA_COVER, 0);
  lv_obj_clear_flag(g_root, LV_OBJ_FLAG_SCROLLABLE);
  g_jitter = NULL;
}

void ui_board_show(const model_nearby_t *model, const ui_state_t *state) {
  if (g_jitter) lv_obj_delete(g_jitter);
  g_jitter = lv_obj_create(g_root);
  style_plain(g_jitter);
  lv_obj_set_size(g_jitter, TK_SCREEN_W, TK_SCREEN_H);
  /* spec burn-in requirement: whole-layout jitter on each full render */
  int jx = (rand() % (2 * TK_JITTER_PX + 1)) - TK_JITTER_PX;
  int jy = (rand() % (2 * TK_JITTER_PX + 1)) - TK_JITTER_PX;
  lv_obj_set_pos(g_jitter, jx, jy);

  g_conn_at_show = state->conn;
  build_chrome(state);

  g_content = lv_obj_create(g_jitter);
  style_plain(g_content);
  lv_obj_set_size(g_content, TK_SCREEN_W, TK_SCREEN_H);

  if (state->conn == UI_CONN_NO_LOCATION) {
    build_no_location();
    build_mode_dots(0);
    return;
  }
  if (state->conn == UI_CONN_LOADING || model == NULL || !model->rail.present ||
      model->rail.no_data) {
    build_skeleton();
    build_mode_dots(0);
    return;
  }

  const model_rail_system_t *rail = &model->rail;
  uint8_t idx = state->stop_idx < rail->stop_count ? state->stop_idx : 0;
  if (rail->stop_count == 0) {
    /* empty-but-live: handoff empty-mode with nearest distance */
    lv_obj_t *title = make_label(g_content, "No trains nearby", &lv_font_montserrat_24,
                                 TK_EMPTY_TITLE);
    lv_obj_align(title, LV_ALIGN_TOP_MID, 0, 210);
    if (rail->nearest_distance_label[0]) {
      char body[64];
      snprintf(body, sizeof(body), "Closest station is %s away.", rail->nearest_distance_label);
      lv_obj_t *b = make_label(g_content, body, &lv_font_montserrat_16, TK_TEXT_MUTED);
      lv_obj_align(b, LV_ALIGN_TOP_MID, 0, 250);
    }
  } else {
    bool two_line = false;
    build_header(rail, &rail->stops[idx], &two_line);
    build_rows(&rail->stops[idx], two_line);
    build_stop_dots(rail->stop_count, idx);
  }
  build_mode_dots(0);

  bool degraded = state->conn == UI_CONN_OFFLINE || state->conn == UI_CONN_STALE;
  if (degraded) {
    /* shared degraded content treatment; the chip alone distinguishes the
     * two failures (R6: offline red vs stale amber) */
    lv_obj_set_style_opa(g_content, LV_OPA_60, 0);
    build_offline_banner(state);
  }
}

void ui_board_tick(const ui_state_t *state) {
  if (!g_chip_label) return;
  /* label-only: no re-layout, no jitter (R7) */
  char buf[24];
  chip_text(buf, sizeof(buf), state);
  lv_label_set_text(g_chip_label, buf);
  lv_obj_set_style_text_color(g_chip_label, hex(chip_color(state)), 0);
  if (g_chip_dot) lv_obj_set_style_bg_color(g_chip_dot, hex(chip_color(state)), 0);
}
