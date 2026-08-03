/* Design tokens from docs/design/transit-watch-handoff.md — literal device
 * pixels at 410x502. Names mirror the handoff's vocabulary. */
#ifndef GTFS_COMPASS_UI_TOKENS_H
#define GTFS_COMPASS_UI_TOKENS_H

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

/* Chrome */
#define TK_CHIP_Y 18
#define TK_CHIP_GAP 16
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

/* Jitter (spec burn-in requirement) */
#define TK_JITTER_PX 4

/* Staleness thresholds (spec) */
#define TK_STALE_AFTER_S 90

#endif /* GTFS_COMPASS_UI_TOKENS_H */
