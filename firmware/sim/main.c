/*
 * Simulator entry: 410x502 SDL window running the real ui/ + model/ code.
 *
 *   ./sim [fixture.json]         (default: live-jay-st.json)
 *
 * Keys (plan U3 — routed through the SAME ui_nav transitions the device's
 * gesture callbacks use, so the two input paths cannot drift):
 *   h/l   system prev/next (carousel, clamped)
 *   j/k   stop next/prev (rail board)
 *   Enter open detail for the first trunk · Esc/b back · d direction flip
 *   1-5   loading/live/stale/offline/no-location · f "now" flash · q quit
 *
 * Mouse (plan U2/U3): the SDL pointer drives the same LVGL indev machinery,
 * ui_input gesture tracker, and ui_views tap/swipe routing the device uses.
 *
 * Env:
 *   GC_DUMP=/path/frame.ppm   headless one-frame capture, then exit
 *   GC_VIEW=detail[:N] | bike | bus | nearby
 *       set the view/system before the GC_DUMP settle loop (R10: headless
 *       capture reaches every screen); also works windowed
 *
 * No render deferral here: the sim has no async model source — fixtures
 * apply synchronously, so the R6 deferral path lives in main/main.c only.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "lvgl.h"
#include "model.h"
#include "ui.h"
#include "ui_input.h"

static model_nearby_t g_model;
static ui_state_t g_state;

static char *read_fixture(const char *arg, size_t *len) {
  char path[512];
  if (arg && strchr(arg, '/')) snprintf(path, sizeof(path), "%s", arg);
  else snprintf(path, sizeof(path), "%s/%s", FIXTURE_DIR, arg ? arg : "live-jay-st.json");
  FILE *f = fopen(path, "rb");
  if (!f) {
    fprintf(stderr, "cannot open fixture %s\n", path);
    exit(1);
  }
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *buf = malloc((size_t)n + 1);
  if (fread(buf, (size_t)n, 1, f) != 1) exit(1);
  buf[n] = '\0';
  fclose(f);
  *len = (size_t)n;
  return buf;
}

static void rerender(void) { ui_render(&g_model, &g_state); }

static void key_cb(lv_event_t *e) {
  uint32_t key = lv_event_get_key(e);
  bool changed = true;
  switch (key) {
    case '1': g_state.conn = UI_CONN_LOADING; break;
    case '2':
      g_state.conn = UI_CONN_LIVE;
      g_state.age_s[g_state.sys] = 12;
      break;
    case '3': /* per-system staleness (KTD-7): age the CURRENT system */
      g_state.conn = UI_CONN_LIVE;
      g_state.age_s[g_state.sys] = 130;
      break;
    case '4': g_state.conn = UI_CONN_OFFLINE; g_state.secs_since_fetch = 130; break;
    case '5': g_state.conn = UI_CONN_NO_LOCATION; break;
    case 'f': g_state.flash_now = !g_state.flash_now; break;
    /* navigation: the same ui_nav transitions the gesture router calls */
    case 'h': changed = ui_nav_swipe(&g_state, &g_model, UI_NAV_RIGHT); break;
    case 'l': changed = ui_nav_swipe(&g_state, &g_model, UI_NAV_LEFT); break;
    case 'j': changed = ui_nav_swipe(&g_state, &g_model, UI_NAV_UP); break;
    case 'k': changed = ui_nav_swipe(&g_state, &g_model, UI_NAV_DOWN); break;
    case LV_KEY_ENTER: changed = ui_nav_open_detail(&g_state, &g_model, 0); break;
    case LV_KEY_ESC:
    case 'b': changed = ui_nav_back(&g_state); break;
    case 'd': changed = ui_nav_flip_dir(&g_state); break;
    case 'q': exit(0);
    default: return;
  }
  if (changed) rerender();
}

/* U3: mouse gestures route through the shared view/nav layer, exactly as
 * the device's tracker callbacks do in main/main.c. */
static void input_press(int32_t x, int32_t y, void *user) {
  (void)x;
  (void)y;
  (void)user;
}

static void input_tap(int32_t x, int32_t y, void *user) {
  (void)user;
  if (ui_views_on_tap(x, y, &g_model, &g_state)) rerender();
}

static void input_swipe(ui_swipe_t dir, void *user) {
  (void)user;
  if (ui_views_on_swipe(dir, &g_model, &g_state)) rerender();
}

static void tick_timer(lv_timer_t *t) {
  (void)t;
  if (g_state.conn == UI_CONN_LIVE || g_state.conn == UI_CONN_OFFLINE) {
    g_state.secs_since_fetch++;
  }
  for (int i = 0; i < UI_SYS_COUNT; i++) {
    if (g_state.age_s[i] >= 0) g_state.age_s[i]++;
  }
  ui_tick(&g_state);
}

/* GC_VIEW: place the state machine before first render/capture. */
static void apply_view_env(const char *view) {
  if (strncmp(view, "detail", 6) == 0) {
    uint8_t n = view[6] == ':' ? (uint8_t)atoi(view + 7) : 0;
    g_state.sys = UI_SYS_RAIL;
    if (!ui_nav_open_detail(&g_state, &g_model, n)) {
      fprintf(stderr, "GC_VIEW: no trunk %u to open\n", n);
    }
  } else if (strcmp(view, "bus") == 0) {
    g_state.sys = UI_SYS_BUS;
  } else if (strcmp(view, "bike") == 0) {
    g_state.sys = UI_SYS_BIKE;
  } else if (strcmp(view, "nearby") == 0) {
    g_state.sys = UI_SYS_BIKE;
    if (!ui_nav_open_nearby(&g_state, &g_model)) {
      fprintf(stderr, "GC_VIEW: no bike stations for nearby\n");
    }
  } else {
    fprintf(stderr, "GC_VIEW: unknown view '%s'\n", view);
  }
}

int main(int argc, char **argv) {
  size_t len;
  char *body = read_fixture(argc > 1 ? argv[1] : NULL, &len);
  model_parse_result_t rc = model_parse_nearby(body, len, &g_model);
  free(body);
  if (rc != MODEL_PARSE_OK) {
    fprintf(stderr, "fixture parse failed: %d\n", rc);
    return 1;
  }
  printf("fixture: %u rail stops, bike %s, units=%s\n", g_model.rail.stop_count,
         g_model.bike.present ? "present" : "absent", g_model.units);

  /* Adopt identities + seed per-system ages exactly as the device does on
   * its first apply (defer 0: the fixture applies synchronously). */
  ui_state_init(&g_state);
  ui_reconcile_deferred(&g_state, &g_model, 0);
  g_state.conn = UI_CONN_LIVE;
  g_state.battery_pct = 82;

  lv_init();
  lv_display_t *disp = lv_sdl_window_create(410, 502);
  lv_sdl_window_set_title(disp, "gtfs-compass");
  lv_indev_t *kb = lv_sdl_keyboard_create();
  lv_group_t *grp = lv_group_create();
  lv_group_set_default(grp);
  lv_indev_set_group(kb, grp);
  lv_indev_t *mouse = lv_sdl_mouse_create();
  ui_input_attach(mouse, &(ui_input_callbacks_t){.on_press = input_press,
                                                 .on_tap = input_tap,
                                                 .on_swipe = input_swipe});

  const char *view_env = getenv("GC_VIEW");
  if (view_env) apply_view_env(view_env);

  ui_init();
  rerender();

  /* key handling: an invisible focused object receives SDL keys */
  lv_obj_t *sink = lv_obj_create(lv_screen_active());
  lv_obj_set_size(sink, 1, 1);
  lv_obj_set_style_opa(sink, LV_OPA_TRANSP, 0);
  lv_group_add_obj(grp, sink);
  lv_obj_add_event_cb(sink, key_cb, LV_EVENT_KEY, NULL);
  lv_group_focus_obj(sink);

  lv_timer_create(tick_timer, 1000, NULL);

  /* Headless frame dump: GC_DUMP=/path/frame.ppm renders one frame, writes
   * it as binary PPM, and exits — used to eyeball a payload without a
   * window (debugging aid, not part of the product). */
  const char *dump = getenv("GC_DUMP");
  if (dump) {
    for (int i = 0; i < 30; i++) {
      lv_timer_handler();
      lv_delay_ms(5);
    }
    lv_draw_buf_t *snap = lv_snapshot_take(lv_screen_active(), LV_COLOR_FORMAT_XRGB8888);
    if (!snap) {
      fprintf(stderr, "snapshot failed\n");
      return 1;
    }
    FILE *out = fopen(dump, "wb");
    if (!out) {
      fprintf(stderr, "cannot open %s\n", dump);
      return 1;
    }
    fprintf(out, "P6\n%u %u\n255\n", snap->header.w, snap->header.h);
    for (uint32_t y = 0; y < snap->header.h; y++) {
      const uint8_t *row = snap->data + (size_t)y * snap->header.stride;
      for (uint32_t x = 0; x < snap->header.w; x++) {
        const uint8_t *px = row + x * 4; /* XRGB8888 little-endian: B G R X */
        fputc(px[2], out);
        fputc(px[1], out);
        fputc(px[0], out);
      }
    }
    fclose(out);
    printf("dumped %ux%u to %s\n", snap->header.w, snap->header.h, dump);
    return 0;
  }

  while (1) {
    lv_timer_handler();
    lv_delay_ms(5);
  }
  return 0;
}
