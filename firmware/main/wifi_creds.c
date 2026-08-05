#include "wifi_creds.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "nvs.h"
#include "sdkconfig.h"

static const char *TAG = "gc-creds";
#define NS "gc"

/* Slot keys: n0_ssid/n0_pass ... n4_ssid/n4_pass. Compacted on delete, so
 * the first empty slot ends the list. */
#define SLOT_KEY_LEN 10
static void slot_keys(int idx, char kssid[SLOT_KEY_LEN], char kpass[SLOT_KEY_LEN]) {
  snprintf(kssid, SLOT_KEY_LEN, "n%d_ssid", idx);
  snprintf(kpass, SLOT_KEY_LEN, "n%d_pass", idx);
}

bool gc_nets_get(int idx, char ssid[GC_SSID_LEN], char pass[GC_PASS_LEN]) {
  if (idx < 0 || idx >= GC_MAX_NETS) return false;
  char ks[SLOT_KEY_LEN], kp[SLOT_KEY_LEN];
  slot_keys(idx, ks, kp);
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return false;
  size_t slen = GC_SSID_LEN, plen = GC_PASS_LEN;
  bool ok = nvs_get_str(h, ks, ssid, &slen) == ESP_OK && ssid[0] != '\0';
  if (ok && pass != NULL && nvs_get_str(h, kp, pass, &plen) != ESP_OK) pass[0] = '\0';
  nvs_close(h);
  return ok;
}

int gc_nets_count(void) {
  char ssid[GC_SSID_LEN];
  for (int i = 0; i < GC_MAX_NETS; i++) {
    if (!gc_nets_get(i, ssid, NULL)) return i;
  }
  return GC_MAX_NETS;
}

bool gc_nets_add(const char *ssid, const char *pass) {
  if (ssid == NULL || ssid[0] == '\0') return false;
  char cur[GC_SSID_LEN];
  int slot = -1;
  for (int i = 0; i < GC_MAX_NETS; i++) {
    if (!gc_nets_get(i, cur, NULL)) {
      slot = i; /* first empty */
      break;
    }
    if (strcmp(cur, ssid) == 0) {
      slot = i; /* upsert: same SSID replaces its password */
      break;
    }
  }
  if (slot < 0) {
    ESP_LOGW(TAG, "network list full (%d) — wifi_del one first", GC_MAX_NETS);
    return false;
  }
  char ks[SLOT_KEY_LEN], kp[SLOT_KEY_LEN];
  slot_keys(slot, ks, kp);
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
  bool ok = nvs_set_str(h, ks, ssid) == ESP_OK &&
            nvs_set_str(h, kp, pass ? pass : "") == ESP_OK && nvs_commit(h) == ESP_OK;
  nvs_close(h);
  ESP_LOGI(TAG, "network %s (slot %d, ssid=%s)", ok ? "stored" : "store FAILED", slot, ssid);
  return ok;
}

bool gc_nets_del(const char *ssid) {
  if (ssid == NULL) return false;
  static char keep_ssid[GC_MAX_NETS][GC_SSID_LEN]; /* ~500 B — off the stack */
  static char keep_pass[GC_MAX_NETS][GC_PASS_LEN];
  int n = 0;
  bool found = false;
  for (int i = 0; i < GC_MAX_NETS; i++) {
    char sbuf[GC_SSID_LEN], pbuf[GC_PASS_LEN];
    if (!gc_nets_get(i, sbuf, pbuf)) break;
    if (strcmp(sbuf, ssid) == 0) {
      found = true;
      continue; /* drop it; later slots compact down */
    }
    strlcpy(keep_ssid[n], sbuf, GC_SSID_LEN);
    strlcpy(keep_pass[n], pbuf, GC_PASS_LEN);
    n++;
  }
  if (!found) return false;
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
  bool ok = true;
  for (int i = 0; i < GC_MAX_NETS; i++) {
    char ks[SLOT_KEY_LEN], kp[SLOT_KEY_LEN];
    slot_keys(i, ks, kp);
    if (i < n) {
      ok = nvs_set_str(h, ks, keep_ssid[i]) == ESP_OK &&
           nvs_set_str(h, kp, keep_pass[i]) == ESP_OK && ok;
    } else {
      nvs_erase_key(h, ks);
      nvs_erase_key(h, kp);
    }
  }
  ok = nvs_commit(h) == ESP_OK && ok;
  nvs_close(h);
  ESP_LOGI(TAG, "network %s (ssid=%s)", ok ? "removed" : "remove FAILED", ssid);
  return ok;
}

void gc_nets_clear(void) {
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return;
  for (int i = 0; i < GC_MAX_NETS; i++) {
    char ks[SLOT_KEY_LEN], kp[SLOT_KEY_LEN];
    slot_keys(i, ks, kp);
    nvs_erase_key(h, ks);
    nvs_erase_key(h, kp);
  }
  bool ok = nvs_commit(h) == ESP_OK;
  nvs_close(h);
  ESP_LOGI(TAG, "networks %s", ok ? "cleared" : "clear FAILED");
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

bool gc_token_get(char token[GC_TOKEN_LEN]) {
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return false;
  size_t len = GC_TOKEN_LEN;
  bool ok = nvs_get_str(h, "token", token, &len) == ESP_OK && token[0] != '\0';
  nvs_close(h);
  return ok;
}

bool gc_token_set(const char *token) {
  if (token == NULL || token[0] == '\0') return false;
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) return false;
  bool ok = nvs_set_str(h, "token", token) == ESP_OK;
  nvs_erase_key(h, "revoked"); /* a successful pair ends the unpaired state */
  ok = ok && nvs_commit(h) == ESP_OK;
  nvs_close(h);
  /* Presence only — the token value never reaches a log (plan R4). */
  ESP_LOGI(TAG, "device token %s", ok ? "stored" : "store FAILED");
  return ok;
}

void gc_token_clear(void) {
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) {
    ESP_LOGE(TAG, "token clear: NVS open failed");
    return;
  }
  /* erase_key returns NOT_FOUND for an absent key — that is a clear, not a
   * failure; only a failed commit means the erase may not have persisted. */
  nvs_erase_key(h, "token");
  nvs_erase_key(h, "revoked");
  bool ok = nvs_commit(h) == ESP_OK;
  nvs_close(h);
  ESP_LOGI(TAG, "device token %s", ok ? "cleared" : "clear FAILED (may reload on reboot)");
}

void gc_token_revoke(void) {
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) != ESP_OK) {
    ESP_LOGE(TAG, "token revoke: NVS open failed — revocation is RAM-only until reboot");
    return;
  }
  nvs_erase_key(h, "token");
  bool ok = nvs_set_u8(h, "revoked", 1) == ESP_OK;
  ok = nvs_commit(h) == ESP_OK && ok;
  nvs_close(h);
  if (ok) {
    ESP_LOGW(TAG, "device token revoked by the server — board is unpaired");
  } else {
    /* Honest failure (review): a stale token surviving in NVS means one
     * extra 401-and-revoke on the next boot, not silent success. */
    ESP_LOGE(TAG, "token revoke: NVS write failed — a stale token may retry once after reboot");
  }
}

bool gc_revoked_get(void) {
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READONLY, &h) != ESP_OK) return false;
  uint8_t v = 0;
  bool set = nvs_get_u8(h, "revoked", &v) == ESP_OK && v != 0;
  nvs_close(h);
  return set;
}

void gc_creds_seed_from_config(void) {
  /* Legacy migration first: a board provisioned before the multi-network
   * store carries the old ssid/pass pair — fold it into a slot once and
   * erase the legacy keys (idempotent: they no longer exist afterwards). */
  nvs_handle_t h;
  if (nvs_open(NS, NVS_READWRITE, &h) == ESP_OK) {
    char ssid[GC_SSID_LEN], pass[GC_PASS_LEN];
    size_t slen = GC_SSID_LEN, plen = GC_PASS_LEN;
    bool have_legacy = nvs_get_str(h, "ssid", ssid, &slen) == ESP_OK && ssid[0] != '\0';
    if (have_legacy && nvs_get_str(h, "pass", pass, &plen) != ESP_OK) pass[0] = '\0';
    nvs_close(h); /* gc_nets_add opens its own handle */
    if (have_legacy && gc_nets_add(ssid, pass)) {
      if (nvs_open(NS, NVS_READWRITE, &h) == ESP_OK) {
        nvs_erase_key(h, "ssid");
        nvs_erase_key(h, "pass");
        nvs_commit(h);
        nvs_close(h);
      }
      ESP_LOGI(TAG, "migrated legacy credentials into the network list");
    }
  }

  if (gc_nets_count() > 0) return; /* NVS wins; never overwrite */
  if (CONFIG_GC_WIFI_SSID[0] == '\0') {
    ESP_LOGW(TAG, "no stored networks and no dev seed — use the console: wifi_set <ssid> <pass>");
    return;
  }
  gc_nets_add(CONFIG_GC_WIFI_SSID, CONFIG_GC_WIFI_PASSWORD);
  ESP_LOGI(TAG, "seeded network list from dev config");
}
