/*
 * ui_detail.c — the trunk detail view (plan U4; handoff §2, R4/R2/R7).
 *
 * One trunk, ONE direction: renders directions[state->dir] of the open
 * trunk — the per-direction arrival arrays arrive from the API already
 * interleaved across the trunk's routes and ETA-sorted, so the list is the
 * array in order. Geometry is §2 verbatim: header at top=44 (52 px bullet
 * cluster overlapped -13, station name 14 px caps, direction 20/600 with a
 * tappable ⇅, right-aligned ‹ back), 14 px bottom pad + hairline, arrivals
 * from top=144 to bottom=64 in 86 px rows (44 px bullet, 17 px headsign,
 * 40/700 countdown + 14 px "min"), footer hint at bottom=36.
 *
 * Alert placement: §2 lists alert text as detail content but gives it no
 * geometric slot, so per the plan it renders as a compact single-line
 * banner in the gap between the header hairline (y=110) and the list
 * (y=144) — ellipsized, amber for "delay", muted for "info", gated by
 * directions_mask on the ACTIVE direction. A null alert renders exactly
 * nothing: CONCEPTS.md says it deliberately conflates "no alert", "source
 * down" and "stale" — one state, never invented distinctions.
 *
 * The arrivals list is the ONLY LVGL-scrollable object anywhere (KTD-2):
 * vertical only, scrollbar hidden. Scroll offset is tracked via
 * LV_EVENT_SCROLL into statics keyed by (trunk_key, dir) and restored —
 * clamped to the new content — when a full rebuild re-renders the same
 * trunk in the same direction (model refresh, stale transition). A dir
 * flip or a different trunk starts at the top; ui_detail_prepare()
 * forgets the offset whenever a non-detail view renders, so reopening a
 * trunk also starts at the top.
 *
 * R7 minute tick: ui_detail_minute_tick() rewrites the countdown labels in
 * place from the already-decremented model — same order, same count, no
 * rebuild, scroll untouched. Font quirk: the 14 px face carries no ⇅ (only
 * the 15/16/20 semibold faces merge U+21C5 from DejaVu), so hint lines
 * that mention ⇅ are composed from 14 px text labels plus a 15 px glyph
 * label in a flex row.
 */
#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include "ui.h"
#include "ui_internal.h"
#include "ui_tokens.h"

static lv_color_t hex(uint32_t rgb) { return lv_color_hex(rgb); }

/* Scroll memory (survives full rebuilds; that is the point). */
static char g_scroll_key[MODEL_TRUNK_KEY_LEN];
static uint8_t g_scroll_dir;
static int32_t g_scroll_y;

/* Countdown labels of the LAST render — the minute tick rewrites these in
 * place. Invalidated by ui_detail_prepare() before every tree teardown. */
static lv_obj_t *g_cd_labels[MODEL_MAX_ARRIVALS];
static uint8_t g_cd_count;
static bool g_cd_degraded;
static char g_cd_key[MODEL_TRUNK_KEY_LEN]; /* trunk the labels belong to */
static uint8_t g_cd_dir;

void ui_detail_prepare(const ui_state_t *state) {
  g_cd_count = 0; /* the tree these labels live in is about to be deleted */
  if (state->view != UI_VIEW_DETAIL) g_scroll_key[0] = '\0';
}

/* ---------- resolution ---------- */

/* Same clamp discipline as the board: indices are the reconciler-corrected
 * render cache (R6) — clamp defensively, never trust them raw. */
static const model_trunk_t *resolve_trunk(const model_nearby_t *model,
                                          const ui_state_t *state,
                                          const model_stop_t **stop_out) {
  const model_rail_system_t *rail = &model->rail;
  if (!rail->present || rail->stop_count == 0) return NULL;
  uint8_t sidx = state->stop_idx[UI_SYS_RAIL] < rail->stop_count
                     ? state->stop_idx[UI_SYS_RAIL]
                     : 0;
  const model_stop_t *stop = &rail->stops[sidx];
  if (stop->trunk_count == 0) return NULL;
  uint8_t tidx = state->trunk_idx < stop->trunk_count ? state->trunk_idx : 0;
  if (stop_out) *stop_out = stop;
  return &stop->trunks[tidx];
}

/* Bullet shape for one arrival: match its route label back to the trunk's
 * route list (feed-sourced shape); unmatched labels default to circle. */
static model_shape_t route_shape(const model_trunk_t *t, const char *route) {
  for (int i = 0; i < t->route_count; i++) {
    if (strcmp(t->routes[i].label, route) == 0) return t->routes[i].shape;
  }
  return MODEL_SHAPE_CIRCLE;
}

/* ---------- hint rows (⇅ lives only in the 15/16/20 px faces) ---------- */

static lv_obj_t *build_hint_row(lv_obj_t *content, const char *pre, const char *post,
                                uint32_t color) {
  lv_obj_t *row = lv_obj_create(content);
  ui_style_plain(row);
  lv_obj_set_size(row, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(row, 4, 0);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  if (pre && pre[0]) ui_make_label(row, pre, TK_FONT_SUB, color);
  ui_make_label(row, "\xE2\x87\x85", TK_FONT_PILL, color); /* ⇅ at 15 px */
  if (post && post[0]) ui_make_label(row, post, TK_FONT_SUB, color);
  return row;
}

/* ---------- header (§2) ---------- */

static int build_header_cluster(lv_obj_t *content, const model_trunk_t *t) {
  lv_obj_t *cluster = lv_obj_create(content);
  ui_style_plain(cluster);
  lv_obj_set_size(cluster, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(cluster, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(cluster, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER,
                        LV_FLEX_ALIGN_CENTER);
  lv_obj_set_pos(cluster, TK_SIDE_INSET, TK_DETAIL_HEADER_TOP);
  for (int i = 0; i < t->route_count; i++) {
    bool pill = t->routes[i].shape == MODEL_SHAPE_PILL;
    lv_obj_t *b = lv_obj_create(cluster);
    ui_style_plain(b);
    if (pill) {
      lv_obj_set_size(b, LV_SIZE_CONTENT, 40);
      lv_obj_set_style_pad_hor(b, 10, 0);
      lv_obj_set_style_radius(b, 9, 0);
    } else {
      lv_obj_set_size(b, TK_DETAIL_BULLET_D, TK_DETAIL_BULLET_D);
      lv_obj_set_style_radius(b, LV_RADIUS_CIRCLE, 0);
    }
    lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(b, hex(t->color), 0);
    lv_obj_set_style_border_width(b, TK_BULLET_RING, 0);
    lv_obj_set_style_border_color(b, hex(TK_BG), 0);
    if (!pill && i > 0) lv_obj_set_style_margin_left(b, -TK_DETAIL_BULLET_OVERLAP, 0);
    lv_obj_t *l = ui_make_label(b, t->routes[i].label,
                                pill ? TK_FONT_DIRECTION : TK_FONT_BULLET, t->text_color);
    lv_obj_center(l);
  }
  /* width of the overlapped circle run (pills are rare in rail detail;
   * flex reports the real width after layout — this estimate only places
   * the text column, so circles-only math is fine) */
  return t->route_count * (TK_DETAIL_BULLET_D - TK_DETAIL_BULLET_OVERLAP) +
         TK_DETAIL_BULLET_OVERLAP;
}

static void build_header(lv_obj_t *content, const model_rail_system_t *rail,
                         const model_stop_t *stop, const model_trunk_t *trunk,
                         const ui_state_t *state, ui_detail_hits_t *hits) {
  int cluster_w = build_header_cluster(content, trunk);
  int text_x = TK_SIDE_INSET + cluster_w + TK_ROW_GAP;

  /* station name: 14 px caps, letter-spacing 1 */
  char caps[MODEL_NAME_LEN];
  size_t i = 0;
  for (; stop->name[i] && i < sizeof(caps) - 1; i++) {
    caps[i] = (char)toupper((unsigned char)stop->name[i]);
  }
  caps[i] = '\0';
  lv_obj_t *name = ui_make_label(content, caps, TK_FONT_SUB, TK_TEXT_MUTED);
  lv_obj_set_style_text_letter_space(name, 1, 0);
  lv_obj_set_width(name, TK_SCREEN_W - text_x - TK_SIDE_INSET - 60);
  lv_label_set_long_mode(name, LV_LABEL_LONG_DOT);
  lv_obj_set_pos(name, text_x, TK_DETAIL_HEADER_TOP + 2);

  /* direction label 20/600 + ⇅ (dim glyph) — the whole cluster is the flip
   * tap target (44 px padded by the router) */
  lv_obj_t *dir_row = lv_obj_create(content);
  ui_style_plain(dir_row);
  lv_obj_set_size(dir_row, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(dir_row, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(dir_row, 6, 0);
  lv_obj_set_flex_align(dir_row, LV_FLEX_ALIGN_START, LV_FLEX_ALIGN_CENTER,
                        LV_FLEX_ALIGN_CENTER);
  lv_obj_set_pos(dir_row, text_x, TK_DETAIL_HEADER_TOP + 22);
  const char *dir_label = rail->direction_labels[state->dir][0]
                              ? rail->direction_labels[state->dir]
                              : "";
  if (dir_label[0]) ui_make_label(dir_row, dir_label, TK_FONT_DIRECTION, TK_TEXT_BODY);
  ui_make_label(dir_row, "\xE2\x87\x85", TK_FONT_DIRECTION, TK_TEXT_FLIP_GLYPH);
  hits->flip = dir_row;

  /* ‹ back, right-aligned. §2 says 13 px; the ramp's nearest face is 14 px
   * (deliberate 1 px deviation, same face the stub used). */
  lv_obj_t *back = ui_make_label(content, "\xE2\x80\xB9 back", TK_FONT_SUB, TK_TEXT_FAINT);
  lv_obj_align(back, LV_ALIGN_TOP_RIGHT, -TK_SIDE_INSET, TK_DETAIL_HEADER_TOP + 2);
  hits->back = back;

  /* header bottom: 14 px pad then the 1 px hairline */
  lv_obj_t *hair = lv_obj_create(content);
  ui_style_plain(hair);
  lv_obj_set_size(hair, TK_SCREEN_W - 2 * TK_SIDE_INSET, 1);
  lv_obj_set_style_bg_opa(hair, LV_OPA_COVER, 0);
  lv_obj_set_style_bg_color(hair, hex(TK_HAIRLINE), 0);
  lv_obj_set_pos(hair, TK_SIDE_INSET,
                 TK_DETAIL_HEADER_TOP + TK_DETAIL_BULLET_D + TK_DETAIL_HEADER_PAD_B);
}

/* ---------- alert banner (plan choice: compact line under the hairline) --- */

static void build_alert(lv_obj_t *content, const model_trunk_t *t, uint8_t dir) {
  if (t->alert.severity == MODEL_ALERT_NONE) return; /* one "no alert" state */
  if (!(t->alert.directions_mask & (1u << dir))) return; /* not this direction */
  bool delay = t->alert.severity == MODEL_ALERT_DELAY;
  int hair_y = TK_DETAIL_HEADER_TOP + TK_DETAIL_BULLET_D + TK_DETAIL_HEADER_PAD_B;
  lv_obj_t *banner = ui_make_label(content, t->alert.text, TK_FONT_SUB,
                                   delay ? TK_ALERT : TK_TEXT_MUTED);
  /* 224-cap text on ONE ellipsized line: LONG_DOT only truncates once both
   * dimensions are fixed — an unset height lets the label wrap into the
   * list instead */
  lv_obj_set_size(banner, TK_SCREEN_W - 2 * TK_SIDE_INSET,
                  lv_font_get_line_height(TK_FONT_SUB));
  lv_label_set_long_mode(banner, LV_LABEL_LONG_DOT);
  /* centered in the hairline→list gap (110 → 144) */
  lv_obj_set_pos(banner, TK_SIDE_INSET, hair_y + 10);
}

/* ---------- arrivals list ---------- */

static void scroll_cb(lv_event_t *e) {
  /* continuous capture: the offset survives the rebuild that deletes the
   * list, which is exactly when it is needed */
  g_scroll_y = lv_obj_get_scroll_y((lv_obj_t *)lv_event_get_target(e));
}

static void countdown_text(char *buf, size_t cap, int16_t eta, bool degraded) {
  /* eta 0 renders "0" — leave-by semantics live upstream; degraded carries
   * the board's exact ~ treatment (stale numbers are estimates, spec #4) */
  snprintf(buf, cap, "%s%d", degraded ? "~" : "", eta);
}

static void build_arrival_row(lv_obj_t *list, const model_trunk_t *t,
                              const model_arrival_t *a, bool degraded) {
  lv_obj_t *row = lv_obj_create(list);
  ui_style_plain(row);
  lv_obj_set_size(row, TK_SCREEN_W - 2 * TK_ROW_HPAD, TK_DETAIL_ROW_H);
  lv_obj_set_style_border_side(row, LV_BORDER_SIDE_BOTTOM, 0);
  lv_obj_set_style_border_width(row, 1, 0);
  lv_obj_set_style_border_color(row, hex(TK_HAIRLINE), 0);

  /* 44 px bullet, 24 px label (bus pill: 56×36) */
  bool pill = route_shape(t, a->route) == MODEL_SHAPE_PILL;
  lv_obj_t *b = lv_obj_create(row);
  ui_style_plain(b);
  if (pill) {
    lv_obj_set_size(b, 56, 36);
    lv_obj_set_style_radius(b, 9, 0);
  } else {
    lv_obj_set_size(b, TK_DETAIL_ROW_BULLET_D, TK_DETAIL_ROW_BULLET_D);
    lv_obj_set_style_radius(b, LV_RADIUS_CIRCLE, 0);
  }
  lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
  lv_obj_set_style_bg_color(b, hex(t->color), 0);
  lv_obj_align(b, LV_ALIGN_LEFT_MID, 0, 0);
  lv_obj_t *bl = ui_make_label(b, a->route,
                               pill ? TK_FONT_DIRECTION : TK_FONT_TITLE_SM, t->text_color);
  lv_obj_center(bl);

  /* countdown right: 40/700 number + "min" 14, baseline-ish aligned */
  lv_obj_t *cd = lv_obj_create(row);
  ui_style_plain(cd);
  lv_obj_set_size(cd, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(cd, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(cd, 4, 0);
  lv_obj_set_flex_align(cd, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END, LV_FLEX_ALIGN_END);
  lv_obj_align(cd, LV_ALIGN_RIGHT_MID, 0, 0);
  char num[12];
  countdown_text(num, sizeof(num), a->eta_min, degraded);
  lv_obj_t *cd_label = ui_make_label(cd, num, TK_FONT_COUNTDOWN_XL, TK_TEXT_BODY);
  ui_make_label(cd, "min", TK_FONT_SUB, TK_TEXT_MUTED);
  if (g_cd_count < MODEL_MAX_ARRIVALS) g_cd_labels[g_cd_count++] = cd_label;

  /* headsign 17 px between bullet and countdown */
  int bullet_w = pill ? 56 : TK_DETAIL_ROW_BULLET_D;
  int hs_x = bullet_w + TK_ROW_GAP;
  lv_obj_t *hs = ui_make_label(row, a->headsign[0] ? a->headsign : "\xE2\x80\x94",
                               TK_FONT_BODY, TK_TEXT_SECONDARY);
  /* one line, ellipsized (fixed height — see the alert banner note) */
  lv_obj_set_size(hs, TK_SCREEN_W - 2 * TK_ROW_HPAD - hs_x - 118,
                  lv_font_get_line_height(TK_FONT_BODY));
  lv_label_set_long_mode(hs, LV_LABEL_LONG_DOT);
  lv_obj_align(hs, LV_ALIGN_LEFT_MID, hs_x, 0);
}

static void build_empty_direction(lv_obj_t *list, const model_rail_system_t *rail,
                                  uint8_t dir) {
  /* R4: a trunk alive in one direction is a different fact from an empty
   * system — one centered line inside the arrivals area, never blank,
   * never an auto-pop */
  const char *label = rail->direction_labels[dir][0] ? rail->direction_labels[dir] : NULL;
  const char *other =
      rail->direction_labels[dir ^ 1][0] ? rail->direction_labels[dir ^ 1] : NULL;
  char pre[48], post[32];
  if (label && other) {
    snprintf(pre, sizeof(pre), "No %s trains \xC2\xB7 tap", label);
    snprintf(post, sizeof(post), "for %s", other);
  } else {
    snprintf(pre, sizeof(pre), "No trains this direction \xC2\xB7 tap");
    post[0] = '\0';
  }
  lv_obj_t *line = build_hint_row(list, pre, post, TK_TEXT_MUTED);
  lv_obj_center(line);
}

static void build_list(lv_obj_t *content, const model_rail_system_t *rail,
                       const model_trunk_t *trunk, const ui_state_t *state,
                       bool degraded) {
  lv_obj_t *list = lv_obj_create(content);
  lv_obj_remove_style_all(list);
  /* THE one scrollable object (KTD-2): vertical only, scrollbar hidden;
   * elastic overscroll off so the void never shows through */
  lv_obj_set_scroll_dir(list, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(list, LV_SCROLLBAR_MODE_OFF);
  lv_obj_clear_flag(list, LV_OBJ_FLAG_SCROLL_ELASTIC);
  lv_obj_set_pos(list, TK_ROW_HPAD, TK_DETAIL_ROWS_TOP);
  lv_obj_set_size(list, TK_SCREEN_W - 2 * TK_ROW_HPAD,
                  TK_SCREEN_H - TK_DETAIL_ROWS_TOP - TK_DETAIL_ROWS_BOTTOM);
  lv_obj_add_event_cb(list, scroll_cb, LV_EVENT_SCROLL, NULL);

  const model_direction_t *d = &trunk->directions[state->dir];
  if (d->arrival_count == 0) {
    /* no flex here — the centered hint must not be flex-flowed to the top */
    build_empty_direction(list, rail, state->dir);
    return;
  }
  lv_obj_set_flex_flow(list, LV_FLEX_FLOW_COLUMN);
  for (int i = 0; i < d->arrival_count; i++) {
    build_arrival_row(list, trunk, &d->arrivals[i], degraded);
  }

  /* same (trunk, dir) as the last detail render → restore the offset,
   * clamped to the rebuilt content (fewer arrivals must not strand the
   * viewport past the end) */
  bool same = strcmp(g_scroll_key, trunk->key) == 0 && g_scroll_dir == state->dir;
  if (same && g_scroll_y > 0) {
    lv_obj_update_layout(list);
    int32_t max = lv_obj_get_scroll_bottom(list); /* at scroll_y 0 = max travel */
    int32_t y = g_scroll_y < max ? g_scroll_y : max;
    if (y > 0) lv_obj_scroll_to_y(list, y, LV_ANIM_OFF);
  } else {
    g_scroll_y = 0;
  }
  snprintf(g_scroll_key, sizeof(g_scroll_key), "%s", trunk->key);
  g_scroll_dir = state->dir;
}

/* ---------- the renderer seam ---------- */

void ui_detail_render(lv_obj_t *content, const model_nearby_t *model,
                      const ui_state_t *state, bool degraded, ui_detail_hits_t *hits) {
  const model_stop_t *stop = NULL;
  const model_trunk_t *trunk = resolve_trunk(model, state, &stop);
  if (trunk == NULL) {
    /* unreachable in practice: the reconciler pops a gone trunk to the
     * board before render (R6) — honest fallback, never a crash */
    ui_empty_mode(content, "No trains nearby", NULL, NULL);
    return;
  }

  build_header(content, &model->rail, stop, trunk, state, hits);
  build_alert(content, trunk, state->dir);
  build_list(content, &model->rail, trunk, state, degraded);

  /* footer hint, M2-amended copy (R4: "shake refreshes" drops until M3) */
  lv_obj_t *hint = build_hint_row(content, "scroll for later \xC2\xB7 tap", "to flip",
                                  TK_TEXT_FAINT);
  lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -TK_DETAIL_HINT_BOTTOM + 7);

  /* arm the minute-tick hook for exactly this (trunk, dir) render */
  snprintf(g_cd_key, sizeof(g_cd_key), "%s", trunk->key);
  g_cd_dir = state->dir;
  g_cd_degraded = degraded;
}

void ui_detail_minute_tick(const model_nearby_t *model, const ui_state_t *state) {
  if (state->view != UI_VIEW_DETAIL || model == NULL || g_cd_count == 0) return;
  const model_trunk_t *trunk = resolve_trunk(model, state, NULL);
  if (trunk == NULL) return;
  /* the labels belong to a specific (trunk, dir) render; if state moved on
   * without a rebuild (cannot happen today — navigation always rebuilds),
   * refuse to write mismatched numbers */
  if (strcmp(g_cd_key, trunk->key) != 0 || g_cd_dir != state->dir) return;
  const model_direction_t *d = &trunk->directions[state->dir];
  uint8_t n = g_cd_count < d->arrival_count ? g_cd_count : d->arrival_count;
  char num[12];
  for (uint8_t i = 0; i < n; i++) {
    countdown_text(num, sizeof(num), d->arrivals[i].eta_min, g_cd_degraded);
    lv_label_set_text(g_cd_labels[i], num);
  }
}
