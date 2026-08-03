/*
 * ui_input.c — the screen-level gesture tracker (plan U2; R2, KTD-2).
 *
 * Why not LVGL's native gesture path: it gates on gesture_min_velocity (a
 * slow deliberate 60 px drag never fires) and has no >15 px tap-wander
 * suppression. The tracker implements the handoff thresholds exactly:
 *
 *   - press point recorded on the indev's LV_EVENT_PRESSED;
 *   - a fast lv_timer poll samples the point mid-press (LVGL forwards
 *     LV_EVENT_PRESSING to the object only, never to the indev), tracks
 *     peak wander, and resolves swipe (>=50 px, strictly dominant axis)
 *     exactly once, then lv_indev_wait_release() swallows the rest of the
 *     press;
 *   - scroll arbitration is observational (KTD-2): LVGL latches scroll
 *     unilaterally at its scroll limit — once lv_indev_get_scroll_obj()
 *     goes non-NULL the tracker stands down for the whole press (no swipe,
 *     no tap). lv_indev_set_scroll_limit(15) aligns LVGL's engagement with
 *     the handoff dead zone;
 *   - tap resolves at LV_EVENT_RELEASED iff peak wander stayed <15 px.
 *
 * Tracker state is static here, keyed to the indev — never on objects the
 * view dispatcher rebuilds (R6). The indev's read_cb is deliberately NOT
 * wrapped: the SDL mouse driver locates its indev by read_cb identity
 * (lv_sdl_mouse_handler), so a wrapper would disconnect the sim mouse.
 *
 * Assumption (holds for every screen): the pointer always lands on some
 * clickable object — LVGL only sends indev-level PRESSED/RELEASED when an
 * object is under the pointer, and our screens are fully covered.
 */
#include "ui_input.h"

#define POLL_PERIOD_MS 16 /* fast enough to catch a flick mid-press */

typedef struct {
  lv_indev_t *indev;
  ui_input_callbacks_t cbs;
  bool active;         /* a press is being tracked */
  lv_point_t press;    /* finger-down point */
  int32_t peak_wander; /* max |displacement| on either axis this press */
  bool scroll_latched; /* LVGL took the press for scrolling — stand down */
  bool swipe_fired;    /* swipe already resolved this press */
} tracker_t;

static tracker_t g_trk;
static bool g_animating; /* U7 slide transitions; always false in U3 */

bool ui_input_busy(void) { return g_trk.active || g_animating; }

void ui_input_set_animating(bool animating) { g_animating = animating; }

static void fire_swipe(ui_swipe_t dir) {
  g_trk.swipe_fired = true;
  /* Swallow the remainder of the press: no CLICKED on whatever object the
   * finger happens to lift over. */
  lv_indev_wait_release(g_trk.indev);
  if (g_trk.cbs.on_swipe) g_trk.cbs.on_swipe(dir, g_trk.cbs.user);
}

/* Feed one pointer sample; resolves swipe the moment its threshold crosses. */
static void track_sample(const lv_point_t *p) {
  int32_t dx = p->x - g_trk.press.x;
  int32_t dy = p->y - g_trk.press.y;
  int32_t adx = dx < 0 ? -dx : dx;
  int32_t ady = dy < 0 ? -dy : dy;
  int32_t wander = adx > ady ? adx : ady;
  if (wander > g_trk.peak_wander) g_trk.peak_wander = wander;

  /* Scroll latch check every sample: once LVGL owns the press, everything
   * here stands down until release. */
  if (lv_indev_get_scroll_obj(g_trk.indev) != NULL) {
    g_trk.scroll_latched = true;
    return;
  }
  if (g_trk.scroll_latched || g_trk.swipe_fired) return;

  /* Strictly dominant axis: a diagonal that crosses 50 px on both axes at
   * once resolves nothing (and keeps watching). */
  if (adx >= UI_INPUT_SWIPE_MIN_PX && adx > ady) {
    fire_swipe(dx > 0 ? UI_SWIPE_RIGHT : UI_SWIPE_LEFT);
  } else if (ady >= UI_INPUT_SWIPE_MIN_PX && ady > adx) {
    fire_swipe(dy > 0 ? UI_SWIPE_DOWN : UI_SWIPE_UP);
  }
}

static void pressed_cb(lv_event_t *e) {
  (void)e;
  g_trk.active = true;
  g_trk.peak_wander = 0;
  g_trk.scroll_latched = false;
  g_trk.swipe_fired = false;
  lv_indev_get_point(g_trk.indev, &g_trk.press);
  if (g_trk.cbs.on_press) g_trk.cbs.on_press(g_trk.press.x, g_trk.press.y, g_trk.cbs.user);
}

static void released_cb(lv_event_t *e) {
  (void)e;
  if (!g_trk.active) return;
  g_trk.active = false;

  /* Final sample: catches travel between the last poll and the release
   * (a fast flick may cross the swipe threshold only here). */
  lv_point_t p;
  lv_indev_get_point(g_trk.indev, &p);
  track_sample(&p);

  if (g_trk.scroll_latched || g_trk.swipe_fired) return;
  if (g_trk.peak_wander < UI_INPUT_TAP_MAX_PX && g_trk.cbs.on_tap) {
    g_trk.cbs.on_tap(g_trk.press.x, g_trk.press.y, g_trk.cbs.user);
  }
}

static void poll_cb(lv_timer_t *t) {
  (void)t;
  if (!g_trk.active) return;
  /* After lv_indev_wait_release LVGL suppresses the RELEASED event (act_obj
   * is dropped), so the poll also watches the raw state to end the press. */
  if (lv_indev_get_state(g_trk.indev) == LV_INDEV_STATE_RELEASED) {
    g_trk.active = false;
    return;
  }
  lv_point_t p;
  lv_indev_get_point(g_trk.indev, &p);
  track_sample(&p);
}

void ui_input_attach(lv_indev_t *indev, const ui_input_callbacks_t *cbs) {
  LV_ASSERT_NULL(indev);
  g_trk.indev = indev;
  g_trk.cbs = cbs ? *cbs : (ui_input_callbacks_t){0};
  g_trk.active = false;
  /* LVGL scroll engagement = the handoff dead zone, so "scroll starts" and
   * "tap is dead" are the same 15 px fact (KTD-2). */
  lv_indev_set_scroll_limit(indev, UI_INPUT_TAP_MAX_PX);
  lv_indev_add_event_cb(indev, pressed_cb, LV_EVENT_PRESSED, NULL);
  lv_indev_add_event_cb(indev, released_cb, LV_EVENT_RELEASED, NULL);
  lv_timer_create(poll_cb, POLL_PERIOD_MS, NULL);
}

bool ui_input_hit(const lv_obj_t *obj, int32_t x, int32_t y, int32_t min_px) {
  lv_area_t a;
  lv_obj_get_coords(obj, &a);
  int32_t w = lv_area_get_width(&a);
  int32_t h = lv_area_get_height(&a);
  if (w < min_px) {
    int32_t pad = (min_px - w + 1) / 2;
    a.x1 -= pad;
    a.x2 += pad;
  }
  if (h < min_px) {
    int32_t pad = (min_px - h + 1) / 2;
    a.y1 -= pad;
    a.y2 += pad;
  }
  /* (lv_area_is_point_on is private API in LVGL 9.5 — inline the check.) */
  return x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2;
}
