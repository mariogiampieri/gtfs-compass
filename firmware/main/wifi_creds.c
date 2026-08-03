#include "wifi_creds.h"

#include <string.h>

#include "esp_log.h"
#include "nvs.h"
#include "sdkconfig.h"

static const char *TAG = "gc-creds";
#define NS "gc"

bool gc_creds_get(char ssid[GC_SSID_LEN], char pass[GC_PASS_LEN]) {
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return false;
  size_t slen = GC_SSID_LEN, plen = GC_PASS_LEN;
  bool ok = nvs_get_str(h, "ssid", ssid, &slen) == ESP_OK &&
            nvs_get_str(h, "pass", pass, &plen) == ESP_OK && ssid[0] != '\0';
  nvs_close(h);
  return ok;
}

bool gc_creds_set(const char *ssid, const char *pass) {
  if (ssid == NULL || ssid[0] == '\0') return false;
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
  bool ok = nvs_set_str(h, "ssid", ssid) == ESP_OK &&
            nvs_set_str(h, "pass", pass ? pass : "") == ESP_OK && nvs_commit(h) == ESP_OK;
  nvs_close(h);
  ESP_LOGI(TAG, "credentials %s (ssid=%s)", ok ? "stored" : "store FAILED", ssid);
  return ok;
}

void gc_creds_clear(void) {
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
  nvs_erase_key(h, "ssid");
  nvs_erase_key(h, "pass");
  nvs_commit(h);
  nvs_close(h);
  ESP_LOGI(TAG, "credentials cleared");
}

bool gc_loc_get(char lat[GC_COORD_LEN], char lon[GC_COORD_LEN]) {
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return false;
  size_t la = GC_COORD_LEN, lo = GC_COORD_LEN;
  bool ok = nvs_get_str(h, "loc_lat", lat, &la) == ESP_OK &&
            nvs_get_str(h, "loc_lon", lon, &lo) == ESP_OK && lat[0] != '\0';
  nvs_close(h);
  return ok;
}

bool gc_loc_set(const char *lat, const char *lon) {
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
  bool ok = nvs_set_str(h, "loc_lat", lat) == ESP_OK &&
            nvs_set_str(h, "loc_lon", lon) == ESP_OK && nvs_commit(h) == ESP_OK;
  nvs_close(h);
  ESP_LOGI(TAG, "location override %s (%s, %s)", ok ? "stored" : "store FAILED", lat, lon);
  return ok;
}

void gc_loc_clear(void) {
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
  nvs_erase_key(h, "loc_lat");
  nvs_erase_key(h, "loc_lon");
  nvs_commit(h);
  nvs_close(h);
  ESP_LOGI(TAG, "location override cleared");
}

void gc_creds_seed_from_config(void) {
  char ssid[GC_SSID_LEN], pass[GC_PASS_LEN];
  if (gc_creds_get(ssid, pass)) return; /* NVS wins; never overwrite */
  if (CONFIG_GC_WIFI_SSID[0] == '\0') {
    ESP_LOGW(TAG, "no stored credentials and no dev seed — use the console: wifi_set <ssid> <pass>");
    return;
  }
  gc_creds_set(CONFIG_GC_WIFI_SSID, CONFIG_GC_WIFI_PASSWORD);
  ESP_LOGI(TAG, "seeded NVS from dev config");
}
