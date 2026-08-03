---
title: Waveshare AMOLED BSP flush-ready race — why DMA draw buffers garble the QSPI panel
date: 2026-08-03
category: hardware-issues
module: firmware
problem_type: bug
component: display
severity: high
symptoms:
  - "spi_master: setup_dma_priv_buffer Failed to allocate priv TX buffer / panel_io_spi_tx_color spi transmit (queue) color failed spam once WiFi+TLS are up"
  - "Screen renders smeared/overlapping bands or content slivers at wrong positions after switching the LVGL draw buffer to DMA-capable memory"
  - "LoadProhibited panic in vTaskSwitchContext ~6 s after boot on the first live-data render"
root_cause: "BSP registers the QSPI SH8601/CO5300 panel via lvgl_port_add_disp_rgb; RGB-typed displays get lv_disp_flush_ready at DMA queue time, not completion — safe only because the stock non-DMA PSRAM buffer forces a synchronous bounce copy"
resolution_type: workaround
applies_when:
  - "Using waveshare/esp32_s3_touch_amoled_2_06 (or a sibling QSPI-AMOLED BSP built on lvgl_port_add_disp_rgb) with esp_lvgl_port"
  - "Display artifacts or SPI DMA errors appear only under heap pressure (WiFi/TLS active) or only after making the draw buffer DMA-capable"
tags: [esp32-s3, lvgl, esp_lvgl_port, waveshare-bsp, qspi, sh8601, co5300, dma, display, flush-ready]
---

# Waveshare AMOLED BSP flush-ready race — why DMA draw buffers garble the QSPI panel

## Problem

Three intertwined display failures on the Waveshare ESP32-S3-Touch-AMOLED-2.06
during Phase 4 M1 bring-up, all traceable to how the BSP wires the panel into
esp_lvgl_port.

## Symptoms

1. **SPI error spam under network load** (stock BSP config):
   `spi_master: setup_dma_priv_buffer(1214): Failed to allocate priv TX buffer`
   + `panel_io_spi_tx_color(405): spi transmit (queue) color failed`, repeating;
   flushes dropped. Started exactly when WiFi + TLS consumed internal heap.
2. **Scheduler panic on first real render**: `LoadProhibited` inside
   `vTaskSwitchContext` (corrupted backtrace), ~6 s after boot once a live
   payload arrived — a crash-reboot loop tight enough to make `esptool` unable
   to connect (recovery: BOOT-button download mode + a background flash retry
   loop).
3. **Garbled rendering after the "obvious" fix**: swapping in a DMA-capable
   internal draw buffer via `lv_display_set_buffers` produced smeared,
   overlapping content bands — different garbage at different buffer sizes.

## What Didn't Work

- **`bsp_display_start_with_config` with `.flags.buff_dma = true`** — the BSP
  ignores the buffer fields of `bsp_display_cfg_t`; `bsp_display_lcd_init()`
  hardcodes its own flags. Only the `lvgl_port_cfg` member is honored.
- **Swapping the draw buffer post-init with `lv_display_set_buffers`** — the
  swap itself is mechanically fine (esp_lvgl_port uses the same API), but any
  DMA-capable buffer exposes the flush-ready race below. Corruption changed
  shape with buffer size (41 KB vs 31 KB stripes) but never disappeared.
- **Sizing stripes under the S3's 32 KB single-DMA-transaction cap** — the
  race is at queue time, so even single-transaction stripes garble.

## Root Cause

The BSP registers this **QSPI** panel through **`lvgl_port_add_disp_rgb`**, so
esp_lvgl_port types it `LVGL_PORT_DISP_TYPE_RGB`. In
`lvgl_port_flush_callback`, RGB-typed displays get `lv_disp_flush_ready`
called **immediately after `esp_lcd_panel_draw_bitmap` queues the async SPI
DMA transfer** (correct for true RGB framebuffer panels, wrong for SPI). LVGL
then renders the next stripe into the same single buffer while DMA is still
reading it.

The stock configuration survives this **by accident**: its draw buffer is
allocated with plain `malloc`, which lands in PSRAM under
`SPIRAM_USE_MALLOC`. PSRAM is not DMA-readable for this path, so `spi_master`
synchronously memcpy's the pixels into a private internal "bounce" buffer at
queue time — by the time the premature flush-ready fires, the pixels are
already copied out. That accidental protection is also symptom 1's cause: the
bounce buffer is allocated **per flush** at transaction size (~82 KB), which
fails once WiFi+TLS fragment the internal heap.

Symptom 2 is independent: esp_lvgl_port's default 7168-byte LVGL task stack
overflows during the first full board render (deep flex layout), corrupting
the TCB, which panics the scheduler. The SDL simulator can never catch this
class — desktop threads get megabyte stacks.

## Solution

Bypass `bsp_display_start` entirely; keep the BSP's panel init but register
the display through the correct path (`firmware/main/main.c`,
`gc_display_start()`):

1. `lvgl_port_init()` with `task_stack = 16384`.
2. `bsp_display_new()` — public BSP API; does the QSPI bus, vendor init
   command table, gap, panel on.
3. `bsp_display_brightness_init()` (bsp_display_start normally does this).
4. `lvgl_port_add_disp()` with `.flags.buff_dma = true`, `.swap_bytes = true`,
   single buffer of 38 rows (410 × 38 × 2 = 31,160 B — under the S3's 32 KB
   single-DMA-transaction cap, even row count for CO5300 2-px alignment).
   The non-RGB path registers `on_color_trans_done` so `lv_disp_flush_ready`
   fires on actual SPI completion — the race is gone and DMA buffers are safe.
5. Re-register the BSP's 2-px alignment rounder (it's static in the BSP, so
   mirror it: `x1 &= ~1; y1 &= ~1; x2 |= 1; y2 |= 1` on
   `LV_EVENT_INVALIDATE_AREA`).

Result: no per-flush allocation (buffer claimed once at boot, before the
radio takes the heap), no SPI errors under load, no render corruption,
~119 KB internal free at fetch time.

## Why This Works

Each fix removes one link: the DMA-capable internal buffer eliminates the
per-flush bounce allocation (symptom 1); the non-RGB registration makes
flush-ready truthful so the DMA buffer is safe (symptom 3); the 16 KB task
stack survives real layouts (symptom 2).

## Prevention

- When a BSP "just works," check **which** esp_lvgl_port path it uses before
  changing buffer capabilities. `add_disp_rgb`/`add_disp_dsi` have immediate
  flush-ready semantics; only `lvgl_port_add_disp` wires the SPI
  transfer-done callback.
- Treat "works with PSRAM buffer but breaks with DMA buffer" as a flush-ready
  race signature, not a DMA configuration error.
- Verify firsts on hardware, not the simulator: first live payload, first
  deep layout, first render under network load. The sim shares UI/model code
  but not stacks, heaps, or display transport.
- If a boot-crash loop blocks `esptool`, hold BOOT while plugging USB
  (download mode), with a retry loop running: the app never runs, so the
  handshake succeeds.
- Decode corrupted-backtrace panics with `xtensa-esp32s3-elf-addr2line`
  before theorizing: `vTaskSwitchContext`/`prvSelectHighestPriorityTaskSMP`
  frames mean TCB/list corruption — think "someone's stack overflowed," not
  "bug at the crash site."
