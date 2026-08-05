idf_component_register(
  SRCS "main.c" "net_task.c" "wifi_creds.c" "console.c" "battery.c"
  PRIV_REQUIRES model ui esp_wifi esp_http_client esp-tls nvs_flash console esp_app_format
                esp_event esp_netif esp_timer driver espressif__esp_lcd_touch
)
