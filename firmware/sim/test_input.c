/*
 * test_input.c — automated gesture-tracker tests (plan U2 test scenarios).
 *
 * Headless: a dummy LVGL display (flush discards) + a scripted pointer
 * indev driven sample-by-sample through lv_indev_read, with a manually
 * advanced tick so the tracker's poll timer runs deterministically. No SDL
 * window — this exercises the exact indev machinery (press/scroll-latch/
 * release paths in lv_indev.c) the device touch and sim mouse go through.
 *
 * Scenarios (plan U2):
 *   1. tap under 15 px fires tap (at the press point)
 *   2. 35 px drag fires neither (dead zone)
 *   3. 60 px horizontal fires swipe exactly once; next press still works
 *   4. vertical drag on a scrollable object engages LVGL scroll, tracker
 *      stands down
 *   5. mixed-axis 40 px down (scroll-latched) then 60 px right never swipes
 *   6. tap after >15 px wander (out and back) is suppressed
 *   7. 44 px hit-region pad resolves a near-miss on a ~25 px target
 *   8. (U3) ui_input_busy() is true mid-press and false after release —
 *      the gate main.c's render-request deferral path stands on (R6)
 */
#include <stdio.h>
#include <string.h>

#include "lvgl.h"
#include "ui_input.h"

#define HOR 410
#define VER 502

/* ---------- controlled time ---------- */

static uint32_t g_tick;
static uint32_t tick_cb(void) { return g_tick; }

/* ---------- dummy display ---------- */

static uint8_t g_draw_buf[HOR * 64 * 4];

static void flush_cb(lv_display_t *disp, const lv_area_t *area, uint8_t *px_map) {
  (void)area;
  (void)px_map;
  lv_display_flush_ready(disp);
}

/* ---------- scripted pointer ---------- */

static lv_indev_t *g_indev;
static lv_point_t g_pt;
static bool g_pressed;

static void read_cb(lv_indev_t *indev, lv_indev_data_t *data) {
  (void)indev;
  data->point = g_pt;
  data->state = g_pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
}

/* One scripted sample: feed it, then advance time past one tracker poll. */
static void step(int32_t x, int32_t y, bool pressed) {
  g_pt.x = x;
  g_pt.y = y;
  g_pressed = pressed;
  lv_indev_read(g_indev);
  g_tick += 17;
  lv_timer_handler();
}

/* ---------- event recorder ---------- */

static int g_n_press, g_n_tap, g_n_swipe;
static lv_point_t g_last_tap;
static ui_swipe_t g_last_swipe;

static void on_press(int32_t x, int32_t y, void *user) {
  (void)x;
  (void)y;
  (void)user;
  g_n_press++;
}

static void on_tap(int32_t x, int32_t y, void *user) {
  (void)user;
  g_n_tap++;
  g_last_tap.x = x;
  g_last_tap.y = y;
}

static void on_swipe(ui_swipe_t dir, void *user) {
  (void)user;
  g_n_swipe++;
  g_last_swipe = dir;
}

static void reset_recorder(void) { g_n_press = g_n_tap = g_n_swipe = 0; }

/* ---------- assertions ---------- */

static int g_failures;

#define CHECK(cond, ...)                       \
  do {                                         \
    if (cond) {                                \
      printf("  ok: " __VA_ARGS__);            \
      printf("\n");                            \
    } else {                                   \
      printf("  FAIL: " __VA_ARGS__);          \
      printf("\n");                            \
      g_failures++;                            \
    }                                          \
  } while (0)

int main(void) {
  lv_init();
  lv_tick_set_cb(tick_cb);

  lv_display_t *disp = lv_display_create(HOR, VER);
  lv_display_set_buffers(disp, g_draw_buf, NULL, sizeof(g_draw_buf),
                         LV_DISPLAY_RENDER_MODE_PARTIAL);
  lv_display_set_flush_cb(disp, flush_cb);

  /* Background mirrors the board: full-cover, non-scrollable. */
  lv_obj_t *scr = lv_screen_active();
  lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

  /* The one scrollable object (stand-in for the detail arrivals list):
   * x 50..350, y 50..450, content overflows vertically. */
  lv_obj_t *list = lv_obj_create(scr);
  lv_obj_set_pos(list, 50, 50);
  lv_obj_set_size(list, 300, 400);
  lv_obj_t *filler = lv_obj_create(list);
  lv_obj_set_size(filler, 200, 900);

  g_indev = lv_indev_create();
  lv_indev_set_type(g_indev, LV_INDEV_TYPE_POINTER);
  lv_indev_set_mode(g_indev, LV_INDEV_MODE_EVENT);
  lv_indev_set_read_cb(g_indev, read_cb);
  lv_indev_set_display(g_indev, disp);

  ui_input_attach(g_indev, &(ui_input_callbacks_t){.on_press = on_press,
                                                   .on_tap = on_tap,
                                                   .on_swipe = on_swipe});

  /* Let the first refresh settle. */
  for (int i = 0; i < 5; i++) {
    g_tick += 17;
    lv_timer_handler();
  }

  /* Taps/swipes land on the non-scrollable background at y=470 unless a
   * scenario says otherwise. */

  printf("scenario 1: tap under 15 px\n");
  reset_recorder();
  step(20, 470, true);
  step(25, 474, true); /* 5 px wiggle stays inside the dead zone */
  step(25, 474, false);
  CHECK(g_n_press == 1, "press hook fired once (got %d)", g_n_press);
  CHECK(g_n_tap == 1, "tap fired once (got %d)", g_n_tap);
  CHECK(g_last_tap.x == 20 && g_last_tap.y == 470,
        "tap reports the press point (got %d,%d)", (int)g_last_tap.x, (int)g_last_tap.y);
  CHECK(g_n_swipe == 0, "no swipe (got %d)", g_n_swipe);

  printf("scenario 2: 35 px drag fires neither\n");
  reset_recorder();
  step(20, 470, true);
  step(35, 470, true);
  step(55, 470, true); /* 35 px total: past tap dead zone, short of swipe */
  step(55, 470, false);
  CHECK(g_n_tap == 0, "no tap (got %d)", g_n_tap);
  CHECK(g_n_swipe == 0, "no swipe (got %d)", g_n_swipe);

  printf("scenario 3: 60 px horizontal fires swipe once\n");
  reset_recorder();
  step(300, 470, true);
  step(280, 470, true);
  step(240, 468, true); /* crosses 50 px here, dominant x */
  step(220, 468, true); /* keeps travelling: must not fire again */
  step(210, 468, true);
  step(210, 468, false);
  CHECK(g_n_swipe == 1, "swipe fired exactly once (got %d)", g_n_swipe);
  CHECK(g_last_swipe == UI_SWIPE_LEFT, "direction is left (got %d)", (int)g_last_swipe);
  CHECK(g_n_tap == 0, "no tap after swipe (got %d)", g_n_tap);
  /* wait_release recovery: the next press must still resolve */
  reset_recorder();
  step(20, 470, true);
  step(20, 470, false);
  CHECK(g_n_tap == 1, "tap after a swipe press still works (got %d)", g_n_tap);

  printf("scenario 4: vertical drag on scrollable engages scroll, tracker stands down\n");
  reset_recorder();
  step(200, 300, true);
  step(200, 280, true);
  step(200, 240, true); /* 60 px up: over swipe threshold, but scroll owns it
                         * (upward = into the overflowing content, so real
                         * scroll, not elastic overscroll) */
  bool latched = lv_indev_get_scroll_obj(g_indev) != NULL;
  int32_t scrolled = lv_obj_get_scroll_y(list);
  step(200, 240, false);
  CHECK(latched, "LVGL latched scroll during the drag");
  CHECK(scrolled > 0, "list actually scrolled (scroll_y=%d)", (int)scrolled);
  CHECK(g_n_swipe == 0, "no swipe on a scrolling press (got %d)", g_n_swipe);
  CHECK(g_n_tap == 0, "no tap on a scrolling press (got %d)", g_n_tap);

  printf("scenario 5: mixed-axis 40 down then 60 right never swipes\n");
  reset_recorder();
  step(200, 150, true);
  step(200, 170, true);
  step(200, 190, true); /* 40 px down: scroll latched */
  step(230, 190, true);
  step(260, 190, true); /* 60 px right, still the same press */
  bool latched5 = lv_indev_get_scroll_obj(g_indev) != NULL;
  step(260, 190, false);
  CHECK(latched5, "scroll latch held for the whole press");
  CHECK(g_n_swipe == 0, "no swipe after scroll latch (got %d)", g_n_swipe);
  CHECK(g_n_tap == 0, "no tap either (got %d)", g_n_tap);

  printf("scenario 6: tap after >15 px wander is suppressed\n");
  reset_recorder();
  step(20, 470, true);
  step(40, 470, true); /* 20 px out... */
  step(20, 470, true); /* ...and back to the press point */
  step(20, 470, false);
  CHECK(g_n_tap == 0, "wandering press resolves no tap (got %d)", g_n_tap);
  CHECK(g_n_swipe == 0, "and no swipe (got %d)", g_n_swipe);

  printf("scenario 7: 44 px hit-region pad on a small target\n");
  /* ~25 px pill: visual rect x 100..124, y 460..484 (screen coords). */
  lv_obj_t *pill = lv_obj_create(scr);
  lv_obj_set_pos(pill, 100, 460);
  lv_obj_set_size(pill, 24, 24);
  lv_obj_update_layout(pill);
  CHECK(ui_input_hit(pill, 112, 472, UI_INPUT_HIT_MIN_PX), "center hits");
  CHECK(ui_input_hit(pill, 130, 472, UI_INPUT_HIT_MIN_PX),
        "6 px outside the visual edge still hits (inside the 44 px pad)");
  CHECK(!ui_input_hit(pill, 140, 472, UI_INPUT_HIT_MIN_PX),
        "beyond the 44 px pad misses");
  CHECK(!ui_input_hit(pill, 130, 472, 0), "unpadded near-miss misses");

  printf("scenario 8: ui_input_busy tracks the press (deferral gate)\n");
  reset_recorder();
  CHECK(!ui_input_busy(), "idle: not busy");
  step(20, 470, true);
  CHECK(ui_input_busy(), "mid-press: busy (renders must defer)");
  step(24, 472, true);
  CHECK(ui_input_busy(), "still busy while the finger wanders");
  step(24, 472, false);
  CHECK(!ui_input_busy(), "after release: not busy (deferred work applies)");
  ui_input_set_animating(true);
  CHECK(ui_input_busy(), "transition animation counts as busy (U7 hook)");
  ui_input_set_animating(false);
  CHECK(!ui_input_busy(), "animation over: not busy");

  if (g_failures) {
    printf("%d FAILURE(S)\n", g_failures);
    return 1;
  }
  printf("all input scenarios passed\n");
  return 0;
}
