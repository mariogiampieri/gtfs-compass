/*
 * battery.c — minimal AXP2101 telemetry (reads only, no rail writes — the
 * schematic question from the plan's U1 flag stays open; PMU defaults have
 * proven sufficient through first light).
 *
 * AXP2101 @ I2C 0x34: reg 0xA4 = battery percentage (fuel gauge),
 * reg 0x01 bit 5 = charging. Uses the BSP's I2C bus.
 */
#include "battery.h"

#include "bsp/esp-bsp.h"
#include "driver/i2c_master.h"
#include "esp_log.h"

static const char *TAG = "gc-batt";
#define AXP2101_ADDR 0x34

static i2c_master_dev_handle_t g_dev;

void gc_battery_init(void) {
  bsp_i2c_init(); /* idempotent in esp-bsp convention */
  i2c_master_bus_handle_t bus = bsp_i2c_get_handle();
  if (bus == NULL) {
    ESP_LOGW(TAG, "no I2C bus handle; battery reads disabled");
    return;
  }
  i2c_device_config_t cfg = {
      .dev_addr_length = I2C_ADDR_BIT_LEN_7,
      .device_address = AXP2101_ADDR,
      .scl_speed_hz = 100000,
  };
  if (i2c_master_bus_add_device(bus, &cfg, &g_dev) != ESP_OK) {
    ESP_LOGW(TAG, "AXP2101 not reachable; battery reads disabled");
    g_dev = NULL;
  }
}

int gc_battery_pct(void) {
  if (g_dev == NULL) return -1;
  uint8_t reg = 0xA4, val = 0;
  if (i2c_master_transmit_receive(g_dev, &reg, 1, &val, 1, 100) != ESP_OK) return -1;
  return val <= 100 ? (int)val : -1;
}
