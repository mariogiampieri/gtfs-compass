---
title: "feat: Multi-network WiFi store and auto-join"
type: feat
status: active
date: 2026-08-04
---

# feat: Multi-network WiFi store and auto-join

## Summary

Replace the single NVS SSID/password pair with a small list (5 slots) plus scan-driven auto-join: at boot the board scans, intersects visible networks with the stored list, and joins the strongest; sustained join failure re-runs selection. Console grows add/remove/list; the selection logic is a pure host-tested module. Firmware-only (bead gc-4ae); no API change.

---

## Problem Frame

The board fetches its own data over its own WiFi (the relay solved location, not data). One stored credential means the board works at home OR on a hotspot, never both without re-provisioning over USB. Mario's Phase 5 scoping note asked for home/work/hotspot auto-join; it was never tracked into any unit.

---

## Requirements

- R1. Up to 5 networks stored in NVS (`gc` namespace, indexed keys). The legacy `ssid`/`pass` pair migrates into slot form on first boot and the legacy keys are erased — existing provisioned boards keep working with no console action.
- R2. `wifi_set <ssid> [pass]` upserts by SSID (existing name kept — muscle memory and README compat); `wifi_del <ssid>` removes; `wifi_list` prints SSIDs only (never passwords); `wifi_clear` erases all. `gc_status` reports the stored count and the joined SSID.
- R3. Boot join: scan once, order stored networks by visibility and RSSI (visible-strongest first, unseen stored networks appended as blind fallbacks), try each with a bounded join wait until one gets an IP. All networks unseen → try them all blind (hidden-SSID networks still join).
- R4. Mid-run disconnects keep the existing 2 s reconnect-same-network behavior; 60 s without an IP re-runs scan + selection (a board carried from home to a hotspot re-homes without reboot).
- R5. Selection is a pure platform-free function (stored list + scan results in, join order out) with host tests; the Kconfig dev seed appends to an empty list only (NVS wins, never overwrites).
- R6. README's provisioning section documents the multi-network commands in the same task.

---

## Key Technical Decisions

- **Indexed NVS keys (`n0_ssid`/`n0_pass` … `n4_ssid`/`n4_pass`), not a blob**: follows the existing per-key string idiom in `wifi_creds.c`; slots compact down on delete so count is derivable from the first empty slot.
- **Scan-then-select in net_task, not ESP-IDF's per-SSID sort**: the fetch path already scans for BeaconDB, the scan-first shape reuses that competence, and it lets selection be a pure testable function. The STA_START auto-connect moves out of the event handler — net_task drives connect explicitly after selection (the handler keeps only disconnect bookkeeping).
- **`wifi_set` stays `wifi_set`**: an upsert into the list. Renaming to `wifi_add` breaks README/muscle memory for zero clarity gain.
- **Selection module lives in `components/model`** next to `pair_fsm.c` (the established platform-free-logic home; host CMake compiles files individually).

---

## Implementation Units

### U1. Pure join-order selection

- **Goal:** `wifi_select`: stored SSIDs + scan (ssid, rssi) list → join order.
- **Files:** `firmware/components/model/wifi_select.c`, `firmware/components/model/include/wifi_select.h`, `firmware/components/model/CMakeLists.txt`, `firmware/test/host/test_wifi_select.c`, `firmware/test/host/CMakeLists.txt`
- **Approach:** Inputs are value structs (no heap); output is an index permutation of the stored list. Visible networks first, strongest RSSI first; unseen stored networks appended in slot order. Duplicate scan entries (mesh APs) collapse to the strongest.
- **Test scenarios:** strongest-visible wins over slot order; unseen networks append in slot order after visible ones; all-unseen yields slot order (blind/hidden-SSID fallback); duplicate scan SSIDs collapse to strongest; empty stored list yields empty order; 5 stored × 20 scan entries stays in bounds (ASan).
- **Verification:** host suite green.

### U2. Multi-network NVS store + legacy migration

- **Goal:** `gc_nets_*` API in `wifi_creds.c`; legacy pair migrates to slot 0.
- **Files:** `firmware/main/wifi_creds.c`, `firmware/main/wifi_creds.h`
- **Approach:** `gc_nets_count/get/add/del/clear`; add is upsert-by-SSID, false when full; delete compacts slots. `gc_nets_migrate_legacy()` runs from the seed path: legacy `ssid`/`pass` → slot insert, legacy keys erased, idempotent. Kconfig seed appends only when the list is empty. Commit results checked and logged honestly (this session's review convention). Passwords never printed.
- **Test scenarios:** `Test expectation: none — NVS glue is device-verified (established class); the list logic worth testing lives in U1.`
- **Verification:** device build; `wifi_list` on hardware shows migrated slot 0 (pending-Mario).

### U3. Console commands

- **Goal:** `wifi_set` upsert, `wifi_del`, `wifi_list`, updated `wifi_clear`/`gc_status`.
- **Files:** `firmware/main/console.c`
- **Approach:** same validation bounds as today (32/64 bytes); `wifi_set` restarts (existing honest-restart contract); `wifi_del`/`wifi_list` do not. `gc_status` shows `wifi: N stored` plus the currently joined SSID when connected.
- **Test scenarios:** `Test expectation: none — thin printf/dispatch glue over U2.`
- **Verification:** on-hardware console session (pending-Mario).

### U4. Scan-driven join in net_task

- **Goal:** boot joins the best visible stored network; sustained failure re-selects.
- **Files:** `firmware/main/net_task.c`
- **Approach:** `wifi_start` starts STA with no auto-connect on STA_START; a `join_best()` helper scans (reusing the scan call the fetch path uses), calls `wifi_select`, then per candidate: set_config → connect → wait CONNECTED bit (bounded, ~12 s each). The 20 s join loop in `net_task` becomes: `join_best()`; on failure publish OFFLINE and retry the loop. Mid-run: existing 2 s reconnect timer unchanged; the loop's offline branch counts 60 s without the CONNECTED bit and then re-runs `join_best()`. NO_CREDS when `gc_nets_count() == 0`.
- **Test scenarios:** `Test expectation: none beyond U1 — join orchestration is device-verified.`
- **Verification:** on hardware: board with home + hotspot stored joins whichever is present; killing the joined AP re-homes within ~1 min (pending-Mario).

### U5. Docs

- **Goal:** README provisioning section covers the network list.
- **Files:** `README.md`
- **Test scenarios:** `Test expectation: none — documentation.`
- **Verification:** commands as documented match the console.

---

## Scope Boundaries

Deferred: BLE data-mule (Phase 6-ish, removes the WiFi dependence entirely); per-network static config; WPA2-Enterprise; captive-portal handling (a joined-but-captive hotspot reads as OFFLINE honestly).

---

## Risks & Dependencies

- Restructuring the STA_START auto-connect touches the boot join path that M1 hardened — the NO_CREDS and wrong-password OFFLINE behaviors must survive (existing net_task scenarios re-verified on hardware).
- Scan-before-join adds ~1-2 s to boot-to-first-fetch; acceptable against the 30 s cadence.
- The 60 s re-select window is a first guess; tune on hardware (gc-g6f's power model may also want a say later).
