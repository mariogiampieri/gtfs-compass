/*
 * main.c — the M1 vertical slice (plan U5).
 *
 * Boot: display + loading skeleton immediately, console + battery, then the
 * net task. The LVGL side owns all rendering: a 250 ms queue consumer copies
 * fresh models and full-renders (jitter applies); a 1 s tick updates the
 * chip in place and handles the state machine (LIVE → STALE at 90 s data
 * age with fetches succeeding; OFFLINE on fetch failures; NO_LOCATION on
 * 422). Countdowns decrement locally once per minute via a full render —
 * the device does no other time math (spec).
 */
#include <string.h>

#include "battery.h"
#include "bsp/esp-bsp.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "model.h"
#include "net_task.h"
#include "ui.h"
#include "wifi_creds.h"

extern void gc_console_start(void); /* console.c */

static const char *TAG = "gtfs-compass";

#define STALE_AFTER_S 90
#define FLASH_MS 1400
#define DIM_AFTER_NO_DATA_MS (10 * 60 * 1000)
#define DIM_PCT 40

static QueueHandle_t g_net_queue;
static model_nearby_t *g_ui_model; /* UI-owned copy (PSRAM) */
static bool g_have_model;
static ui_state_t g_state = {.conn = UI_CONN_LOADING, .battery_pct = -1};
static int64_t g_flash_until_ms;
static int64_t g_last_success_ms;
static int64_t g_last_minute_ms;
static bool g_dimmed;

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

static void full_render(void) { ui_board_show(g_have_model ? g_ui_model : NULL, &g_state); }

/* 250 ms: drain the net queue */
static void consume_cb(lv_timer_t *t) {
  (void)t;
  gc_net_msg_t msg;
  if (xQueueReceive(g_net_queue, &msg, 0) != pdTRUE) return;

  switch (msg.status) {
    case GC_NET_OK:
      memcpy(g_ui_model, msg.model, sizeof(*g_ui_model)); /* copy before net reuses */
      g_have_model = true;
      g_state.conn = UI_CONN_LIVE;
      g_state.secs_since_fetch = 0;
      g_state.flash_now = true;
      g_flash_until_ms = now_ms() + FLASH_MS;
      g_last_success_ms = now_ms();
      if (g_dimmed) {
        bsp_display_brightness_set(100);
        g_dimmed = false;
      }
      break;
    case GC_NET_NO_LOCATION:
      g_state.conn = UI_CONN_NO_LOCATION;
      break;
    case GC_NET_NO_CREDS:
      /* honest un-provisioned state; the R10 screen's copy fits ("no known
       * WiFi networks") and the console hint lives in the logs */
      g_state.conn = UI_CONN_NO_LOCATION;
      ESP_LOGW(TAG, "unprovisioned — wifi_set <ssid> <pass> on the console");
      break;
    default:
      /* keep rendering the last model, degraded */
      g_state.conn = g_have_model ? UI_CONN_OFFLINE : UI_CONN_LOADING;
      break;
  }
  g_state.battery_pct = (int8_t)gc_battery_pct();
  full_render();
}

/* 1 s: chip tick, state transitions, minute decrement */
static void tick_cb(lv_timer_t *t) {
  (void)t;
  if (g_state.conn == UI_CONN_LIVE || g_state.conn == UI_CONN_STALE ||
      g_state.conn == UI_CONN_OFFLINE) {
    g_state.secs_since_fetch++;
  }
  if (g_state.flash_now && now_ms() > g_flash_until_ms) g_state.flash_now = false;

  /* R6: fetches succeeding but data old → STALE (amber), distinct from OFFLINE */
  if (g_state.conn == UI_CONN_LIVE && g_state.secs_since_fetch > STALE_AFTER_S) {
    g_state.conn = UI_CONN_STALE;
    full_render();
    return;
  }

  /* local countdown decrement, once per minute, via a full render (jitter ok) */
  if (g_have_model && now_ms() - g_last_minute_ms >= 60000) {
    g_last_minute_ms = now_ms();
    for (int s = 0; s < g_ui_model->rail.stop_count; s++) {
      model_stop_t *stop = &g_ui_model->rail.stops[s];
      for (int tr = 0; tr < stop->trunk_count; tr++) {
        for (int d = 0; d < 2; d++) {
          model_direction_t *dir = &stop->trunks[tr].directions[d];
          for (int a = 0; a < dir->arrival_count; a++) {
            if (dir->arrivals[a].eta_min > 0) dir->arrivals[a].eta_min--;
          }
        }
      }
    }
    full_render();
    return;
  }

  /* M1 brightness placeholder: dim after long no-data (M3 owns real sleep) */
  if (!g_dimmed && g_last_success_ms && now_ms() - g_last_success_ms > DIM_AFTER_NO_DATA_MS) {
    bsp_display_brightness_set(DIM_PCT);
    g_dimmed = true;
  }

  ui_board_tick(&g_state);
}

void app_main(void) {
  ESP_LOGI(TAG, "gtfs-compass firmware — M1 vertical slice");
  int64_t t0 = now_ms();

  bsp_display_start();
  bsp_display_backlight_on();

  g_ui_model = heap_caps_calloc(1, sizeof(model_nearby_t), MALLOC_CAP_SPIRAM);
  assert(g_ui_model);

  bsp_display_lock(0);
  ui_init();
  full_render(); /* loading skeleton, instantly */
  bsp_display_unlock();
  ESP_LOGI(TAG, "skeleton on screen %lld ms after boot", now_ms() - t0);

  gc_battery_init();
  gc_console_start();
  gc_creds_seed_from_config();
  g_net_queue = gc_net_start();

  bsp_display_lock(0);
  lv_timer_create(consume_cb, 250, NULL);
  lv_timer_create(tick_cb, 1000, NULL);
  bsp_display_unlock();
}
