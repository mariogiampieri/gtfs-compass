/* wifi_select.c — see wifi_select.h (plan gc-4ae U1). Pure, no heap. */
#include "wifi_select.h"

#include <string.h>

/* Best RSSI the scan saw for this SSID, or INT8_MIN when unseen. */
#define UNSEEN (-128)

int wifi_select_order(const char stored[][WIFI_SELECT_SSID_LEN], int stored_count,
                      const wifi_scan_entry_t *scan, int scan_count,
                      uint8_t order_out[WIFI_SELECT_MAX_STORED]) {
  if (stored_count < 0) stored_count = 0;
  if (stored_count > WIFI_SELECT_MAX_STORED) stored_count = WIFI_SELECT_MAX_STORED;
  if (scan_count < 0) scan_count = 0;

  int best[WIFI_SELECT_MAX_STORED];
  for (int i = 0; i < stored_count; i++) {
    best[i] = UNSEEN;
    for (int j = 0; j < scan_count; j++) {
      if (strncmp(stored[i], scan[j].ssid, WIFI_SELECT_SSID_LEN) == 0 &&
          scan[j].rssi > best[i]) {
        best[i] = scan[j].rssi; /* duplicates collapse to the strongest */
      }
    }
    order_out[i] = (uint8_t)i;
  }

  /* Insertion sort, n <= 5: visible before unseen; among visible, stronger
   * first; ties and unseen keep slot order (stable). */
  for (int i = 1; i < stored_count; i++) {
    uint8_t key = order_out[i];
    int k = best[key];
    int j = i - 1;
    while (j >= 0 && best[order_out[j]] < k) {
      order_out[j + 1] = order_out[j];
      j--;
    }
    order_out[j + 1] = key;
  }
  return stored_count;
}
