/*
 * wifi_select.h — pure join-order selection for the multi-network WiFi
 * store (plan gc-4ae U1).
 *
 * Platform-free like everything under components/model: net_task supplies
 * the stored SSID list and a scan snapshot; this module answers "in what
 * order should the board try to join". Visible networks first, strongest
 * RSSI first; stored networks the scan did not see are appended in slot
 * order as blind fallbacks (a hidden-SSID network never scans but still
 * joins).
 */
#ifndef GTFS_COMPASS_WIFI_SELECT_H
#define GTFS_COMPASS_WIFI_SELECT_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define WIFI_SELECT_SSID_LEN 33 /* 32-byte SSID + NUL (matches GC_SSID_LEN) */
#define WIFI_SELECT_MAX_STORED 5
#define WIFI_SELECT_MAX_SCAN 20

typedef struct {
  char ssid[WIFI_SELECT_SSID_LEN];
  int8_t rssi;
} wifi_scan_entry_t;

/*
 * Fill order_out (capacity WIFI_SELECT_MAX_STORED) with indices into the
 * stored list, best-first. Returns the number of entries written (== the
 * clamped stored count). Duplicate scan SSIDs (mesh APs) collapse to the
 * strongest sighting.
 */
int wifi_select_order(const char stored[][WIFI_SELECT_SSID_LEN], int stored_count,
                      const wifi_scan_entry_t *scan, int scan_count,
                      uint8_t order_out[WIFI_SELECT_MAX_STORED]);

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_WIFI_SELECT_H */
