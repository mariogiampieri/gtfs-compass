/*
 * main.c — device glue: display, touch, net consumption, render scheduling
 * (M1 vertical slice; reworked for the M2 U3 view dispatcher).
 *
 * Boot: display + loading skeleton immediately, console + battery, then the
 * net task. The LVGL side owns all rendering, through ONE render-request
 * path (R6 deferral contract):
 *
 *   - gc_request_render() renders immediately unless a press or transition
 *     animation is in progress (ui_input_busy()); while busy it latches a
 *     pending flag, drained by the 250 ms consumer after release.
 *   - Net messages are STAGED at receive and applied when not busy. The
 *     stash is by-value (latest-wins overwrite): msg.model points into the
 *     net task's alternating PSRAM double buffer, which the publisher
 *     reuses on the fetch after next (~60 s) — copying into a main-owned
 *     staged buffer within one 250 ms poll of publish is the ordering that
 *     can never read a reused buffer, and the deferral then holds no
 *     net-task pointers at all. Apply is a pointer swap (staged ↔ applied),
 *     so the applied model g_ui_model — and therefore the rendered tree and
 *     its tap targets — cannot change mid-press: press-time and
 *     release-time hit-testing see the same snapshot (KTD-2).
 *   - Deferred applies seed freshness as initial_age_s + defer time, so
 *     staleness is never under-reported (R6).
 *   - Navigation renders (tap/swipe results) bypass the deferral: they are
 *     the press's own intent — a swipe swallows the rest of its press and
 *     a tap resolves at release, so the rebuild races nothing.
 *
 * A 1 s tick updates the chip in place, ticks the per-system data ages
 * (KTD-7; STALE derives per system at 90 s), and decrements countdowns once
 * per minute — full render on the rail board, jitter nudge elsewhere (R7).
 * Failure paths change treatment, never the view (R6).
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
static QueueHandle_t g_pair_queue;
static model_nearby_t *g_ui_model;     /* applied model (owns the rendered tree) */
static model_nearby_t *g_staged_model; /* deferral stash (copy-at-receive) */
static bool g_have_model;
static ui_state_t g_state; /* ui_state_init() in app_main: LOADING, ages -1 */
static int64_t g_flash_until_ms;
static int64_t g_last_success_ms;
static int64_t g_last_minute_ms;
static int64_t g_last_touch_ms; /* 0 at boot: a never-touched device drifts */
static bool g_dimmed;

/* Staged net message (by value, latest-wins — R6 deferral contract). The
 * pairing snapshot rides on every message (full-snapshot queue contract),
 * so a displaced message loses nothing. */
static bool g_staged_have_model;    /* staged model copy awaits apply */
static gc_net_status_t g_staged_status;
static bool g_staged_have_status;   /* any message awaits apply */
static int64_t g_staged_recv_ms;    /* when the staged model was received */
static bool g_render_pending;       /* deferred render-only request */
static gc_pair_msg_t g_staged_pair; /* by value, latest-wins */
static bool g_staged_have_pair;

static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

static void full_render(void) {
  g_render_pending = false;
  /* R11 instrumentation: render+layout cost and LVGL-task stack headroom,
   * logged per full render — the numbers that decide R9 motion and catch
   * the M1 stack-overflow class before it panics. Flush happens async after
   * the timer callback returns, so this is build cost, not wire time. */
  int64_t t0 = esp_timer_get_time();
  ui_render(g_have_model ? g_ui_model : NULL, &g_state);
  ESP_LOGI(TAG, "render: view=%d sys=%d %lld ms, lvgl stack free %u B",
           g_state.view, g_state.sys, (esp_timer_get_time() - t0) / 1000,
           (unsigned)(uxTaskGetStackHighWaterMark(NULL) * sizeof(StackType_t)));
}

/* THE render-request path: every non-navigation full-render trigger (model
 * apply, minute decrement, stale transition, failure treatment) goes
 * through here so it can defer while a press/animation is in progress. */
static void gc_request_render(void) {
  if (ui_input_busy()) {
    g_render_pending = true;
    return;
  }
  full_render();
}

/* Apply the staged message: swap the model in, reconcile by identity with
 * the defer time folded into the age seed, then the status treatment. */
static void gc_apply_staged(void) {
  bool have_status = g_staged_have_status;
  gc_net_status_t status = g_staged_status;
  if (g_staged_have_model) {
    model_nearby_t *tmp = g_ui_model;
    g_ui_model = g_staged_model;
    g_staged_model = tmp;
    g_have_model = true;
    int32_t defer_s = (int32_t)((now_ms() - g_staged_recv_ms) / 1000);
    /* Staleness lives in the API response (spec): ages seed from the
     * server-computed initial_age_s, plus however long the apply was
     * deferred — never under-reported (R6). */
    ui_reconcile_deferred(&g_state, g_ui_model, defer_s);
    g_state.secs_since_fetch = defer_s > 0 ? (uint32_t)defer_s : 0;
    g_last_success_ms = now_ms();
    g_last_minute_ms = now_ms(); /* fresh etas: restart the decrement clock */
    if (g_dimmed) {
      bsp_display_brightness_set(100);
      g_dimmed = false;
    }
  }
  /* A pairing-only apply has no fetch outcome staged: the conn state (and
   * its staleness accounting) is left exactly as-is. */
  if (have_status) switch (status) {
    case GC_NET_OK:
      g_state.conn = UI_CONN_LIVE;
      /* chip evaluates per-system staleness before the flash, so a fetch
       * that lands already-old data never flashes green as live */
      g_state.flash_now = true;
      g_flash_until_ms = now_ms() + FLASH_MS;
      break;
    case GC_NET_NO_LOCATION:
    case GC_NET_NO_CREDS:
      /* honest un-provisioned/unlocatable state; with a prior model the
       * view degrades in place — failures never change the view (R6) */
      g_state.conn = UI_CONN_NO_LOCATION;
      break;
    default:
      /* Failure never regresses the screen: keep NO_LOCATION if that's the
       * last truth, otherwise go honestly OFFLINE (red chip over the last
       * model, or over the skeleton bones when nothing ever arrived). */
      if (g_state.conn != UI_CONN_NO_LOCATION) g_state.conn = UI_CONN_OFFLINE;
      break;
  }
  /* Pairing snapshot → UI state; an active session forces the pairing view
   * and completion/dismissal restores the prior one (ui_state.c rules). */
  if (g_staged_have_pair) {
    ui_pairing_update(&g_state, &(ui_pair_snapshot_t){
                                    .phase = g_staged_pair.phase,
                                    .code = g_staged_pair.code,
                                    .seconds = g_staged_pair.seconds_left,
                                    .epoch = g_staged_pair.epoch,
                                    .rate_limited = g_staged_pair.rate_limited,
                                    .unpaired = g_staged_pair.unpaired,
                                });
    g_staged_have_pair = false;
  }
  g_staged_have_model = false;
  g_staged_have_status = false;
  g_state.battery_pct = (int8_t)gc_battery_pct();
  full_render();
}

/* 250 ms: drain the net queue into the stash; apply when not busy. This
 * cadence is also what applies deferred work after a release. */
static void consume_cb(lv_timer_t *t) {
  (void)t;
  gc_net_msg_t msg;
  if (xQueueReceive(g_net_queue, &msg, 0) == pdTRUE) {
    if (msg.status == GC_NET_OK && msg.model != NULL) {
      memcpy(g_staged_model, msg.model, sizeof(*g_staged_model)); /* copy before net reuses */
      g_staged_have_model = true;
      g_staged_recv_ms = now_ms();
    }
    if (msg.status == GC_NET_NO_CREDS) {
      ESP_LOGW(TAG, "unprovisioned — wifi_set <ssid> <pass> on the console");
    }
    g_staged_status = msg.status; /* latest-wins; stash is by-value so the
                                     displaced message needs no freeing */
    g_staged_have_status = true;
  }
  /* Separate channel (review): a pairing snapshot can never displace a
   * fetch outcome, and vice versa. */
  gc_pair_msg_t pmsg;
  if (g_pair_queue != NULL && xQueueReceive(g_pair_queue, &pmsg, 0) == pdTRUE) {
    g_staged_pair = pmsg;
    g_staged_have_pair = true;
  }
  /* Deferral ceiling (review): a sustained accidental press — pocket, palm,
   * object resting on the glass — would otherwise defer applies and board
   * renders indefinitely (staleness accounting stays honest, but content
   * freezes). A press this long is not interaction; apply through it. */
  static int64_t busy_since_ms;
  if (ui_input_busy()) {
    if (busy_since_ms == 0) busy_since_ms = now_ms();
    if (now_ms() - busy_since_ms < 15000) return; /* defer: apply after release */
    ESP_LOGW(TAG, "deferral ceiling hit (15 s press) — applying through it");
  } else {
    busy_since_ms = 0;
  }
  if (g_staged_have_status || g_staged_have_pair) {
    gc_apply_staged();
  } else if (g_render_pending) {
    full_render();
  }
}

/* 1 s: chip tick, per-system ages, stale boundary, minute decrement */
static void tick_cb(lv_timer_t *t) {
  (void)t;
  if (g_state.conn == UI_CONN_LIVE || g_state.conn == UI_CONN_OFFLINE) {
    g_state.secs_since_fetch++;
  }
  /* Per-system data ages tick at 1 Hz (KTD-7); -1 = no data, never ages. */
  bool stale_crossed = false;
  for (int i = 0; i < UI_SYS_COUNT; i++) {
    if (g_state.age_s[i] >= 0) {
      g_state.age_s[i]++;
      if (i == g_state.sys && g_state.age_s[i] == STALE_AFTER_S + 1) stale_crossed = true;
    }
  }
  if (g_state.flash_now && now_ms() > g_flash_until_ms) g_state.flash_now = false;

  /* R6/KTD-7: the CURRENT system crossing the 90 s contract changes the
   * content treatment (amber chip, ~ countdowns, 60% + banner) → full
   * render, through the deferral path. Other systems' crossings render
   * when swiped to. */
  if (stale_crossed && g_state.conn == UI_CONN_LIVE) {
    gc_request_render();
    return;
  }

  /* local countdown decrement, once per minute; render is view-aware (R7) */
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
    if (g_state.view == UI_VIEW_BOARD && g_state.sys == UI_SYS_RAIL) {
      gc_request_render(); /* full render through the deferral gate */
      return;
    }
    if (g_state.view == UI_VIEW_DETAIL) {
      /* R7: countdown labels rewritten in place — no rebuild, scroll
       * preserved, so no press/animation gate is needed (U4) */
      ui_detail_minute_tick(g_ui_model, &g_state);
    }
    /* Burn-in drift, parked-device only (Mario: visible jitter was too
     * distracting): one ±1 px step per minute, and only after 5 min with
     * no touch — active use never moves. */
    if (!ui_input_busy() && now_ms() - g_last_touch_ms > 5 * 60 * 1000) {
      ui_jitter_nudge();
    }
  }

  /* Pairing countdown: local 1 Hz decrement from the published value (the
   * departures minutes convention) — ui_tick rewrites the label in place. */
  if (g_state.pair_phase == PAIR_CODE_ACTIVE && g_state.pair_seconds > 0) {
    g_state.pair_seconds--;
  }

  /* M1 brightness placeholder: dim after long no-data — boot time counts as
   * the baseline so a never-successful device still dims (M3 owns real sleep) */
  int64_t dim_base = g_last_success_ms ? g_last_success_ms : 1;
  if (!g_dimmed && now_ms() - dim_base > DIM_AFTER_NO_DATA_MS) {
    bsp_display_brightness_set(DIM_PCT);
    g_dimmed = true;
  }

  ui_tick(&g_state);
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
  /* Review: a transient I2C probe failure under ESP_ERROR_CHECK would
   * abort → reboot → fail again — a panic loop on an unproven path. Retry
   * once, then boot without touch: the M1 read-only board still works. */
  esp_err_t terr = bsp_touch_new(NULL, &tp);
  if (terr != ESP_OK) {
    ESP_LOGW(TAG, "touch probe failed (%s) — retrying once", esp_err_to_name(terr));
    vTaskDelay(pdMS_TO_TICKS(100));
    terr = bsp_touch_new(NULL, &tp);
  }
  if (terr != ESP_OK) {
    ESP_LOGE(TAG, "touch unavailable (%s) — booting read-only", esp_err_to_name(terr));
    return NULL;
  }
  lv_indev_t *indev = lvgl_port_add_touch(&(lvgl_port_touch_cfg_t){.disp = disp, .handle = tp});
  assert(indev);
  ESP_LOGI(TAG, "touch up: FT3168 enumerated, event-mode indev registered");
  return indev;
}

/*
 * U3 gesture routing: taps hit-test the current view, swipes drive the
 * carousel/stop cycling/pop-to-board — both through the shared ui_nav
 * transitions (the sim keys call the same functions). Navigation renders
 * happen immediately (see file header). Callbacks run in LVGL context.
 */
static void gc_input_press(int32_t x, int32_t y, void *user) {
  (void)user;
  g_last_touch_ms = now_ms(); /* holds the burn-in drift while in active use */
  ESP_LOGD(TAG, "input: press %ld,%ld", (long)x, (long)y);
}

/* Leaving a terminal EXPIRED/FAILED pairing screen also resets the net
 * task's FSM to IDLE (a live CODE_ACTIVE session is deliberately left
 * running — dismissing the view never cancels the session). */
static void pair_terminal_dismissed(ui_view_t view_before, pair_state_t phase_before) {
  if (view_before == UI_VIEW_PAIRING && g_state.view != UI_VIEW_PAIRING &&
      (phase_before == PAIR_EXPIRED || phase_before == PAIR_FAILED)) {
    gc_net_pair_dismiss();
  }
}

static void gc_input_tap(int32_t x, int32_t y, void *user) {
  (void)user;
  ui_view_t view_before = g_state.view;
  pair_state_t phase_before = g_state.pair_phase;
  if (ui_views_on_tap(x, y, g_have_model ? g_ui_model : NULL, &g_state)) {
    pair_terminal_dismissed(view_before, phase_before);
    full_render();
  }
}

static void gc_input_swipe(ui_swipe_t dir, void *user) {
  (void)user;
  ui_view_t view_before = g_state.view;
  pair_state_t phase_before = g_state.pair_phase;
  if (ui_views_on_swipe(dir, g_have_model ? g_ui_model : NULL, &g_state)) {
    pair_terminal_dismissed(view_before, phase_before);
    full_render();
  }
}

void app_main(void) {
  ESP_LOGI(TAG, "gtfs-compass firmware — M2 (touch + carousel)");
  int64_t t0 = now_ms();
  srand(esp_random()); /* burn-in jitter must differ across boots */
  ui_state_init(&g_state); /* LOADING, ages/battery unknown (-1) */

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
  if (touch) {
    bsp_display_lock(0);
    ui_input_attach(touch, &(ui_input_callbacks_t){.on_press = gc_input_press,
                                                   .on_tap = gc_input_tap,
                                                   .on_swipe = gc_input_swipe});
    bsp_display_unlock();
  }

  g_ui_model = heap_caps_calloc(1, sizeof(model_nearby_t), MALLOC_CAP_SPIRAM);
  g_staged_model = heap_caps_calloc(1, sizeof(model_nearby_t), MALLOC_CAP_SPIRAM);
  assert(g_ui_model && g_staged_model);

  bsp_display_lock(0);
  ui_init();
  full_render(); /* loading skeleton, instantly */
  bsp_display_unlock();
  ESP_LOGI(TAG, "skeleton on screen %lld ms after boot", now_ms() - t0);

  gc_battery_init();
  gc_console_start();
  gc_creds_seed_from_config();
  g_net_queue = gc_net_start();
  g_pair_queue = gc_net_pair_queue();

  bsp_display_lock(0);
  lv_timer_create(consume_cb, 250, NULL);
  lv_timer_create(tick_cb, 1000, NULL);
  bsp_display_unlock();
}
