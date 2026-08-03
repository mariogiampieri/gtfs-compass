/* Host tests for components/ui/ui_nav.c + ui_reconcile_deferred (plan U3) —
 * runs with plain cc + Unity, no IDF, no LVGL.
 *
 * The U3 plan scenarios split three ways:
 *   - HERE (pure state facts): carousel clamping, pop-before-sys-change,
 *     stop cycling with identity writes, per-system age seeding, deferred
 *     apply seeding age = initial_age_s + defer time, nav-written identity
 *     surviving a shuffled reconcile.
 *   - sim/test_input.c (LVGL indev facts): gesture thresholds, scroll
 *     arbitration, ui_input_busy() while pressed (the deferral gate).
 *   - GC_DUMP / device (rendering + timing facts, not automatable here):
 *     mode dots track sys; per-system chip text; partial indicator pixels;
 *     pill tap flips and rows re-read the direction (board render is LVGL);
 *     model/minute-tick arriving mid-press or mid-slide defers and
 *     coalesces (main.c's gc_request_render path — verified on device per
 *     R11, plus sim walkthrough); OFFLINE/NO_LOCATION treatments per view.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "model.h"
#include "ui_nav.h"
#include "ui_state.h"
#include "unity.h"

void setUp(void) {}
void tearDown(void) {}

static model_nearby_t g_model; /* large struct: keep off the test stack */
static ui_state_t g_state;

static void parse_ok(const char *json) {
  TEST_ASSERT_EQUAL(MODEL_PARSE_OK, model_parse_nearby(json, strlen(json), &g_model));
}

/* rail: S1 (trunks k1,k2), S2 (k3) — fetched 120 s before generated_at.
 * bike: b1, b2, b3 — fetched 5 s before (per-system ages differ, KTD-7). */
static const char *NAV_BASE =
    "{\"generated_at\":\"2026-08-03T04:02:43Z\",\"units\":\"imperial\",\"systems\":["
    "{\"mode\":\"rail\",\"direction_labels\":[\"Uptown\",\"Downtown\"],\"fetched_at\":1785729643,"
    "\"stops\":["
    "{\"id\":\"S1\",\"name\":\"First\",\"distance_label\":\"1 mi\",\"trunks\":["
    "{\"key\":\"k1\",\"color\":\"#112233\",\"routes\":[]},"
    "{\"key\":\"k2\",\"color\":\"#445566\",\"routes\":[]}]},"
    "{\"id\":\"S2\",\"name\":\"Second\",\"distance_label\":\"2 mi\",\"trunks\":["
    "{\"key\":\"k3\",\"color\":\"#778899\",\"routes\":[]}]}]},"
    "{\"mode\":\"bike\",\"fetched_at\":1785729758,\"stations\":["
    "{\"id\":\"b1\",\"name\":\"D1\",\"distance_label\":\"1 ft\",\"bikes_classic\":1,"
    "\"bikes_electric\":0,\"docks_open\":2,\"capacity\":3},"
    "{\"id\":\"b2\",\"name\":\"D2\",\"distance_label\":\"2 ft\",\"bikes_classic\":2,"
    "\"bikes_electric\":1,\"docks_open\":0,\"capacity\":3},"
    "{\"id\":\"b3\",\"name\":\"D3\",\"distance_label\":\"3 ft\",\"bikes_classic\":0,"
    "\"bikes_electric\":0,\"docks_open\":3,\"capacity\":3}]}]}";

/* Same rail entities reordered: [S2 (k3), S1 (k2,k1)] — indices shift. */
static const char *NAV_SHUFFLED =
    "{\"generated_at\":\"2026-08-03T04:02:43Z\",\"units\":\"imperial\",\"systems\":["
    "{\"mode\":\"rail\",\"direction_labels\":[\"Uptown\",\"Downtown\"],\"fetched_at\":1785729643,"
    "\"stops\":["
    "{\"id\":\"S2\",\"name\":\"Second\",\"distance_label\":\"2 mi\",\"trunks\":["
    "{\"key\":\"k3\",\"color\":\"#778899\",\"routes\":[]}]},"
    "{\"id\":\"S1\",\"name\":\"First\",\"distance_label\":\"1 mi\",\"trunks\":["
    "{\"key\":\"k2\",\"color\":\"#445566\",\"routes\":[]},"
    "{\"key\":\"k1\",\"color\":\"#112233\",\"routes\":[]}]}]},"
    "{\"mode\":\"bike\",\"fetched_at\":1785729758,\"stations\":["
    "{\"id\":\"b1\",\"name\":\"D1\",\"distance_label\":\"1 ft\",\"bikes_classic\":1,"
    "\"bikes_electric\":0,\"docks_open\":2,\"capacity\":3}]}]}";

static void fresh_board(void) {
  parse_ok(NAV_BASE);
  ui_state_init(&g_state);
  ui_reconcile(&g_state, &g_model); /* adopt entity 0 identities */
  g_state.conn = UI_CONN_LIVE;
}

/* ---------- carousel (R3) ---------- */

static void test_sys_swipe_clamps_no_wrap(void) {
  fresh_board();
  TEST_ASSERT_EQUAL(UI_SYS_RAIL, g_state.sys);
  /* swiping right (previous) at sys=0 clamps: no change, no render */
  TEST_ASSERT_FALSE(ui_nav_swipe(&g_state, &g_model, UI_NAV_RIGHT));
  TEST_ASSERT_EQUAL(UI_SYS_RAIL, g_state.sys);
  /* left cycles forward to the end… */
  TEST_ASSERT_TRUE(ui_nav_swipe(&g_state, &g_model, UI_NAV_LEFT));
  TEST_ASSERT_EQUAL(UI_SYS_BUS, g_state.sys);
  TEST_ASSERT_TRUE(ui_nav_swipe(&g_state, &g_model, UI_NAV_LEFT));
  TEST_ASSERT_EQUAL(UI_SYS_BIKE, g_state.sys);
  /* …and clamps there */
  TEST_ASSERT_FALSE(ui_nav_swipe(&g_state, &g_model, UI_NAV_LEFT));
  TEST_ASSERT_EQUAL(UI_SYS_BIKE, g_state.sys);
}

/* ---------- stop cycling (R2, remembered per system) ---------- */

static void test_stop_cycling_writes_identity_and_wraps(void) {
  fresh_board();
  TEST_ASSERT_EQUAL_STRING("S1", g_state.stop_id[UI_SYS_RAIL]);
  TEST_ASSERT_TRUE(ui_nav_swipe(&g_state, &g_model, UI_NAV_UP));
  TEST_ASSERT_EQUAL(1, g_state.stop_idx[UI_SYS_RAIL]);
  TEST_ASSERT_EQUAL_STRING("S2", g_state.stop_id[UI_SYS_RAIL]); /* identity written */
  TEST_ASSERT_TRUE(ui_nav_swipe(&g_state, &g_model, UI_NAV_UP)); /* wraps (M1 j/k) */
  TEST_ASSERT_EQUAL(0, g_state.stop_idx[UI_SYS_RAIL]);
  TEST_ASSERT_EQUAL_STRING("S1", g_state.stop_id[UI_SYS_RAIL]);
  TEST_ASSERT_TRUE(ui_nav_swipe(&g_state, &g_model, UI_NAV_DOWN));
  TEST_ASSERT_EQUAL(1, g_state.stop_idx[UI_SYS_RAIL]);
}

static void test_stop_cycling_is_rail_board_only(void) {
  fresh_board();
  TEST_ASSERT_TRUE(ui_nav_swipe(&g_state, &g_model, UI_NAV_UP));
  uint8_t rail_idx = g_state.stop_idx[UI_SYS_RAIL];
  g_state.sys = UI_SYS_BIKE;
  TEST_ASSERT_FALSE(ui_nav_swipe(&g_state, &g_model, UI_NAV_UP)); /* U5 owns bike selection */
  g_state.sys = UI_SYS_BUS;
  TEST_ASSERT_FALSE(ui_nav_swipe(&g_state, &g_model, UI_NAV_UP)); /* no entities (KTD-6) */
  /* remembered per system: rail position untouched by the excursion */
  g_state.sys = UI_SYS_RAIL;
  TEST_ASSERT_EQUAL(rail_idx, g_state.stop_idx[UI_SYS_RAIL]);
}

/* ---------- detail open / back / pop (R2) ---------- */

static void test_open_detail_writes_trunk_identity(void) {
  fresh_board();
  TEST_ASSERT_TRUE(ui_nav_open_detail(&g_state, &g_model, 1));
  TEST_ASSERT_EQUAL(UI_VIEW_DETAIL, g_state.view);
  TEST_ASSERT_EQUAL(1, g_state.trunk_idx);
  TEST_ASSERT_EQUAL_STRING("k2", g_state.trunk_key);
  /* out-of-range trunk never opens */
  TEST_ASSERT_TRUE(ui_nav_back(&g_state));
  TEST_ASSERT_FALSE(ui_nav_open_detail(&g_state, &g_model, 7));
  TEST_ASSERT_EQUAL(UI_VIEW_BOARD, g_state.view);
}

static void test_horizontal_swipe_in_detail_pops_to_board(void) {
  fresh_board();
  TEST_ASSERT_TRUE(ui_nav_open_detail(&g_state, &g_model, 0));
  TEST_ASSERT_TRUE(ui_nav_swipe(&g_state, &g_model, UI_NAV_LEFT));
  TEST_ASSERT_EQUAL(UI_VIEW_BOARD, g_state.view); /* pop first, no sys change */
  TEST_ASSERT_EQUAL(UI_SYS_RAIL, g_state.sys);
  TEST_ASSERT_EQUAL_STRING("", g_state.trunk_key);
  /* vertical in a detail view is the scroll object's (or nothing) */
  TEST_ASSERT_TRUE(ui_nav_open_detail(&g_state, &g_model, 0));
  TEST_ASSERT_FALSE(ui_nav_swipe(&g_state, &g_model, UI_NAV_UP));
  TEST_ASSERT_EQUAL(UI_VIEW_DETAIL, g_state.view);
}

static void test_nav_identity_survives_shuffled_reconcile(void) {
  /* nav writes identity → the reconciler re-finds it at its new index and
   * keeps the view (the U3 press-race contract, end to end at state level) */
  fresh_board();
  TEST_ASSERT_TRUE(ui_nav_open_detail(&g_state, &g_model, 0)); /* k1 on S1, idx 0 */
  parse_ok(NAV_SHUFFLED); /* S1 now at index 1; k1 at trunk index 1 */
  ui_reconcile(&g_state, &g_model);
  TEST_ASSERT_EQUAL(UI_VIEW_DETAIL, g_state.view);
  TEST_ASSERT_EQUAL(1, g_state.stop_idx[UI_SYS_RAIL]);
  TEST_ASSERT_EQUAL(1, g_state.trunk_idx);
  TEST_ASSERT_EQUAL_STRING("k1", g_state.trunk_key);
}

/* ---------- bike nearby (R2: back never changes the selection) ---------- */

static void test_nearby_open_and_back_keep_selection(void) {
  fresh_board();
  g_state.sys = UI_SYS_BIKE;
  TEST_ASSERT_TRUE(ui_nav_open_nearby(&g_state, &g_model));
  TEST_ASSERT_EQUAL(UI_VIEW_BIKE_NEARBY, g_state.view);
  /* horizontal swipe exits like a detail view… */
  TEST_ASSERT_TRUE(ui_nav_swipe(&g_state, &g_model, UI_NAV_RIGHT));
  TEST_ASSERT_EQUAL(UI_VIEW_BOARD, g_state.view);
  TEST_ASSERT_EQUAL(UI_SYS_BIKE, g_state.sys);
  /* …without changing the current station */
  TEST_ASSERT_EQUAL_STRING("b1", g_state.stop_id[UI_SYS_BIKE]);
  /* nearby never opens from the rail board */
  g_state.sys = UI_SYS_RAIL;
  TEST_ASSERT_FALSE(ui_nav_open_nearby(&g_state, &g_model));
}

static void test_nearby_row_tap_selects_station(void) {
  /* U5: a row tap is the ONLY transition that changes the bike selection —
   * it writes identity + index and pops to the board (R2/R6) */
  fresh_board();
  g_state.sys = UI_SYS_BIKE;
  TEST_ASSERT_TRUE(ui_nav_open_nearby(&g_state, &g_model));
  TEST_ASSERT_TRUE(ui_nav_select_station(&g_state, &g_model, 1));
  TEST_ASSERT_EQUAL(UI_VIEW_BOARD, g_state.view);
  TEST_ASSERT_EQUAL(1, g_state.stop_idx[UI_SYS_BIKE]);
  TEST_ASSERT_EQUAL_STRING("b2", g_state.stop_id[UI_SYS_BIKE]);
  /* select is nearby-view-only: inert from the board… */
  TEST_ASSERT_FALSE(ui_nav_select_station(&g_state, &g_model, 0));
  TEST_ASSERT_EQUAL_STRING("b2", g_state.stop_id[UI_SYS_BIKE]);
  /* …and out-of-range rows never write */
  TEST_ASSERT_TRUE(ui_nav_open_nearby(&g_state, &g_model));
  TEST_ASSERT_FALSE(ui_nav_select_station(&g_state, &g_model, 9));
  TEST_ASSERT_EQUAL(UI_VIEW_BIKE_NEARBY, g_state.view);
  TEST_ASSERT_EQUAL_STRING("b2", g_state.stop_id[UI_SYS_BIKE]);
}

/* ---------- direction flip (global, R2) ---------- */

static void test_flip_dir_is_global_toggle(void) {
  fresh_board();
  TEST_ASSERT_EQUAL(0, g_state.dir);
  TEST_ASSERT_TRUE(ui_nav_flip_dir(&g_state));
  TEST_ASSERT_EQUAL(1, g_state.dir);
  /* survives navigation: board & detail, all trunks share it */
  TEST_ASSERT_TRUE(ui_nav_open_detail(&g_state, &g_model, 0));
  TEST_ASSERT_EQUAL(1, g_state.dir);
  TEST_ASSERT_TRUE(ui_nav_flip_dir(&g_state));
  TEST_ASSERT_EQUAL(0, g_state.dir);
}

/* U4/R4: the detail-header ⇅ flips IN PLACE — the view and the open trunk
 * identity are untouched, so the renderer swaps the arrival set without a
 * pop (and its scroll memory resets on the dir change, an LVGL fact the
 * GC_DUMP captures cover). */
static void test_flip_in_detail_keeps_view_and_trunk(void) {
  fresh_board();
  TEST_ASSERT_TRUE(ui_nav_open_detail(&g_state, &g_model, 1));
  TEST_ASSERT_TRUE(ui_nav_flip_dir(&g_state));
  TEST_ASSERT_EQUAL(UI_VIEW_DETAIL, g_state.view);
  TEST_ASSERT_EQUAL_STRING("k2", g_state.trunk_key);
  TEST_ASSERT_EQUAL(1, g_state.trunk_idx);
  TEST_ASSERT_EQUAL(1, g_state.dir);
}

/* ---------- per-system ages + deferred apply (KTD-7, R6) ---------- */

static void test_ages_seed_per_system(void) {
  fresh_board();
  TEST_ASSERT_EQUAL(120, g_state.age_s[UI_SYS_RAIL]); /* generated - fetched */
  TEST_ASSERT_EQUAL(5, g_state.age_s[UI_SYS_BIKE]);
  TEST_ASSERT_EQUAL(-1, g_state.age_s[UI_SYS_BUS]); /* no data: never ages */
}

static void test_deferred_apply_seeds_age_with_defer_time(void) {
  parse_ok(NAV_BASE);
  ui_state_init(&g_state);
  /* the message sat staged for 7 s while a finger was down (R6) */
  ui_reconcile_deferred(&g_state, &g_model, 7);
  TEST_ASSERT_EQUAL(127, g_state.age_s[UI_SYS_RAIL]);
  TEST_ASSERT_EQUAL(12, g_state.age_s[UI_SYS_BIKE]);
  TEST_ASSERT_EQUAL(-1, g_state.age_s[UI_SYS_BUS]); /* absent: untouched */
  /* zero/negative defer degrades to a plain reconcile */
  ui_state_init(&g_state);
  ui_reconcile_deferred(&g_state, &g_model, 0);
  TEST_ASSERT_EQUAL(120, g_state.age_s[UI_SYS_RAIL]);
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_sys_swipe_clamps_no_wrap);
  RUN_TEST(test_stop_cycling_writes_identity_and_wraps);
  RUN_TEST(test_stop_cycling_is_rail_board_only);
  RUN_TEST(test_open_detail_writes_trunk_identity);
  RUN_TEST(test_horizontal_swipe_in_detail_pops_to_board);
  RUN_TEST(test_nav_identity_survives_shuffled_reconcile);
  RUN_TEST(test_nearby_open_and_back_keep_selection);
  RUN_TEST(test_nearby_row_tap_selects_station);
  RUN_TEST(test_flip_dir_is_global_toggle);
  RUN_TEST(test_flip_in_detail_keeps_view_and_trunk);
  RUN_TEST(test_ages_seed_per_system);
  RUN_TEST(test_deferred_apply_seeds_age_with_defer_time);
  return UNITY_END();
}
