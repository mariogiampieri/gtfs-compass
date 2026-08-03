/*
 * ui_internal.h — component-private seams between the view dispatcher
 * (ui_views.c: chrome, state screens, dispatch) and the per-view renderers
 * (ui_board.c today; ui_detail.c/ui_bike.c in U4/U5). Plan U3, KTD-3.
 *
 * Not installed in include/: callers outside components/ui see only ui.h.
 */
#ifndef GTFS_COMPASS_UI_INTERNAL_H
#define GTFS_COMPASS_UI_INTERNAL_H

#include "lvgl.h"
#include "model.h"
#include "ui_state.h"

/* Shared builders (ui_views.c owns the definitions). */
lv_obj_t *ui_make_label(lv_obj_t *parent, const char *text, const lv_font_t *font,
                        uint32_t color);
void ui_style_plain(lv_obj_t *o);

/* Handoff §7 empty-mode pattern: 56 px ring, 24 px title, up to two body
 * lines. line1/line2 may be NULL. Mode dots stay (the dispatcher draws
 * them); this renders only the centered cluster. */
void ui_empty_mode(lv_obj_t *content, const char *title, const char *line1,
                   const char *line2);

/* Objects the tap router hit-tests after a full render (KTD-2: hit regions
 * live on real on-screen rects; the deferral contract guarantees the tree
 * cannot change between press and release, so these stay valid per press). */
typedef struct {
  lv_obj_t *pill; /* ⇅ direction pill (44 px padded hit region) */
  lv_obj_t *rows[MODEL_MAX_TRUNKS];
  uint8_t row_count;
} ui_board_hits_t;

/* The rail board renderer (ui_board.c): header + pill, direction-aware rows,
 * stop dots, rail empty mode. Renders into content; fills *hits. */
void ui_board_render(lv_obj_t *content, const model_rail_system_t *rail,
                     const ui_state_t *state, bool degraded, ui_board_hits_t *hits);

/* Trunk-detail tap targets (plan U4; same 44 px padded hit-region rules). */
typedef struct {
  lv_obj_t *flip; /* header direction cluster incl. ⇅ — tap flips dir */
  lv_obj_t *back; /* ‹ back */
} ui_detail_hits_t;

/* The trunk detail renderer (ui_detail.c, handoff §2): header cluster,
 * alert banner, the ONLY LVGL-scrollable object (arrivals list), footer
 * hint. Renders directions[state->dir] of the open trunk into content;
 * fills *hits. Restores the previous scroll offset when re-rendering the
 * same (trunk_key, dir), clamped to the new content. */
void ui_detail_render(lv_obj_t *content, const model_nearby_t *model,
                      const ui_state_t *state, bool degraded, ui_detail_hits_t *hits);

/* Called by ui_render() before every tree teardown: drops the countdown
 * label pointers of the last detail render (they are about to dangle) and,
 * when the view being rendered is not DETAIL, forgets the remembered scroll
 * offset — so reopening a trunk starts at the top while same-trunk
 * refreshes preserve it. */
void ui_detail_prepare(const ui_state_t *state);

#endif /* GTFS_COMPASS_UI_INTERNAL_H */
