/* NVS-first WiFi credentials (plan KTD): the connect path reads ONLY NVS;
 * a dev build seeds NVS once from Kconfig; the serial console provisions
 * over USB. Phase 5 provisioning will replace the seeder, nothing else. */
#ifndef GC_WIFI_CREDS_H
#define GC_WIFI_CREDS_H

#include <stdbool.h>

#define GC_SSID_LEN 33
#define GC_PASS_LEN 65

/* Seed NVS from CONFIG_GC_WIFI_* if NVS is empty and the seed is non-empty. */
void gc_creds_seed_from_config(void);

/* Read credentials from NVS. Returns false when none are stored. */
bool gc_creds_get(char ssid[GC_SSID_LEN], char pass[GC_PASS_LEN]);

/* Store credentials (console provisioning). Returns false on NVS error. */
bool gc_creds_set(const char *ssid, const char *pass);

/* Erase stored credentials. */
void gc_creds_clear(void);

#define GC_COORD_LEN 16

/*
 * Dev location override (NVS "gc"/loc_lat+loc_lon, set via the console's
 * loc_set): when present, the device uses GET /v1/nearby?lat=&lon= and skips
 * WiFi scanning — the workaround for thin BeaconDB coverage. Compile-time
 * CONFIG_GC_DEV_FIXED_* seeds behave identically; NVS wins when both exist.
 */
bool gc_loc_get(char lat[GC_COORD_LEN], char lon[GC_COORD_LEN]);
bool gc_loc_set(const char *lat, const char *lon);
void gc_loc_clear(void);

#endif
