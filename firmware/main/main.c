/*
 * U1 first light: BSP display bring-up + a styled hello label.
 * U5 replaces this with the full vertical slice (wifi -> nearby -> board).
 */
#include "bsp/esp-bsp.h"
#include "esp_log.h"
#include "lvgl.h"

static const char *TAG = "gtfs-compass";

void app_main(void) {
  ESP_LOGI(TAG, "gtfs-compass firmware — U1 first light");

  bsp_display_start();
  bsp_display_backlight_on(); /* brightness = panel 0x51 under the hood */

  bsp_display_lock(0);
  lv_obj_t *scr = lv_screen_active();
  lv_obj_set_style_bg_color(scr, lv_color_hex(0x000000), 0);
  lv_obj_set_style_bg_opa(scr, LV_OPA_COVER, 0);
  lv_obj_t *label = lv_label_create(scr);
  lv_label_set_text(label, "gtfs-compass");
  lv_obj_set_style_text_color(label, lv_color_hex(0x30D158), 0);
  lv_obj_set_style_text_font(label, &lv_font_montserrat_30, 0);
  lv_obj_center(label);
  bsp_display_unlock();

  ESP_LOGI(TAG, "display up");
}
