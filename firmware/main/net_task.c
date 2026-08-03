/*
 * net_task.c — the device's network pipeline (plan U5).
 *
 * Owns WiFi join, the per-poll BSSID scan, the HTTPS POST to /v1/nearby,
 * and the parse. Publishes a pointer to an alternating PSRAM model buffer
 * through a length-1 overwrite queue; it NEVER calls lv_* (the LVGL task
 * consumes and copies). A slow TLS handshake can therefore never stall
 * rendering. Poll cadence 30 s per the handoff.
 */
#include "net_task.h"

#include <string.h>

#include "esp_crt_bundle.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "model.h"
#include "sdkconfig.h"
#include "wifi_creds.h"

static const char *TAG = "gc-net";

#define POLL_INTERVAL_MS 30000
#define HTTP_TIMEOUT_MS 8000
#define MAX_SCAN_APS 20 /* API caps wifiAccessPoints at 50; 20 is plenty */
#define BODY_CAP (64 * 1024)

static QueueHandle_t g_queue; /* item: gc_net_msg_t */
static EventGroupHandle_t g_wifi_events;
#define WIFI_CONNECTED_BIT BIT0

static model_nearby_t *g_buf[2]; /* PSRAM double buffer */
static int g_buf_idx;
static char *g_body; /* PSRAM response buffer */

static esp_timer_handle_t g_reconnect_timer;

static void reconnect_cb(void *arg) {
  (void)arg;
  esp_wifi_connect();
}

static void wifi_event_handler(void *arg, esp_event_base_t base, int32_t id, void *data) {
  (void)arg;
  (void)data;
  if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
    esp_wifi_connect();
  } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
    xEventGroupClearBits(g_wifi_events, WIFI_CONNECTED_BIT);
    ESP_LOGW(TAG, "wifi disconnected; retry in 2s");
    /* Never block the shared event-loop task: defer via a one-shot timer. */
    esp_timer_stop(g_reconnect_timer);
    esp_timer_start_once(g_reconnect_timer, 2000 * 1000);
  } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
    xEventGroupSetBits(g_wifi_events, WIFI_CONNECTED_BIT);
    ESP_LOGI(TAG, "wifi connected");
  }
}

static bool wifi_start(void) {
  char ssid[GC_SSID_LEN], pass[GC_PASS_LEN];
  if (!gc_creds_get(ssid, pass)) {
    return false; /* no credentials: caller reports OFFLINE with console hint */
  }
  const esp_timer_create_args_t rt = {.callback = reconnect_cb, .name = "gc_reconnect"};
  ESP_ERROR_CHECK(esp_timer_create(&rt, &g_reconnect_timer));
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  esp_netif_create_default_wifi_sta();
  wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&cfg));
  esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event_handler, NULL, NULL);
  esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event_handler, NULL, NULL);

  wifi_config_t wc = {0};
  strlcpy((char *)wc.sta.ssid, ssid, sizeof(wc.sta.ssid));
  strlcpy((char *)wc.sta.password, pass, sizeof(wc.sta.password));
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wc));
  ESP_ERROR_CHECK(esp_wifi_start());
  return true;
}

/* Collect BSSIDs into a JSON body. Returns body length, 0 on scan failure. */
static int scan_to_json(char *out, size_t cap) {
  wifi_scan_config_t sc = {.show_hidden = true};
  int64_t t0 = esp_timer_get_time();
  if (esp_wifi_scan_start(&sc, true) != ESP_OK) return 0;
  uint16_t n = MAX_SCAN_APS;
  static wifi_ap_record_t recs[MAX_SCAN_APS];
  if (esp_wifi_scan_get_ap_records(&n, recs) != ESP_OK || n == 0) return 0;
  ESP_LOGI(TAG, "scan: %u APs in %lld ms", n, (esp_timer_get_time() - t0) / 1000);

  /* Bounds-first accumulation: check remaining space BEFORE each write and
   * clamp snprintf's would-be length so `off` can never exceed cap (review
   * ADV-8: the old post-write check underflowed cap-off after truncation). */
  size_t off = (size_t)snprintf(out, cap, "{\"wifiAccessPoints\":[");
  for (int i = 0; i < n; i++) {
    if (cap - off < 80) break; /* not enough room for one entry + closer */
    int wrote = snprintf(out + off, cap - off,
                         "%s{\"macAddress\":\"%02x:%02x:%02x:%02x:%02x:%02x\",\"signalStrength\":%d}",
                         i ? "," : "", recs[i].bssid[0], recs[i].bssid[1], recs[i].bssid[2],
                         recs[i].bssid[3], recs[i].bssid[4], recs[i].bssid[5], recs[i].rssi);
    if (wrote < 0 || (size_t)wrote >= cap - off) break; /* truncated: drop entry */
    off += (size_t)wrote;
  }
  off += (size_t)snprintf(out + off, cap - off, "]}");
  return (int)off;
}

typedef struct {
  char *buf;
  int len;
  int cap;
} body_sink_t;

static esp_err_t http_event_cb(esp_http_client_event_t *evt) {
  if (evt->event_id == HTTP_EVENT_ON_DATA) {
    body_sink_t *sink = (body_sink_t *)evt->user_data;
    int n = evt->data_len;
    if (sink->len + n > sink->cap - 1) n = sink->cap - 1 - sink->len; /* cap, fail closed */
    if (n > 0) {
      memcpy(sink->buf + sink->len, evt->data, n);
      sink->len += n;
    }
  }
  return ESP_OK;
}

/* One fetch cycle. Returns the net status for the UI state machine. */
static gc_net_status_t fetch_once(model_nearby_t *out) {
  static char post_body[2048];
  bool use_fixed = CONFIG_GC_DEV_FIXED_LAT[0] != '\0' && CONFIG_GC_DEV_FIXED_LON[0] != '\0';
  char url[256];
  int post_len = 0;
  if (use_fixed) {
    snprintf(url, sizeof(url), "%s/v1/nearby?lat=%s&lon=%s&modes=rail,bus,bike",
             CONFIG_GC_API_BASE_URL, CONFIG_GC_DEV_FIXED_LAT, CONFIG_GC_DEV_FIXED_LON);
  } else {
    snprintf(url, sizeof(url), "%s/v1/nearby", CONFIG_GC_API_BASE_URL);
    post_len = scan_to_json(post_body, sizeof(post_body));
    if (post_len == 0) {
      ESP_LOGW(TAG, "wifi scan produced no APs");
      return GC_NET_OFFLINE;
    }
  }

  body_sink_t sink = {.buf = g_body, .len = 0, .cap = BODY_CAP};
  esp_http_client_config_t cfg = {
      .url = url,
      .method = use_fixed ? HTTP_METHOD_GET : HTTP_METHOD_POST,
      .timeout_ms = HTTP_TIMEOUT_MS,
      .crt_bundle_attach = esp_crt_bundle_attach,
      .event_handler = http_event_cb,
      .user_data = &sink,
  };
  size_t heap_before = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
  esp_http_client_handle_t client = esp_http_client_init(&cfg);
  if (client == NULL) return GC_NET_OFFLINE;
  if (!use_fixed) {
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, post_body, post_len);
  }
  esp_err_t err = esp_http_client_perform(client);
  int status = esp_http_client_get_status_code(client);
  esp_http_client_cleanup(client);
  ESP_LOGI(TAG, "fetch: err=%d status=%d bytes=%d heap_before=%u heap_after=%u", err, status,
           sink.len, (unsigned)heap_before,
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));

  if (err != ESP_OK) return GC_NET_OFFLINE;
  if (status == 422) return GC_NET_NO_LOCATION;
  if (status != 200) return GC_NET_OFFLINE;
  if (sink.len >= BODY_CAP - 1) {
    /* distinct from network failure: the cap fired (fail-closed truncation) */
    ESP_LOGE(TAG, "response body hit the %d-byte cap; refusing truncated JSON", BODY_CAP);
    return GC_NET_OFFLINE;
  }
  g_body[sink.len] = '\0';
  if (model_parse_nearby(g_body, (size_t)sink.len, out) != MODEL_PARSE_OK) {
    ESP_LOGW(TAG, "parse failed");
    return GC_NET_OFFLINE;
  }
  return GC_NET_OK;
}

static void net_task(void *arg) {
  (void)arg;
  if (!wifi_start()) {
    gc_net_msg_t msg = {.status = GC_NET_NO_CREDS, .model = NULL};
    xQueueOverwrite(g_queue, &msg);
    ESP_LOGW(TAG, "no wifi credentials — provision via console: wifi_set <ssid> <pass>");
    /* The console restarts the device on wifi_set; this poll is only the
     * backstop for a seed landing through some other path. */
    char s[GC_SSID_LEN], p[GC_PASS_LEN];
    while (!gc_creds_get(s, p)) vTaskDelay(pdMS_TO_TICKS(2000));
    esp_restart(); /* simplest correct re-init path post-provisioning */
  }

  /* Bounded join wait: wrong password or absent AP must surface as OFFLINE
   * (red chip), not an eternal loading skeleton — the plan's own scenario. */
  while (!(xEventGroupWaitBits(g_wifi_events, WIFI_CONNECTED_BIT, pdFALSE, pdTRUE,
                               pdMS_TO_TICKS(20000)) &
           WIFI_CONNECTED_BIT)) {
    gc_net_msg_t offline = {.status = GC_NET_OFFLINE, .model = NULL};
    xQueueOverwrite(g_queue, &offline);
    ESP_LOGW(TAG, "wifi join not established after 20s; still retrying");
  }
  int64_t boot_first_fetch = esp_timer_get_time();

  while (1) {
    /* Mid-run drop: report OFFLINE each poll rather than hanging on fetch. */
    if (!(xEventGroupGetBits(g_wifi_events) & WIFI_CONNECTED_BIT)) {
      gc_net_msg_t offline = {.status = GC_NET_OFFLINE, .model = NULL};
      xQueueOverwrite(g_queue, &offline);
      vTaskDelay(pdMS_TO_TICKS(5000));
      continue;
    }
    model_nearby_t *buf = g_buf[g_buf_idx];
    gc_net_status_t st = fetch_once(buf);
    gc_net_msg_t msg = {.status = st, .model = st == GC_NET_OK ? buf : NULL};
    if (st == GC_NET_OK) g_buf_idx ^= 1; /* hand off; write the other next */
    xQueueOverwrite(g_queue, &msg);
    if (boot_first_fetch) {
      ESP_LOGI(TAG, "first fetch complete %lld ms after task start; stack HWM %u bytes free",
               (esp_timer_get_time() - boot_first_fetch) / 1000,
               (unsigned)uxTaskGetStackHighWaterMark(NULL));
      boot_first_fetch = 0;
    }
    vTaskDelay(pdMS_TO_TICKS(POLL_INTERVAL_MS));
  }
}

QueueHandle_t gc_net_start(void) {
  g_queue = xQueueCreate(1, sizeof(gc_net_msg_t));
  g_wifi_events = xEventGroupCreate();
  g_buf[0] = heap_caps_calloc(1, sizeof(model_nearby_t), MALLOC_CAP_SPIRAM);
  g_buf[1] = heap_caps_calloc(1, sizeof(model_nearby_t), MALLOC_CAP_SPIRAM);
  g_body = heap_caps_malloc(BODY_CAP, MALLOC_CAP_SPIRAM);
  assert(g_buf[0] && g_buf[1] && g_body);
  xTaskCreatePinnedToCore(net_task, "gc_net", 10240, NULL, 5, NULL, 0);
  return g_queue;
}
