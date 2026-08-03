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
#include <stdlib.h>
#include <string.h>

#include "battery.h"
#include "bsp/esp-bsp.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "model.h"
#include "net_task.h"
#include "nvs_flash.h"
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
    case GC_NET_OK: {
      memcpy(g_ui_model, msg.model, sizeof(*g_ui_model)); /* copy before net reuses */
      g_have_model = true;
      /* Staleness lives in the API response (spec): seed the counter with
       * the server-computed data age so an upstream stall is honest from
       * the first render — never stale-as-live. */
      int32_t age = g_ui_model->rail.initial_age_s;
      g_state.secs_since_fetch = age > 0 ? (uint32_t)age : 0;
      g_state.conn = g_state.secs_since_fetch > STALE_AFTER_S ? UI_CONN_STALE : UI_CONN_LIVE;
      g_state.flash_now = g_state.conn == UI_CONN_LIVE;
      g_flash_until_ms = now_ms() + FLASH_MS;
      g_last_success_ms = now_ms();
      g_last_minute_ms = now_ms(); /* fresh etas: restart the decrement clock */
      if (g_dimmed) {
        bsp_display_brightness_set(100);
        g_dimmed = false;
      }
      break;
    }
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
      /* Failure never regresses the screen: keep NO_LOCATION if that's the
       * last truth, otherwise go honestly OFFLINE (red chip over the last
       * model, or over the skeleton bones when nothing ever arrived). */
      if (g_state.conn != UI_CONN_NO_LOCATION) g_state.conn = UI_CONN_OFFLINE;
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

  /* M1 brightness placeholder: dim after long no-data — boot time counts as
   * the baseline so a never-successful device still dims (M3 owns real sleep) */
  int64_t dim_base = g_last_success_ms ? g_last_success_ms : 1;
  if (!g_dimmed && now_ms() - dim_base > DIM_AFTER_NO_DATA_MS) {
    bsp_display_brightness_set(DIM_PCT);
    g_dimmed = true;
  }

  ui_board_tick(&g_state);
}

/*
 * The BSP allocates its LVGL draw buffer with plain malloc, which lands in
 * PSRAM under SPIRAM_USE_MALLOC — so every flush makes spi_master allocate
 * an internal DMA bounce buffer the size of the whole transaction, which
 * starts failing (dropped flushes, error spam) once WiFi+TLS fragment the
 * internal heap. Replace it with an internal DMA-capable buffer claimed at
 * boot, before the radio takes the heap. 50 rows ≈ 40 KB keeps the claim
 * modest; LVGL just flushes in more, smaller chunks.
 */
#define GC_DRAW_BUF_ROWS 50
static void gc_use_dma_draw_buffer(lv_display_t *disp) {
  size_t size = BSP_LCD_H_RES * GC_DRAW_BUF_ROWS * 2; /* RGB565 */
  void *buf = heap_caps_aligned_alloc(64, size, MALLOC_CAP_DMA);
  if (buf == NULL) {
    ESP_LOGW(TAG, "no internal DMA draw buffer — keeping BSP default");
    return;
  }
  bsp_display_lock(0);
  lv_display_set_buffers(disp, buf, NULL, size, LV_DISPLAY_RENDER_MODE_PARTIAL);
  bsp_display_unlock();
  ESP_LOGI(TAG, "draw buffer: %u B internal DMA (%d rows)", (unsigned)size, GC_DRAW_BUF_ROWS);
}

void app_main(void) {
  ESP_LOGI(TAG, "gtfs-compass firmware — M1 vertical slice");
  int64_t t0 = now_ms();
  srand(esp_random()); /* burn-in jitter must differ across boots */

  /* NVS underpins credentials AND esp_wifi's own storage — init first, with
   * the standard erase-and-retry for version/page migrations. */
  esp_err_t nvs_err = nvs_flash_init();
  if (nvs_err == ESP_ERR_NVS_NO_FREE_PAGES || nvs_err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
    ESP_ERROR_CHECK(nvs_flash_erase());
    nvs_err = nvs_flash_init();
  }
  ESP_ERROR_CHECK(nvs_err);

  /* The BSP's default LVGL task stack (7168) overflows during the first
   * full board render — deep flex layout over 8 trunks — corrupting the
   * TCB and panicking the scheduler (LoadProhibited in vTaskSwitchContext,
   * seen on first live fetch). The lvgl_port_cfg member is the one part of
   * this struct bsp_display_start_with_config actually honors; the buffer
   * fields below are ignored by the BSP (gc_use_dma_draw_buffer fixes the
   * buffer after init instead). */
  bsp_display_cfg_t disp_cfg = {
      .lvgl_port_cfg = ESP_LVGL_PORT_INIT_CONFIG(),
      .buffer_size = BSP_LCD_H_RES * CONFIG_BSP_DISPLAY_LVGL_BUF_HEIGHT,
      .double_buffer = 0,
      .flags = {.buff_dma = false, .buff_spiram = true},
  };
  disp_cfg.lvgl_port_cfg.task_stack = 16384;
  lv_display_t *disp = bsp_display_start_with_config(&disp_cfg);
  gc_use_dma_draw_buffer(disp);
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
