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
 * Fonts: converted IBM Plex Sans faces at the handoff's true ramp
 * (components/ui/fonts/, plan U6) — no built-in Montserrat sizes are
 * referenced anywhere. Montserrat 14 stays enabled only as LVGL's theme
 * default font (every UI label sets a TK_FONT_* face explicitly); this
 * mirrors the device build, where the Kconfig defaults do the same.
 */
#define LV_FONT_MONTSERRAT_14 1
#define LV_FONT_DEFAULT (&lv_font_montserrat_14)

#define LV_USE_LABEL 1
#define LV_USE_ANIMATION 1

#define LV_USE_LOG 0
#define LV_USE_ASSERT_NULL 1
#define LV_USE_ASSERT_MALLOC 1

#endif /* LV_CONF_H */
