/*
 * console.c — USB-serial provisioning (the M1 stand-in for Phase 5 pairing).
 *
 *   wifi_set <ssid> <password>   store credentials in NVS (device restarts
 *                                the network path automatically)
 *   wifi_clear                   erase stored credentials
 *   gc_status                    one-line state dump
 *
 * Connect with: idf.py -p <port> monitor   (or any 115200 serial terminal)
 */
#include <stdio.h>
#include <string.h>

#include "esp_console.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
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
  bool ok = gc_creds_set(argv[1], argc == 3 ? argv[2] : "");
  if (!ok) {
    printf("NVS write failed\n");
    return 1;
  }
  /* Honest contract: the running network path holds boot-time credentials,
   * so a restart is the reliable way to apply new ones (review ADV-3). */
  printf("stored — restarting to join %s\n", argv[1]);
  fflush(stdout);
  vTaskDelay(pdMS_TO_TICKS(300)); /* let the message flush over USB */
  esp_restart();
  return 0;
}

static int cmd_wifi_clear(int argc, char **argv) {
  (void)argc;
  (void)argv;
  gc_creds_clear();
  printf("cleared\n");
  return 0;
}

static int cmd_status(int argc, char **argv) {
  (void)argc;
  (void)argv;
  char ssid[GC_SSID_LEN], pass[GC_PASS_LEN];
  bool have = gc_creds_get(ssid, pass);
  printf("creds: %s%s\n", have ? "stored for " : "none", have ? ssid : "");
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
      {.command = "wifi_clear", .help = "erase stored wifi credentials", .func = cmd_wifi_clear},
      {.command = "gc_status", .help = "show provisioning state", .func = cmd_status},
  };
  for (size_t i = 0; i < sizeof(cmds) / sizeof(cmds[0]); i++) {
    ESP_ERROR_CHECK(esp_console_cmd_register(&cmds[i]));
  }
  ESP_ERROR_CHECK(esp_console_start_repl(repl));
}
