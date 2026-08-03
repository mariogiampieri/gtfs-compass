/*
 * gc_fonts.h — the converted IBM Plex Sans faces (see fonts/README.md).
 *
 * Sizes are the design handoff's true type ramp; weights per size:
 *   400 Regular:  14 17 18
 *   600 SemiBold: 15 16 20   (these three also carry ⇅ U+21C5 from DejaVu)
 *   700 Bold:     24 25 27 30 36 40 84 (84 = digits/:/-/— subset only)
 * Regenerate via firmware/tools/genfonts.sh.
 */
#ifndef GTFS_COMPASS_GC_FONTS_H
#define GTFS_COMPASS_GC_FONTS_H

#include "lvgl.h"

#ifdef __cplusplus
extern "C" {
#endif

LV_FONT_DECLARE(gc_plex_14);
LV_FONT_DECLARE(gc_plex_15);
LV_FONT_DECLARE(gc_plex_16);
LV_FONT_DECLARE(gc_plex_17);
LV_FONT_DECLARE(gc_plex_18);
LV_FONT_DECLARE(gc_plex_20);
LV_FONT_DECLARE(gc_plex_24);
LV_FONT_DECLARE(gc_plex_25);
LV_FONT_DECLARE(gc_plex_27);
LV_FONT_DECLARE(gc_plex_30);
LV_FONT_DECLARE(gc_plex_36);
LV_FONT_DECLARE(gc_plex_40);
LV_FONT_DECLARE(gc_plex_84);

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_GC_FONTS_H */
