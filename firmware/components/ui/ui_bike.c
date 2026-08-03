/*
 * ui_bike.c — bike station screen + nearby compare (plan U5; handoff §3–4).
 *
 * Renders into the dispatcher's content container like ui_board.c; all
 * numbers and segment widths come from ui_bike_layout_compute() (pure,
 * host-tested), so this file only places objects. The R5 degraded trio is
 * split across layers: no_data → skeleton and zero-stations → §7 empty mode
 * stay in ui_views.c's bike dispatch (system-level facts, shared chrome);
 * per-station -1 sentinels land here as "—" heroes + hidden bar + muted
 * note (station-level facts).
 *
 * Known approximations (deliberate): the 84 px heroes are gc_plex_84 at
 * weight 700 (U6 generated 700; handoff says 800), and the §4 station name
 * is 20 px (the ramp has no 19 — gc_plex_20 is the 600 weight the handoff
 * asks for). Caps letter-spacing rounds to whole px (1.8/1.5 → 2).
 */
#include <stdio.h>
#include <string.h>

#include "ui.h"
#include "ui_bike_layout.h"
#include "ui_internal.h"
#include "ui_tokens.h"

static lv_color_t hex(uint32_t rgb) { return lv_color_hex(rgb); }

/* ---------- station screen (§3) ---------- */

/* Same length-adaptive rule as the board header (handoff §1/§3: "header
 * same as board, minus direction pill"). */
static const lv_font_t *header_font(size_t name_len, bool *two_line) {
  *two_line = false;
  if (name_len <= 12) return TK_FONT_TITLE_LG;
  if (name_len <= 18) return TK_FONT_TITLE_MD;
  *two_line = true;
  return TK_FONT_TITLE_SM;
}

static void build_header(lv_obj_t *content, const model_bike_station_t *s) {
  bool two_line = false;
  lv_obj_t *name = ui_make_label(content, s->name,
                                 header_font(strlen(s->name), &two_line), TK_TEXT_PRIMARY);
  lv_obj_set_width(name, TK_SCREEN_W - 2 * TK_SIDE_INSET);
  lv_label_set_long_mode(name, LV_LABEL_LONG_DOT);
  lv_obj_set_pos(name, TK_SIDE_INSET, TK_HEADER_TOP);

  /* distance only — no direction pill on the bike header (§3) */
  lv_obj_t *dist = ui_make_label(content, s->distance_label, TK_FONT_PILL, TK_TEXT_MUTED);
  lv_obj_set_pos(dist, TK_SIDE_INSET, TK_HEADER_TOP + (two_line ? 68 : 40));
}

/* One hero column: 84 px number with its caps label underneath. */
static void build_hero(lv_obj_t *content, const char *num, uint32_t num_color,
                       const char *caption, bool right) {
  lv_obj_t *n = ui_make_label(content, num, TK_FONT_HERO, num_color);
  lv_obj_set_style_text_letter_space(n, TK_BIKE_HERO_LS, 0);
  lv_obj_align(n, right ? LV_ALIGN_TOP_RIGHT : LV_ALIGN_TOP_LEFT,
               right ? -TK_SIDE_INSET : TK_SIDE_INSET, TK_BIKE_HERO_TOP);

  lv_obj_t *c = ui_make_label(content, caption, TK_FONT_PILL, TK_TEXT_MUTED);
  lv_obj_set_style_text_letter_space(c, TK_BIKE_LABEL_LS, 0);
  lv_obj_align_to(c, n, right ? LV_ALIGN_OUT_BOTTOM_RIGHT : LV_ALIGN_OUT_BOTTOM_LEFT, 0, 2);
}

/* Segmented capacity bar: rounded container clips square child segments;
 * gaps read as screen background between segments. */
static void build_bar(lv_obj_t *parent, const ui_bike_layout_t *lay, int32_t x,
                      int32_t y, int32_t w, int32_t h, int32_t radius) {
  lv_obj_t *bar = lv_obj_create(parent);
  ui_style_plain(bar);
  lv_obj_set_size(bar, w, h);
  lv_obj_set_pos(bar, x, y);
  lv_obj_set_style_radius(bar, radius, 0);
  lv_obj_set_style_clip_corner(bar, true, 0);

  const struct {
    int16_t w;
    uint32_t color;
  } segs[] = {
      {lay->classic_w, TK_BIKE_CLASSIC},
      {lay->electric_w, TK_BIKE_ELECTRIC},
      {lay->empty_w, TK_BIKE_EMPTY},
  };
  int32_t sx = 0;
  for (size_t i = 0; i < sizeof(segs) / sizeof(segs[0]); i++) {
    if (segs[i].w <= 0) continue; /* absent segment: no sliver, no gap */
    lv_obj_t *seg = lv_obj_create(bar);
    ui_style_plain(seg);
    lv_obj_set_size(seg, segs[i].w, h);
    lv_obj_set_pos(seg, sx, 0);
    lv_obj_set_style_bg_opa(seg, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(seg, hex(segs[i].color), 0);
    sx += segs[i].w + TK_BIKE_BAR_GAP;
  }
}

/* Legend group: swatch dot + count (#E8E8EC) + word (#9A9AA0). */
static void legend_group(lv_obj_t *row, uint32_t swatch, int count, const char *word) {
  lv_obj_t *dot = lv_obj_create(row);
  ui_style_plain(dot);
  lv_obj_set_size(dot, TK_BIKE_LEGEND_DOT, TK_BIKE_LEGEND_DOT);
  lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
  lv_obj_set_style_bg_color(dot, hex(swatch), 0);

  char num[8];
  snprintf(num, sizeof(num), "%d", count);
  ui_make_label(row, num, TK_FONT_BODY, TK_TEXT_BODY);
  ui_make_label(row, word, TK_FONT_BODY, TK_TEXT_SECONDARY);
}

static void build_legend(lv_obj_t *content, const model_bike_station_t *s) {
  lv_obj_t *row = lv_obj_create(content);
  ui_style_plain(row);
  lv_obj_set_size(row, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(row, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(row, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
  lv_obj_set_style_pad_column(row, 6, 0);
  lv_obj_align(row, LV_ALIGN_TOP_MID, 0,
               TK_BIKE_BAR_TOP + TK_BIKE_BAR_H + TK_BIKE_LEGEND_GAP);

  legend_group(row, TK_BIKE_CLASSIC, s->bikes_classic, "classic");
  ui_make_label(row, "·", TK_FONT_BODY, TK_TEXT_SECONDARY);
  legend_group(row, TK_BIKE_ELECTRIC, s->bikes_electric, "electric");
  ui_make_label(row, "·", TK_FONT_BODY, TK_TEXT_SECONDARY);
  legend_group(row, TK_BIKE_EMPTY, s->docks_open, "open");
}

void ui_bike_board_render(lv_obj_t *content, const model_bike_system_t *bike,
                          const ui_state_t *state) {
  /* selection by identity: the reconciler keeps stop_idx pointing at
   * stop_id[bike] across refreshes; clamp is a belt-and-braces default */
  uint8_t idx = state->stop_idx[UI_SYS_BIKE] < bike->station_count
                    ? state->stop_idx[UI_SYS_BIKE]
                    : 0;
  const model_bike_station_t *s = &bike->stations[idx];

  ui_bike_layout_t lay;
  ui_bike_layout_compute(s, TK_SCREEN_W - 2 * TK_SIDE_INSET, TK_BIKE_BAR_GAP, &lay);

  build_header(content, s);
  build_hero(content, lay.bikes, TK_BIKE_CLASSIC, "BIKES", false);
  build_hero(content, lay.docks, TK_TEXT_BODY, "DOCKS", true);

  if (lay.show_bar) {
    build_bar(content, &lay, TK_SIDE_INSET, TK_BIKE_BAR_TOP,
              TK_SCREEN_W - 2 * TK_SIDE_INSET, TK_BIKE_BAR_H, TK_BIKE_BAR_R);
  }
  if (lay.counts_known) {
    build_legend(content, s);
  } else {
    /* R5: unknown counts are a fact of their own — never "0 bikes" */
    lv_obj_t *note = ui_make_label(content, "live counts unavailable",
                                   TK_FONT_SUB, TK_TEXT_MUTED);
    lv_obj_align(note, LV_ALIGN_TOP_MID, 0, TK_BIKE_BAR_TOP);
  }

  lv_obj_t *hint = ui_make_label(content, "tap for nearby stations", TK_FONT_SUB,
                                 TK_TEXT_FAINT);
  lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -TK_BIKE_HINT_BOTTOM);
}

/* ---------- nearby compare (§4) ---------- */

void ui_bike_nearby_render(lv_obj_t *content, const model_bike_system_t *bike,
                           const ui_state_t *state, ui_nearby_hits_t *hits) {
  (void)state; /* selection changes only via a row tap (R2) */

  lv_obj_t *title = ui_make_label(content, "NEARBY STATIONS", TK_FONT_CHIP,
                                  TK_TEXT_MUTED);
  lv_obj_set_style_text_letter_space(title, TK_NEARBY_HEADER_LS, 0);
  lv_obj_set_pos(title, TK_SIDE_INSET, TK_NEARBY_HEADER_TOP);

  hits->back = ui_make_label(content, "\xE2\x80\xB9 back", TK_FONT_SUB, TK_TEXT_FAINT);
  lv_obj_align(hits->back, LV_ALIGN_TOP_RIGHT, -TK_SIDE_INSET, TK_NEARBY_HEADER_TOP);

  /* §4: 3 visible rows, equal heights, sorted by distance (API order); no
   * scrolling — the detail arrivals list is the only scrollable (KTD-2) */
  uint8_t n = bike->station_count < TK_NEARBY_VISIBLE ? bike->station_count
                                                      : TK_NEARBY_VISIBLE;
  int32_t row_w = TK_SCREEN_W - 2 * TK_SIDE_INSET;
  int32_t row_h = (TK_SCREEN_H - TK_NEARBY_ROWS_TOP - TK_NEARBY_ROWS_BOTTOM) /
                  TK_NEARBY_VISIBLE;
  for (uint8_t i = 0; i < n; i++) {
    const model_bike_station_t *s = &bike->stations[i];
    lv_obj_t *row = lv_obj_create(content);
    ui_style_plain(row);
    lv_obj_set_size(row, row_w, row_h);
    lv_obj_set_pos(row, TK_SIDE_INSET, TK_NEARBY_ROWS_TOP + i * row_h);
    lv_obj_set_style_border_side(row, LV_BORDER_SIDE_TOP, 0);
    lv_obj_set_style_border_width(row, 1, 0);
    lv_obj_set_style_border_color(row, hex(TK_HAIRLINE), 0);

    /* name+bar cluster vertically centered in the row */
    int32_t name_h = lv_font_get_line_height(TK_FONT_DIRECTION);
    int32_t cluster_h = name_h + TK_NEARBY_BAR_GAP + TK_NEARBY_BAR_H;
    int32_t top = (row_h - cluster_h) / 2;

    /* §4 name is 19/600 — gc_plex_20 (600) stands in; the ramp has no 19.
     * Fixed height: LONG_DOT only ellipsizes when it can't wrap taller. */
    lv_obj_t *name = ui_make_label(row, s->name, TK_FONT_DIRECTION, TK_TEXT_BODY);
    lv_obj_set_size(name, row_w - 80, name_h);
    lv_label_set_long_mode(name, LV_LABEL_LONG_DOT);
    lv_obj_set_pos(name, 0, top);

    lv_obj_t *dist = ui_make_label(row, s->distance_label, TK_FONT_PILL, TK_TEXT_MUTED);
    lv_obj_align(dist, LV_ALIGN_TOP_RIGHT, 0, top + 3);

    ui_bike_layout_t lay;
    ui_bike_layout_compute(s, (int16_t)row_w, TK_BIKE_BAR_GAP, &lay);
    if (lay.show_bar) {
      /* same color language as §3, 10 px tall, radius 5 */
      build_bar(row, &lay, 0, top + name_h + TK_NEARBY_BAR_GAP, row_w,
                TK_NEARBY_BAR_H, TK_NEARBY_BAR_R);
    }

    hits->rows[i] = row;
  }
  hits->row_count = n;
}
