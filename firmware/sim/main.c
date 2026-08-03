/*
 * Simulator entry: 410x502 SDL window running the real ui/ + model/ code.
 *
 *   ./sim [fixture.json]         (default: live-jay-st.json)
 *
 * Keys: 1 loading · 2 live · 3 stale · 4 offline · 5 no-location
 *       j/k next/prev stop · f toggle "now" flash · q quit
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "lvgl.h"
#include "model.h"
#include "ui.h"

static model_nearby_t g_model;
static ui_state_t g_state = {
    .conn = UI_CONN_LIVE, .secs_since_fetch = 12, .battery_pct = 82, .stop_idx = 0};

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

static void rerender(void) { ui_board_show(&g_model, &g_state); }

static void key_cb(lv_event_t *e) {
  uint32_t key = lv_event_get_key(e);
  switch (key) {
    case '1': g_state.conn = UI_CONN_LOADING; break;
    case '2': g_state.conn = UI_CONN_LIVE; g_state.secs_since_fetch = 12; break;
    case '3': g_state.conn = UI_CONN_STALE; g_state.secs_since_fetch = 130; break;
    case '4': g_state.conn = UI_CONN_OFFLINE; g_state.secs_since_fetch = 130; break;
    case '5': g_state.conn = UI_CONN_NO_LOCATION; break;
    case 'j':
      if (g_model.rail.stop_count)
        g_state.stop_idx = (uint8_t)((g_state.stop_idx + 1) % g_model.rail.stop_count);
      break;
    case 'k':
      if (g_model.rail.stop_count)
        g_state.stop_idx =
            (uint8_t)((g_state.stop_idx + g_model.rail.stop_count - 1) % g_model.rail.stop_count);
      break;
    case 'f': g_state.flash_now = !g_state.flash_now; break;
    case 'q': exit(0);
    default: return;
  }
  rerender();
}

static void tick_timer(lv_timer_t *t) {
  (void)t;
  if (g_state.conn == UI_CONN_LIVE || g_state.conn == UI_CONN_STALE ||
      g_state.conn == UI_CONN_OFFLINE) {
    g_state.secs_since_fetch++;
  }
  ui_board_tick(&g_state);
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

  lv_init();
  lv_display_t *disp = lv_sdl_window_create(410, 502);
  lv_sdl_window_set_title(disp, "gtfs-compass");
  lv_indev_t *kb = lv_sdl_keyboard_create();
  lv_group_t *grp = lv_group_create();
  lv_group_set_default(grp);
  lv_indev_set_group(kb, grp);

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
