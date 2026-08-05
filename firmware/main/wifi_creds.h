/* NVS-first WiFi credentials (plan KTD): the connect path reads ONLY NVS;
 * a dev build seeds NVS once from Kconfig; the serial console provisions
 * over USB.
 *
 * Multi-network store (plan gc-4ae): up to GC_MAX_NETS networks in indexed
 * slots (n0_ssid/n0_pass ...), joined best-visible-first via wifi_select.
 * The legacy single ssid/pass pair migrates into slot 0 on first boot and
 * the legacy keys are erased — already-provisioned boards keep working. */
#ifndef GC_WIFI_CREDS_H
#define GC_WIFI_CREDS_H

#include <stdbool.h>

#define GC_SSID_LEN 33
#define GC_PASS_LEN 65
#define GC_MAX_NETS 5

/* Legacy-pair migration + CONFIG_GC_WIFI_* dev seed (appends only when the
 * list is empty — NVS wins, never overwrites). Idempotent; call at boot. */
void gc_creds_seed_from_config(void);

/* Stored networks: count is derived from the first empty slot. */
int gc_nets_count(void);
/* pass may be NULL when only the SSID is wanted. */
bool gc_nets_get(int idx, char ssid[GC_SSID_LEN], char pass[GC_PASS_LEN]);
/* Upsert by SSID. False when the list is full or NVS fails. */
bool gc_nets_add(const char *ssid, const char *pass);
/* Remove by SSID, compacting slots. 1 = removed, 0 = not found, -1 = NVS
 * failure (the list may be partially rewritten; nothing is silently lost —
 * compaction stops at the first failed write). */
int gc_nets_del(const char *ssid);
/* Erase every stored network. */
void gc_nets_clear(void);

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

/*
 * Device token (pairing plan U3): "gtfsc_dev_" + 43-char base64url. Stored
 * verbatim in NVS ("gc"/token). Never logged or printed in full — console
 * surfaces report presence (the constant prefix at most), never the value.
 * The revoked marker ("gc"/revoked) survives reboots: it is what lets a
 * board render "unpaired after revocation" as a distinct fact from
 * never-paired, even though the wire cannot tell the two apart.
 */
#define GC_TOKEN_LEN 64

bool gc_token_get(char token[GC_TOKEN_LEN]);
/* Persist a fresh token. Also clears the revoked marker: a successful pair
 * ends the unpaired state (plan KTD/U2 persist semantics). */
bool gc_token_set(const char *token);
/* Voluntary local unpair (console token_clear): erase token AND marker. */
void gc_token_clear(void);
/* The 401 path: erase the token and set the revoked marker. */
void gc_token_revoke(void);
bool gc_revoked_get(void);

#endif
