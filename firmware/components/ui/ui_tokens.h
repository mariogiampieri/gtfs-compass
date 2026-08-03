/* Design tokens from docs/design/transit-watch-handoff.md — literal device
 * pixels at 410x502. Names mirror the handoff's vocabulary. */
#ifndef GTFS_COMPASS_UI_TOKENS_H
#define GTFS_COMPASS_UI_TOKENS_H

#include "gc_fonts.h"

#define TK_SCREEN_W 410
#define TK_SCREEN_H 502
#define TK_SIDE_INSET 34
#define TK_ROW_HPAD 32

/* Colors */
#define TK_BG 0x000000
#define TK_HAIRLINE 0x1C1C1F
#define TK_PILL_BG 0x1C1C1F
#define TK_PILL_BORDER 0x2E2E33
#define TK_TEXT_PRIMARY 0xFFFFFF
#define TK_TEXT_BODY 0xE8E8EC
#define TK_TEXT_SECONDARY 0x9A9AA0
#define TK_TEXT_MUTED 0x8E8E93
#define TK_TEXT_FAINT 0x5A5A60
#define TK_TEXT_BATTERY 0x7D7D84
#define TK_LIVE 0x30D158
#define TK_ALERT 0xF5A623
#define TK_OFFLINE 0xFF453A
#define TK_DOT_INACTIVE 0x333333
#define TK_SKELETON_BASE 0x1A1A1C
#define TK_SKELETON_HI 0x26262A
#define TK_EMPTY_RING 0x3A3A3E
#define TK_EMPTY_TITLE 0xC9C9CF

/* Fonts — IBM Plex Sans at the handoff's true ramp (px/weight); the M1
 * Montserrat even-size mapping (15→14, 17→16, 25→24, 27→26) is retired. */
#define TK_FONT_SUB (&gc_plex_14)          /* sub/hint/unit        14/400 */
#define TK_FONT_PILL (&gc_plex_15)         /* pill & legend        15/600 */
#define TK_FONT_CHIP (&gc_plex_16)         /* chip / caps labels   16/600 */
#define TK_FONT_BODY (&gc_plex_17)         /* empty-state body     17/400 */
#define TK_FONT_HEADSIGN (&gc_plex_18)     /* board headsign       18/400 */
#define TK_FONT_DIRECTION (&gc_plex_20)    /* detail direction /
                                              short bus-pill label 20/600 */
#define TK_FONT_TITLE_SM (&gc_plex_24)     /* 2-line station name,
                                              empty-state title    24/700 */
#define TK_FONT_BULLET (&gc_plex_25)       /* rail bullet label    25/700 */
#define TK_FONT_TITLE_MD (&gc_plex_27)     /* station name (13-18) 27/700 */
#define TK_FONT_TITLE_LG (&gc_plex_30)     /* station name (<=12)  30/700 */
#define TK_FONT_COUNTDOWN (&gc_plex_36)    /* board countdown      36/700 */
#define TK_FONT_COUNTDOWN_XL (&gc_plex_40) /* detail countdown     40/700 */
#define TK_FONT_HERO (&gc_plex_84)         /* bike heroes, digits  84/700 */

/* Chrome */
#define TK_CHIP_Y 18
#define TK_CHIP_GAP 16
#define TK_PARTIAL_DOT 5 /* R3 partial-data marker beside the chip (amber) */
#define TK_MODE_DOT 6
#define TK_MODE_DOT_GAP 9
#define TK_MODE_DOTS_BOTTOM 16
#define TK_STOP_DOT 6
#define TK_STOP_DOT_GAP 7
#define TK_STOP_DOTS_RIGHT 12

/* Board */
#define TK_HEADER_TOP 50
#define TK_ROWS_TOP 148
#define TK_ROWS_TOP_2LINE 158
#define TK_ROWS_BOTTOM 44
#define TK_MAX_VISIBLE_ROWS 4
#define TK_BULLET_D 46
#define TK_BULLET_OVERLAP 12
#define TK_BULLET_RING 3
#define TK_ROW_GAP 14

/* Empty mode (handoff §7): ring / title / body vertical anchors */
#define TK_EMPTY_RING_Y 150
#define TK_EMPTY_TITLE_Y 230
#define TK_EMPTY_BODY_Y 270

/* Trunk detail (handoff §2, plan U4) */
#define TK_DETAIL_HEADER_TOP 44    /* §2 header top */
#define TK_DETAIL_HEADER_PAD_B 14  /* header bottom pad above the hairline */
#define TK_DETAIL_BULLET_D 52      /* header bullet cluster diameter */
#define TK_DETAIL_BULLET_OVERLAP 13
#define TK_DETAIL_ROW_BULLET_D 44  /* arrivals-row bullet (24 px label) */
#define TK_DETAIL_ROWS_TOP 144     /* arrivals list: top=144 → bottom=64 */
#define TK_DETAIL_ROWS_BOTTOM 64
#define TK_DETAIL_ROW_H 86
#define TK_DETAIL_HINT_BOTTOM 36   /* footer hint center */
#define TK_TEXT_FLIP_GLYPH 0x68686E /* ⇅ in the detail header */

/* Bike station (handoff §3) */
#define TK_BIKE_CLASSIC 0x3FC9C0  /* hero + classic segment */
#define TK_BIKE_ELECTRIC 0xF0C419 /* electric segment */
#define TK_BIKE_EMPTY 0x2A2A2E    /* empty (open dock) segment */
#define TK_BIKE_HERO_TOP 158
#define TK_BIKE_HERO_LS (-3)  /* 84 px number letter-spacing */
#define TK_BIKE_LABEL_LS 2    /* BIKES/DOCKS caps: handoff 1.8, LVGL int px */
#define TK_BIKE_BAR_TOP 312
#define TK_BIKE_BAR_H 14
#define TK_BIKE_BAR_R 7
#define TK_BIKE_BAR_GAP 2
#define TK_BIKE_LEGEND_GAP 14 /* below the bar */
#define TK_BIKE_LEGEND_DOT 9
#define TK_BIKE_HINT_BOTTOM 52

/* Bike nearby compare (handoff §4) */
#define TK_NEARBY_HEADER_TOP 48 /* §4 header top */
#define TK_NEARBY_HEADER_LS 2   /* handoff 1.5, LVGL int px */
#define TK_NEARBY_ROWS_TOP 120
#define TK_NEARBY_ROWS_BOTTOM 46
#define TK_NEARBY_VISIBLE 3     /* §4: 3 visible rows, no scrolling (KTD-2) */
#define TK_NEARBY_BAR_H 10
#define TK_NEARBY_BAR_R 5
#define TK_NEARBY_BAR_GAP 9 /* name → mini bar */

/* Jitter (spec burn-in requirement) */
#define TK_JITTER_PX 4

/* Staleness thresholds (spec) */
#define TK_STALE_AFTER_S 90

#endif /* GTFS_COMPASS_UI_TOKENS_H */
