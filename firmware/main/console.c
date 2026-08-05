/*
 * console.c — USB-serial provisioning (the M1 stand-in for Phase 5 pairing).
 *
 *   wifi_set <ssid> <password>   add/update a network (up to 5 stored;
 *                                device restarts to apply)
 *   wifi_del <ssid>              remove one stored network
 *   wifi_list                    list stored SSIDs (never passwords)
 *   wifi_clear                   erase all stored networks
 *   pair                         start RFC 8628 pairing (code on screen);
 *                                re-issuing re-displays a live code
 *   token_clear                  erase the device token (local unpair)
 *   gc_status                    one-line state dump
 *
 * Connect with: idf.py -p <port> monitor   (or any 115200 serial terminal)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_console.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "net_task.h"
#include "wifi_creds.h"

static int cmd_wifi_set(int argc, char **argv) {
  if (argc < 2 || argc > 3) {
    printf("usage: wifi_set <ssid> [password]\n");
    return 1;
  }
  /* WiFi's own limits: SSID <=32 bytes, WPA passphrase <=64. Storing longer
   * values would silently break the fixed-buffer read path (review ADV-7). */
  if (strlen(argv[1]) > 32) {
    printf("error: ssid longer than 32 bytes\n");
    return 1;
  }
  if (argc == 3 && strlen(argv[2]) > 64) {
    printf("error: password longer than 64 bytes\n");
    return 1;
  }
  bool ok = gc_nets_add(argv[1], argc == 3 ? argv[2] : "");
  if (!ok) {
    printf("store failed (list full? wifi_list / wifi_del)\n");
    return 1;
  }
  /* Honest contract: the running network path holds boot-time credentials,
   * so a restart is the reliable way to apply new ones (review ADV-3). */
  printf("stored — restarting to join the best available network\n");
  fflush(stdout);
  vTaskDelay(pdMS_TO_TICKS(300)); /* let the message flush over USB */
  esp_restart();
  return 0;
}

static int cmd_wifi_clear(int argc, char **argv) {
  (void)argc;
  (void)argv;
  gc_nets_clear();
  printf("all networks cleared\n");
  return 0;
}

static int cmd_wifi_del(int argc, char **argv) {
  if (argc != 2) {
    printf("usage: wifi_del <ssid>\n");
    return 1;
  }
  bool ok = gc_nets_del(argv[1]);
  printf(ok ? "removed %s\n" : "no stored network named %s\n", argv[1]);
  return ok ? 0 : 1;
}

static int cmd_wifi_list(int argc, char **argv) {
  (void)argc;
  (void)argv;
  char ssid[GC_SSID_LEN];
  int n = 0;
  for (int i = 0; i < GC_MAX_NETS && gc_nets_get(i, ssid, NULL); i++, n++) {
    printf("  %d: %s\n", i, ssid);
  }
  if (n == 0) printf("no stored networks — wifi_set <ssid> [password]\n");
  return 0;
}

static int cmd_status(int argc, char **argv) {
  (void)argc;
  (void)argv;
  int nets = gc_nets_count();
  const char *joined = gc_net_joined_ssid();
  printf("wifi: %d network%s stored%s%s\n", nets, nets == 1 ? "" : "s",
         joined[0] ? ", joined " : "", joined);
  char lat[GC_COORD_LEN], lon[GC_COORD_LEN];
  bool override_set = gc_loc_get(lat, lon);
  char token[GC_TOKEN_LEN];
  bool paired = gc_token_get(token);
  /* Presence only — %.10s prints exactly the constant "gtfsc_dev_" prefix;
   * the token value never reaches the console (plan R4). */
  if (paired) printf("device token: stored (%.10s…)\n", token);
  else printf("device token: none%s\n", gc_revoked_get() ? " — previous token was revoked" : "");
  if (paired) {
    printf("location: server-side resolution (paired%s)\n",
           override_set ? "; loc_set override ignored while paired" : "");
  } else if (override_set) {
    printf("location override: %s, %s\n", lat, lon);
  } else {
    printf("location: from WiFi scan (BeaconDB)\n");
  }
  return 0;
}

static int cmd_pair(int argc, char **argv) {
  (void)argc;
  (void)argv;
  gc_net_pair_request();
  printf("pairing requested — the code appears on the board's screen\n"
         "approve it in the config UI (enter the code), then grant read:fix\n"
         "from the device list if this board should receive phone fixes\n");
  return 0;
}

static int cmd_token_clear(int argc, char **argv) {
  (void)argc;
  (void)argv;
  gc_token_clear();
  gc_net_token_dropped();
  printf("device token cleared — board is anonymous from the next poll\n");
  return 0;
}

static bool valid_coord(const char *s, double lo, double hi) {
  char *end;
  double v = strtod(s, &end);
  return end != s && *end == '\0' && v >= lo && v <= hi && strlen(s) < GC_COORD_LEN;
}

static int cmd_loc_set(int argc, char **argv) {
  if (argc != 3 || !valid_coord(argv[1], -90, 90) || !valid_coord(argv[2], -180, 180)) {
    printf("usage: loc_set <lat> <lon>   e.g. loc_set 40.692338 -73.987342\n");
    return 1;
  }
  bool ok = gc_loc_set(argv[1], argv[2]);
  printf(ok ? "stored — next poll uses the fixed location (<=30s)\n" : "NVS write failed\n");
  return ok ? 0 : 1;
}

static int cmd_loc_clear(int argc, char **argv) {
  (void)argc;
  (void)argv;
  gc_loc_clear();
  printf("cleared — next poll resolves via WiFi scan\n");
  return 0;
}

void gc_console_start(void) {
  esp_console_repl_t *repl = NULL;
  esp_console_repl_config_t repl_cfg = ESP_CONSOLE_REPL_CONFIG_DEFAULT();
  repl_cfg.prompt = "gc>";
  esp_console_dev_usb_serial_jtag_config_t hw_cfg =
      ESP_CONSOLE_DEV_USB_SERIAL_JTAG_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_console_new_repl_usb_serial_jtag(&hw_cfg, &repl_cfg, &repl));

  const esp_console_cmd_t cmds[] = {
      {.command = "wifi_set", .help = "wifi_set <ssid> [password]", .func = cmd_wifi_set},
      {.command = "wifi_del", .help = "wifi_del <ssid> — remove one stored network", .func = cmd_wifi_del},
      {.command = "wifi_list", .help = "list stored network SSIDs", .func = cmd_wifi_list},
      {.command = "wifi_clear", .help = "erase ALL stored networks", .func = cmd_wifi_clear},
      {.command = "loc_set", .help = "loc_set <lat> <lon> — fixed location (skips BeaconDB)", .func = cmd_loc_set},
      {.command = "loc_clear", .help = "back to WiFi-scan location", .func = cmd_loc_clear},
      {.command = "pair", .help = "start device pairing (RFC 8628 code on screen)", .func = cmd_pair},
      {.command = "token_clear", .help = "erase the device token (local unpair)", .func = cmd_token_clear},
      {.command = "gc_status", .help = "show provisioning state", .func = cmd_status},
  };
  for (size_t i = 0; i < sizeof(cmds) / sizeof(cmds[0]); i++) {
    ESP_ERROR_CHECK(esp_console_cmd_register(&cmds[i]));
  }
  ESP_ERROR_CHECK(esp_console_start_repl(repl));
}
