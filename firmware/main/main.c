/*
 * main.c — the M1 vertical slice (plan U5).
 *
 * M2 U2 adds FT3168 touch (bsp_touch_new + lvgl_port_add_touch on the same
 * bypass-aware path) and wires the ui_input gesture tracker (log-only until
 * U3's view dispatcher consumes the callbacks).
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
#include "bsp/touch.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "model.h"
#include "net_task.h"
#include "nvs_flash.h"
#include "ui.h"
#include "ui_input.h"
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
 * Display bring-up WITHOUT bsp_display_start: the BSP registers this QSPI
 * panel through lvgl_port_add_disp_rgb, which types the display as RGB —
 * and for RGB-typed displays esp_lvgl_port calls lv_disp_flush_ready
 * immediately after QUEUING the async SPI DMA, so LVGL re-renders into the
 * buffer while DMA is still reading it. The stock config only survives
 * because its draw buffer lands in PSRAM (not DMA-capable), forcing
 * spi_master to bounce-copy the pixels synchronously before queuing — the
 * same per-flush copy that fails under WiFi/TLS heap pressure and caused
 * the original SPI error spam.
 *
 * So: init the panel via the BSP's public bsp_display_new (QSPI wiring,
 * vendor init commands, gap), then register it with lvgl_port_add_disp,
 * whose non-RGB path wires flush-ready to the SPI transfer-done callback.
 * That makes a DMA-capable internal draw buffer safe. 38 rows = 31,160 B
 * keeps each stripe under the S3's 32 KB single-DMA-transaction cap, and
 * even row counts keep stripe starts 2-aligned for the CO5300 (rounder
 * mirrored from the BSP).
 */
#define GC_DRAW_BUF_ROWS 38

static void gc_rounder_cb(lv_event_t *e) {
  lv_area_t *area = (lv_area_t *)lv_event_get_param(e);
  area->x1 &= ~1; /* start down to even */
  area->y1 &= ~1;
  area->x2 |= 1; /* end up to odd */
  area->y2 |= 1;
}

static lv_display_t *gc_display_start(void) {
  lvgl_port_cfg_t port_cfg = ESP_LVGL_PORT_INIT_CONFIG();
  /* The default 7168-byte LVGL task stack overflows during the first full
   * board render (deep flex layout over 8 trunks): TCB corruption, then
   * LoadProhibited in vTaskSwitchContext. Seen on hardware. */
  port_cfg.task_stack = 16384;
  ESP_ERROR_CHECK(lvgl_port_init(&port_cfg));

  const bsp_display_config_t bsp_cfg = {
      .max_transfer_sz = BSP_LCD_H_RES * GC_DRAW_BUF_ROWS * 2,
  };
  esp_lcd_panel_handle_t panel = NULL;
  esp_lcd_panel_io_handle_t io = NULL;
  ESP_ERROR_CHECK(bsp_display_new(&bsp_cfg, &panel, &io));
  ESP_ERROR_CHECK(bsp_display_brightness_init());

  const lvgl_port_display_cfg_t lv_cfg = {
      .io_handle = io,
      .panel_handle = panel,
      .buffer_size = BSP_LCD_H_RES * GC_DRAW_BUF_ROWS, /* pixels */
      .double_buffer = false,
      .hres = BSP_LCD_H_RES,
      .vres = BSP_LCD_V_RES,
      .monochrome = false,
      .color_format = LV_COLOR_FORMAT_RGB565,
      .rotation = {.swap_xy = false, .mirror_x = false, .mirror_y = false},
      .flags = {.buff_dma = true, .swap_bytes = true},
  };
  lv_display_t *disp = lvgl_port_add_disp(&lv_cfg);
  assert(disp);
  lv_display_add_event_cb(disp, gc_rounder_cb, LV_EVENT_INVALIDATE_AREA, NULL);
  return disp;
}

/*
 * FT3168 touch (plan U2, R1). Same bypass rule as the display: never through
 * bsp_display_start. bsp_touch_new + lvgl_port_add_touch is exactly what the
 * BSP's own indev init does, minus the bsp_display_start wrapper — I2C probe
 * at 0x38 via the FT5x06 driver, INT on GPIO 38 (event-mode indev), touch
 * reset on GPIO 9 (separate from LCD reset 8; the BSP comment claiming
 * shared is stale).
 */
static lv_indev_t *gc_touch_start(lv_display_t *disp) {
  esp_lcd_touch_handle_t tp = NULL;
  ESP_ERROR_CHECK(bsp_touch_new(NULL, &tp));
  lv_indev_t *indev = lvgl_port_add_touch(&(lvgl_port_touch_cfg_t){.disp = disp, .handle = tp});
  assert(indev);
  ESP_LOGI(TAG, "touch up: FT3168 enumerated, event-mode indev registered");
  return indev;
}

/*
 * U2 gesture callbacks: log-only until U3's view dispatcher consumes them.
 * on_press doubles as the raw-coordinate proof that touch works end-to-end.
 */
static void gc_input_press(int32_t x, int32_t y, void *user) {
  (void)user;
  ESP_LOGI(TAG, "input: press %ld,%ld", (long)x, (long)y);
}

static void gc_input_tap(int32_t x, int32_t y, void *user) {
  (void)user;
  ESP_LOGI(TAG, "input: tap %ld,%ld", (long)x, (long)y);
}

static void gc_input_swipe(ui_swipe_t dir, void *user) {
  (void)user;
  static const char *names[] = {"left", "right", "up", "down"};
  ESP_LOGI(TAG, "input: swipe %s", names[dir]);
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

  lv_display_t *disp = gc_display_start();
  bsp_display_backlight_on();
  lv_indev_t *touch = gc_touch_start(disp);
  bsp_display_lock(0);
  ui_input_attach(touch, &(ui_input_callbacks_t){.on_press = gc_input_press,
                                                 .on_tap = gc_input_tap,
                                                 .on_swipe = gc_input_swipe});
  bsp_display_unlock();

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
