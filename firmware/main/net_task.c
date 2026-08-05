/*
 * net_task.c — the device's network pipeline (plan U5; pairing plan U3/U4).
 *
 * Owns WiFi join, the per-poll BSSID scan, the HTTPS POST to /v1/nearby,
 * the parse, and the RFC 8628 pairing client (pair_fsm decides, this task
 * executes). Publishes full-snapshot messages through a length-1 overwrite
 * queue; it NEVER calls lv_* (the LVGL task consumes and copies). A slow
 * TLS handshake can therefore never stall rendering.
 *
 * The loop's wait is interruptible (task notification): console commands
 * wake it immediately, and the wait timeout is the sooner of the next fetch
 * deadline (30 s cadence) and the pairing FSM's next action (5 s polls
 * while a code is active). That coexistence is what makes pairing polls
 * interleave with normal fetches in one network task.
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
/* Pairing responses are tiny JSON objects; 2 KB is generous. */
#define PAIR_BODY_CAP 2048

static QueueHandle_t g_queue; /* item: gc_net_msg_t */
static EventGroupHandle_t g_wifi_events;
#define WIFI_CONNECTED_BIT BIT0

static model_nearby_t *g_buf[2]; /* PSRAM double buffer */
static int g_buf_idx;
static char *g_body; /* PSRAM response buffer */

static esp_timer_handle_t g_reconnect_timer;

/* Pairing + identity state — owned by the net task; the console only sets
 * command flags and wakes the task. The device_code lives inside g_pair and
 * never leaves this task; the access token is loaded from NVS at start and
 * never logged. */
static TaskHandle_t g_task;
static pair_fsm_t g_pair;
static char g_token[GC_TOKEN_LEN];
static bool g_revoked;
static volatile bool g_cmd_pair;
static volatile bool g_cmd_dismiss;
static volatile bool g_cmd_token_drop;
static uint8_t g_pair_epoch; /* bumped per console `pair`; rides on publishes */

static int64_t now_s(void) { return esp_timer_get_time() / 1000000; }
static int64_t now_ms(void) { return esp_timer_get_time() / 1000; }

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

/* Full-snapshot publish (net_task.h contract): every message carries the
 * pairing snapshot and the unpaired marker; `model` only rides on a fresh
 * successful fetch. */
static void publish(gc_net_status_t status, model_nearby_t *model) {
  gc_net_msg_t msg = {
      .status = status,
      .model = model,
      .pair_phase = g_pair.state,
      .pair_seconds_left = pair_fsm_seconds_left(&g_pair, now_s()),
      .pair_epoch = g_pair_epoch,
      .unpaired = g_revoked,
  };
  memcpy(msg.pair_code, g_pair.user_code, sizeof(msg.pair_code));
  xQueueOverwrite(g_queue, &msg);
}

/*
 * One pairing HTTP call. Returns the HTTP status, or -1 on transport
 * failure. `bearer` carries the device_code on polls (the code is a
 * credential; it never appears in a URL or a log). Responses land in a
 * small static buffer — this runs only from the net task.
 */
static int pair_http(const char *path, const char *bearer, const char *post_body, char *out,
                     int cap) {
  char url[256];
  snprintf(url, sizeof(url), "%s%s", CONFIG_GC_API_BASE_URL, path);
  body_sink_t sink = {.buf = out, .len = 0, .cap = cap};
  esp_http_client_config_t cfg = {
      .url = url,
      .method = HTTP_METHOD_POST,
      .timeout_ms = HTTP_TIMEOUT_MS,
      .crt_bundle_attach = esp_crt_bundle_attach,
      .event_handler = http_event_cb,
      .user_data = &sink,
  };
  esp_http_client_handle_t client = esp_http_client_init(&cfg);
  if (client == NULL) return -1;
  esp_http_client_set_header(client, "Content-Type", "application/json");
  if (bearer != NULL) {
    static char auth[PAIR_DEVICE_CODE_LEN + 8];
    snprintf(auth, sizeof(auth), "Bearer %s", bearer);
    esp_http_client_set_header(client, "Authorization", auth);
  }
  esp_http_client_set_post_field(client, post_body, (int)strlen(post_body));
  esp_err_t err = esp_http_client_perform(client);
  int status = esp_http_client_get_status_code(client);
  esp_http_client_cleanup(client);
  if (err != ESP_OK) return -1;
  out[sink.len < cap ? sink.len : cap - 1] = '\0';
  return status;
}

/* Execute whatever the pairing FSM wants until it goes quiet. Publishes a
 * snapshot on every phase transition (the UI ticks the countdown locally,
 * so steady-state polling publishes nothing). */
static void drive_pairing(void) {
  static char body[PAIR_BODY_CAP];
  pair_action_t act;
  while ((act = pair_fsm_take_action(&g_pair, now_s())) != PAIR_ACT_NONE) {
    pair_state_t before = g_pair.state;
    switch (act) {
      case PAIR_ACT_SEND_START: {
        int st = pair_http("/v1/device/pair/start", NULL,
                           "{\"device_name\":\"gtfs-compass\"}", body, sizeof(body));
        if (st < 0) pair_fsm_on_transport_error(&g_pair, now_s());
        else pair_fsm_on_start_response(&g_pair, st, body, strlen(body), now_s());
        break;
      }
      case PAIR_ACT_SEND_POLL: {
        int st = pair_http("/v1/device/pair/poll", g_pair.device_code, "", body, sizeof(body));
        if (st < 0) pair_fsm_on_transport_error(&g_pair, now_s());
        else pair_fsm_on_poll_response(&g_pair, st, body, strlen(body), now_s());
        break;
      }
      case PAIR_ACT_PERSIST_TOKEN: {
        if (gc_token_set(g_pair.token)) {
          strlcpy(g_token, g_pair.token, sizeof(g_token));
          g_revoked = false;
          ESP_LOGI(TAG, "paired — authenticated fetches from the next poll");
        } else {
          ESP_LOGE(TAG, "token NVS write failed — board stays anonymous");
        }
        break;
      }
      default:
        break;
    }
    if (g_pair.state != before || act == PAIR_ACT_PERSIST_TOKEN) {
      publish(GC_NET_KEEP, NULL);
    }
  }
}

/* One fetch cycle. Returns the net status for the UI state machine. */
static gc_net_status_t fetch_once(model_nearby_t *out) {
  static char post_body[2048];
  /* Location override: NVS (console loc_set) wins over the compile-time dev
   * seed. A stored token beats both (plan R9): pairing expresses intent to
   * use server-side resolution, so the override applies only unpaired. */
  char lat[GC_COORD_LEN] = CONFIG_GC_DEV_FIXED_LAT;
  char lon[GC_COORD_LEN] = CONFIG_GC_DEV_FIXED_LON;
  gc_loc_get(lat, lon);
  bool override_set = lat[0] != '\0' && lon[0] != '\0';
  bool have_token = g_token[0] != '\0';
  pair_request_plan_t plan = pair_request_plan(have_token, override_set);

  char url[256];
  int post_len = 0;
  if (plan == PAIR_PLAN_GET_FIXED) {
    snprintf(url, sizeof(url), "%s/v1/nearby?lat=%s&lon=%s&modes=rail,bus,bike",
             CONFIG_GC_API_BASE_URL, lat, lon);
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
      .method = plan == PAIR_PLAN_GET_FIXED ? HTTP_METHOD_GET : HTTP_METHOD_POST,
      .timeout_ms = HTTP_TIMEOUT_MS,
      .crt_bundle_attach = esp_crt_bundle_attach,
      .event_handler = http_event_cb,
      .user_data = &sink,
  };
  size_t heap_before = heap_caps_get_free_size(MALLOC_CAP_INTERNAL);
  esp_http_client_handle_t client = esp_http_client_init(&cfg);
  if (client == NULL) return GC_NET_OFFLINE;
  if (plan != PAIR_PLAN_GET_FIXED) {
    esp_http_client_set_header(client, "Content-Type", "application/json");
    esp_http_client_set_post_field(client, post_body, post_len);
  }
  if (plan == PAIR_PLAN_POST_AUTH) {
    /* Bearer header only — the server rejects tokens in URLs by design. */
    static char auth[GC_TOKEN_LEN + 8];
    snprintf(auth, sizeof(auth), "Bearer %s", g_token);
    esp_http_client_set_header(client, "Authorization", auth);
  }
  esp_err_t err = esp_http_client_perform(client);
  int status = esp_http_client_get_status_code(client);
  esp_http_client_cleanup(client);
  ESP_LOGI(TAG, "fetch: err=%d status=%d bytes=%d auth=%d heap_before=%u heap_after=%u", err,
           status, sink.len, plan == PAIR_PLAN_POST_AUTH, (unsigned)heap_before,
           (unsigned)heap_caps_get_free_size(MALLOC_CAP_INTERNAL));

  if (err != ESP_OK) return GC_NET_OFFLINE;
  if (status == 401 && plan == PAIR_PLAN_POST_AUTH) {
    /* Revoked (or never-real — the wire cannot say). Drop to anonymous
     * without a hard failure: erase the token, set the persistent marker,
     * and let the caller refetch immediately (plan R7). */
    gc_token_revoke();
    g_token[0] = '\0';
    g_revoked = true;
    return GC_NET_AUTH_REVOKED;
  }
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
  g_task = xTaskGetCurrentTaskHandle();
  if (gc_token_get(g_token)) {
    ESP_LOGI(TAG, "device token present — fetches will authenticate");
  } else {
    g_token[0] = '\0';
  }
  g_revoked = gc_revoked_get();
  pair_fsm_init(&g_pair);

  if (!wifi_start()) {
    publish(GC_NET_NO_CREDS, NULL);
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
    publish(GC_NET_OFFLINE, NULL);
    ESP_LOGW(TAG, "wifi join not established after 20s; still retrying");
  }
  int64_t boot_first_fetch = esp_timer_get_time();
  int64_t next_fetch_ms = 0; /* first fetch immediately */

  while (1) {
    /* Mid-run drop: report OFFLINE each poll rather than hanging on fetch. */
    if (!(xEventGroupGetBits(g_wifi_events) & WIFI_CONNECTED_BIT)) {
      publish(GC_NET_OFFLINE, NULL);
      ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5000));
      continue;
    }

    /* Console commands (flags set from other tasks; the notify woke us). */
    if (g_cmd_token_drop) {
      g_cmd_token_drop = false;
      g_token[0] = '\0';
      g_revoked = gc_revoked_get();
      publish(GC_NET_KEEP, NULL);
    }
    if (g_cmd_dismiss) {
      g_cmd_dismiss = false;
      pair_fsm_dismiss(&g_pair);
      publish(GC_NET_KEEP, NULL);
    }
    if (g_cmd_pair) {
      g_cmd_pair = false;
      /* start() is false for an active session: re-display, never re-mint.
       * The epoch bump is what undoes a UI-side dismissal either way. */
      pair_fsm_start(&g_pair, now_s());
      g_pair_epoch++;
      publish(GC_NET_KEEP, NULL);
    }

    drive_pairing();

    if (now_ms() >= next_fetch_ms) {
      model_nearby_t *buf = g_buf[g_buf_idx];
      gc_net_status_t st = fetch_once(buf);
      if (st == GC_NET_AUTH_REVOKED) {
        /* Token already cleared: one immediate anonymous retry keeps the
         * board seamless across a revocation (no token → no second 401). */
        st = fetch_once(buf);
      }
      if (st == GC_NET_OK) g_buf_idx ^= 1; /* hand off; write the other next */
      publish(st, st == GC_NET_OK ? buf : NULL);
      if (boot_first_fetch) {
        ESP_LOGI(TAG, "first fetch complete %lld ms after task start; stack HWM %u bytes free",
                 (esp_timer_get_time() - boot_first_fetch) / 1000,
                 (unsigned)uxTaskGetStackHighWaterMark(NULL));
        boot_first_fetch = 0;
      }
      next_fetch_ms = now_ms() + POLL_INTERVAL_MS;
    }

    /* Interruptible wait: the sooner of the fetch cadence and the pairing
     * FSM's next deadline; console commands notify to wake immediately. */
    int64_t wake_ms = next_fetch_ms;
    int64_t pair_deadline_s = pair_fsm_next_deadline(&g_pair);
    if (pair_deadline_s > 0 && pair_deadline_s * 1000 < wake_ms) {
      wake_ms = pair_deadline_s * 1000;
    }
    int64_t delay = wake_ms - now_ms();
    if (delay < 10) delay = 10;
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(delay));
  }
}

void gc_net_pair_request(void) {
  g_cmd_pair = true;
  if (g_task) xTaskNotifyGive(g_task);
}

void gc_net_pair_dismiss(void) {
  g_cmd_dismiss = true;
  if (g_task) xTaskNotifyGive(g_task);
}

void gc_net_token_dropped(void) {
  g_cmd_token_drop = true;
  if (g_task) xTaskNotifyGive(g_task);
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
