/*
 * ui_input.h — screen-level gesture tracker contract (plan U2; R2, KTD-2).
 *
 * IDF-free: LVGL only, like the rest of components/ui. One tracker owns the
 * pointer indev and translates raw presses into the handoff's gesture
 * vocabulary; view code receives a tiny callback set and does its own
 * hit-testing (against press-time snapshots — U3/U4 wire that through
 * on_press). All callbacks run in LVGL context (timer/indev processing).
 */
#ifndef GTFS_COMPASS_UI_INPUT_H
#define GTFS_COMPASS_UI_INPUT_H

#include <stdbool.h>
#include <stdint.h>

#include "lvgl.h"

#ifdef __cplusplus
extern "C" {
#endif

/* Handoff gesture thresholds (design handoff §gestures). */
#define UI_INPUT_TAP_MAX_PX 15   /* wander under this at release = tap; at or
                                    beyond, the tap is suppressed (dead zone —
                                    also fed to lv_indev_set_scroll_limit so
                                    LVGL scroll engages at the same distance) */
#define UI_INPUT_SWIPE_MIN_PX 50 /* dominant-axis travel that resolves a swipe */
#define UI_INPUT_HIT_MIN_PX 44   /* minimum hit-region edge for small targets
                                    (the ⇅ pill and ‹ back are ~25 px visual) */

typedef enum {
  UI_SWIPE_LEFT = 0, /* finger travelled left  (next-system gesture) */
  UI_SWIPE_RIGHT,
  UI_SWIPE_UP,
  UI_SWIPE_DOWN,
} ui_swipe_t;

typedef struct {
  /* Finger-down, with the press point. KTD-2's press-time model snapshot
   * hangs off this hook; U2 only logs. May be NULL. */
  void (*on_press)(int32_t x, int32_t y, void *user);
  /* Tap resolved at release; coordinates are the PRESS point (hit-testing
   * targets what the finger landed on, not where it lifted). May be NULL. */
  void (*on_tap)(int32_t x, int32_t y, void *user);
  /* Swipe: fires exactly once per press, normally mid-press the moment the
   * threshold crosses; the rest of the press is then swallowed. May be NULL. */
  void (*on_swipe)(ui_swipe_t dir, void *user);
  void *user;
} ui_input_callbacks_t;

/* Attach the tracker to a pointer indev (device: lvgl_port_add_touch's;
 * sim: lv_sdl_mouse_create's). Sets the indev scroll limit to the 15 px
 * dead zone and starts the mid-press poll. Call once per build. */
void ui_input_attach(lv_indev_t *indev, const ui_input_callbacks_t *cbs);

/* True while a press is being tracked or a transition animation is running
 * (plan U3, R6 deferral contract): full renders must not rebuild the tree
 * under a finger or a slide — callers route render requests through a
 * deferral path gated on this. */
bool ui_input_busy(void);

/* Transition-animation flag feeding ui_input_busy() — U3 navigation is
 * instant so nothing sets it yet; U7's slide transitions own it. */
void ui_input_set_animating(bool animating);

/* Hit-region test: obj's on-screen rect, each edge padded out to at least
 * min_px (UI_INPUT_HIT_MIN_PX for the small chrome targets; visual spec
 * unchanged — padding is hit-area only). */
bool ui_input_hit(const lv_obj_t *obj, int32_t x, int32_t y, int32_t min_px);

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_UI_INPUT_H */
