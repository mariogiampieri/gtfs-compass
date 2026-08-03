/*
 * test_bike_layout.c — pure bike-screen layout math (plan U5; R5).
 *
 * The R5 degraded permutations are arithmetic facts: -1 sentinels render
 * "—" and hide the bar; real zeros render "0"; capacity == -1 with real
 * counts keeps the counts but hides the bar. Segment widths are exact
 * integer expectations so a proportions regression fails loudly.
 */
#include <string.h>

#include "ui_bike_layout.h"
#include "unity.h"

void setUp(void) {}
void tearDown(void) {}

static model_bike_station_t station(int16_t classic, int16_t electric,
                                    int16_t docks, int16_t capacity) {
  model_bike_station_t s;
  memset(&s, 0, sizeof(s));
  s.bikes_classic = classic;
  s.bikes_electric = electric;
  s.docks_open = docks;
  s.capacity = capacity;
  return s;
}

/* ---------- hero math ---------- */

static void test_heroes_sum_real_counts(void) {
  model_bike_station_t s = station(26, 5, 2, 39); /* live fixture station 0 */
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_STRING("31", l.bikes);
  TEST_ASSERT_EQUAL_STRING("2", l.docks);
  TEST_ASSERT_TRUE(l.counts_known);
  TEST_ASSERT_TRUE(l.show_bar);
}

static void test_zero_is_a_real_count_not_unknown(void) {
  /* an actually-empty station says "0", never "—" (R5: facts) */
  model_bike_station_t s = station(0, 0, 3, 3);
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_STRING("0", l.bikes);
  TEST_ASSERT_EQUAL_STRING("3", l.docks);
  TEST_ASSERT_TRUE(l.counts_known);
  TEST_ASSERT_TRUE(l.show_bar);
  /* one segment: all empty, full width */
  TEST_ASSERT_EQUAL_INT16(0, l.classic_w);
  TEST_ASSERT_EQUAL_INT16(0, l.electric_w);
  TEST_ASSERT_EQUAL_INT16(342, l.empty_w);
}

/* ---------- degraded permutation 1: -1 sentinel on a bike count ---------- */

static void test_unknown_classic_makes_bikes_unknown_and_hides_bar(void) {
  model_bike_station_t s = station(-1, 5, 2, 39);
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_STRING("—", l.bikes); /* unknown addend → unknown sum */
  TEST_ASSERT_EQUAL_STRING("2", l.docks); /* docks stands alone */
  TEST_ASSERT_FALSE(l.counts_known);
  TEST_ASSERT_FALSE(l.show_bar);
}

static void test_unknown_electric_makes_bikes_unknown(void) {
  model_bike_station_t s = station(26, -1, 2, 39);
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_STRING("—", l.bikes);
  TEST_ASSERT_FALSE(l.show_bar);
}

/* ---------- degraded permutation 2: -1 sentinel on docks ---------- */

static void test_unknown_docks_keeps_bikes_hides_bar(void) {
  model_bike_station_t s = station(26, 5, -1, 39);
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_STRING("31", l.bikes);
  TEST_ASSERT_EQUAL_STRING("—", l.docks);
  TEST_ASSERT_FALSE(l.counts_known); /* → muted note, no legend */
  TEST_ASSERT_FALSE(l.show_bar);
}

/* ---------- degraded permutation 3: all counts unknown ---------- */

static void test_all_unknown_renders_dashes(void) {
  model_bike_station_t s = station(-1, -1, -1, 39);
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_STRING("—", l.bikes);
  TEST_ASSERT_EQUAL_STRING("—", l.docks);
  TEST_ASSERT_FALSE(l.counts_known);
  TEST_ASSERT_FALSE(l.show_bar);
}

/* ---------- degraded permutation 4: capacity unknown, counts real ---------- */

static void test_unknown_capacity_shows_counts_hides_bar(void) {
  model_bike_station_t s = station(26, 5, 2, -1);
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_STRING("31", l.bikes);
  TEST_ASSERT_EQUAL_STRING("2", l.docks);
  TEST_ASSERT_TRUE(l.counts_known); /* legend still renders */
  TEST_ASSERT_FALSE(l.show_bar);    /* no proportions without a capacity */
}

/* ---------- bar proportions ---------- */

static void test_three_segment_proportions(void) {
  /* 26 classic + 5 electric + 8 empty of 39, bar 342, gaps 2×2:
   * usable 338 → 338·26/39=225, 338·5/39=43, remainder 70 to empty */
  model_bike_station_t s = station(26, 5, 2, 39);
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_INT16(225, l.classic_w);
  TEST_ASSERT_EQUAL_INT16(43, l.electric_w);
  TEST_ASSERT_EQUAL_INT16(70, l.empty_w);
  TEST_ASSERT_EQUAL(338, l.classic_w + l.electric_w + l.empty_w);
}

static void test_zero_count_segment_is_absent_not_a_sliver(void) {
  /* Jay St & Tech Pl: 46 classic, 0 electric, 4 empty of 52 — two
   * segments, ONE gap: usable 340 → 340·46/52=300, remainder 40 empty */
  model_bike_station_t s = station(46, 0, 2, 52);
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_INT16(300, l.classic_w);
  TEST_ASSERT_EQUAL_INT16(0, l.electric_w);
  TEST_ASSERT_EQUAL_INT16(40, l.empty_w);
}

static void test_full_station_is_one_full_width_segment(void) {
  model_bike_station_t s = station(3, 0, 0, 3);
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_INT16(342, l.classic_w); /* absorbs the remainder */
  TEST_ASSERT_EQUAL_INT16(0, l.electric_w);
  TEST_ASSERT_EQUAL_INT16(0, l.empty_w);
}

static void test_over_capacity_counts_clamp_empty_to_absent(void) {
  /* counts above capacity (rebalancing trucks happen): empty clamps to 0,
   * proportions renormalize over the real bike counts */
  model_bike_station_t s = station(5, 3, 0, 6);
  ui_bike_layout_t l;
  ui_bike_layout_compute(&s, 342, 2, &l);
  TEST_ASSERT_EQUAL_INT16(0, l.empty_w);
  TEST_ASSERT_EQUAL_INT16(212, l.classic_w); /* 340·5/8 = 212 */
  TEST_ASSERT_EQUAL_INT16(128, l.electric_w); /* remainder */
  TEST_ASSERT_EQUAL(340, l.classic_w + l.electric_w);
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_heroes_sum_real_counts);
  RUN_TEST(test_zero_is_a_real_count_not_unknown);
  RUN_TEST(test_unknown_classic_makes_bikes_unknown_and_hides_bar);
  RUN_TEST(test_unknown_electric_makes_bikes_unknown);
  RUN_TEST(test_unknown_docks_keeps_bikes_hides_bar);
  RUN_TEST(test_all_unknown_renders_dashes);
  RUN_TEST(test_unknown_capacity_shows_counts_hides_bar);
  RUN_TEST(test_three_segment_proportions);
  RUN_TEST(test_zero_count_segment_is_absent_not_a_sliver);
  RUN_TEST(test_full_station_is_one_full_width_segment);
  RUN_TEST(test_over_capacity_counts_clamp_empty_to_absent);
  return UNITY_END();
}
