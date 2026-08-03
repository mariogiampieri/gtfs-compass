/*
 * Canonical LVGL config shared by the device (ESP-IDF) and simulator (SDL)
 * builds — one file so rendering is identical. Target-specific switches key
 * off SIM_BUILD (defined by sim/CMakeLists.txt only).
 */
#ifndef LV_CONF_H
#define LV_CONF_H

#define LV_COLOR_DEPTH 16

#ifdef SIM_BUILD
#define LV_USE_SDL 1
#define LV_SDL_INCLUDE_PATH <SDL2/SDL.h>
#define LV_USE_SNAPSHOT 1 /* headless frame dumps (GC_DUMP=path ./sim ...) */
/* Simulator uses libc malloc so ASAN can see LVGL allocations. */
#define LV_USE_STDLIB_MALLOC LV_STDLIB_CLIB
#define LV_USE_STDLIB_STRING LV_STDLIB_CLIB
#define LV_USE_STDLIB_SPRINTF LV_STDLIB_CLIB
#else
/* Device: LVGL's builtin allocator over a pool esp_lvgl_port places. */
#define LV_MEM_SIZE (128 * 1024U)
#endif

#define LV_USE_OS LV_OS_NONE /* esp_lvgl_port provides locking on device */

#define LV_DPI_DEF 130

/*
 * Handoff type ramp (px): 14 15 16 17 18 20 24 25 27 30 36 (+40/84 in M2).
 * Built-in Montserrat ships even sizes; the M1 mapping is 15→14, 17→16,
 * 25→24, 27→26 — converted faces with tabular numerals are a deferred
 * polish pass (plan KTD).
 */
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_MONTSERRAT_16 1
#define LV_FONT_MONTSERRAT_18 1
#define LV_FONT_MONTSERRAT_20 1
#define LV_FONT_MONTSERRAT_24 1
#define LV_FONT_MONTSERRAT_26 1
#define LV_FONT_MONTSERRAT_28 1
#define LV_FONT_MONTSERRAT_30 1
#define LV_FONT_MONTSERRAT_36 1
#define LV_FONT_DEFAULT (&lv_font_montserrat_16)

#define LV_USE_LABEL 1
#define LV_USE_ANIMATION 1

#define LV_USE_LOG 0
#define LV_USE_ASSERT_NULL 1
#define LV_USE_ASSERT_MALLOC 1

#endif /* LV_CONF_H */
