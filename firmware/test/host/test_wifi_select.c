/* Host tests for components/model/wifi_select.c (plan gc-4ae U1). */
#include <string.h>

#include "unity.h"
#include "wifi_select.h"

void setUp(void) {}
void tearDown(void) {}

static char g_stored[WIFI_SELECT_MAX_STORED][WIFI_SELECT_SSID_LEN];
static uint8_t g_order[WIFI_SELECT_MAX_STORED];

static void store(int n, ...) {
  memset(g_stored, 0, sizeof(g_stored));
  const char *names[] = {"home", "work", "hotspot", "cafe", "spare"};
  for (int i = 0; i < n; i++) strcpy(g_stored[i], names[i]);
}

static void test_strongest_visible_beats_slot_order(void) {
  store(3);
  wifi_scan_entry_t scan[] = {{"hotspot", -40}, {"home", -70}};
  TEST_ASSERT_EQUAL(3, wifi_select_order(g_stored, 3, scan, 2, g_order));
  TEST_ASSERT_EQUAL(2, g_order[0]); /* hotspot: strongest visible */
  TEST_ASSERT_EQUAL(0, g_order[1]); /* home: weaker but visible */
  TEST_ASSERT_EQUAL(1, g_order[2]); /* work: unseen, blind fallback */
}

static void test_all_unseen_yields_slot_order(void) {
  /* Hidden-SSID networks never scan but must still be tried. */
  store(3);
  TEST_ASSERT_EQUAL(3, wifi_select_order(g_stored, 3, NULL, 0, g_order));
  TEST_ASSERT_EQUAL(0, g_order[0]);
  TEST_ASSERT_EQUAL(1, g_order[1]);
  TEST_ASSERT_EQUAL(2, g_order[2]);
}

static void test_duplicate_scan_entries_collapse_to_strongest(void) {
  /* Mesh APs: one SSID, many BSSIDs. The strongest sighting ranks it. */
  store(2);
  wifi_scan_entry_t scan[] = {{"work", -80}, {"home", -75}, {"work", -50}};
  wifi_select_order(g_stored, 2, scan, 3, g_order);
  TEST_ASSERT_EQUAL(1, g_order[0]); /* work at -50 beats home at -75 */
  TEST_ASSERT_EQUAL(0, g_order[1]);
}

static void test_empty_store_is_empty_order(void) {
  wifi_scan_entry_t scan[] = {{"home", -40}};
  TEST_ASSERT_EQUAL(0, wifi_select_order(g_stored, 0, scan, 1, g_order));
}

static void test_bounds_full_store_full_scan(void) {
  store(5);
  wifi_scan_entry_t scan[WIFI_SELECT_MAX_SCAN];
  for (int i = 0; i < WIFI_SELECT_MAX_SCAN; i++) {
    snprintf(scan[i].ssid, sizeof(scan[i].ssid), "noise-%d", i);
    scan[i].rssi = (int8_t)(-30 - i);
  }
  strcpy(scan[7].ssid, "cafe"); /* only one stored network visible */
  TEST_ASSERT_EQUAL(5, wifi_select_order(g_stored, 5, scan, WIFI_SELECT_MAX_SCAN, g_order));
  TEST_ASSERT_EQUAL(3, g_order[0]); /* cafe first; rest keep slot order */
  TEST_ASSERT_EQUAL(0, g_order[1]);
  TEST_ASSERT_EQUAL(4, g_order[4]);
  /* Over-cap stored count clamps rather than overruns (ASan backstop). */
  TEST_ASSERT_EQUAL(5, wifi_select_order(g_stored, 9, scan, WIFI_SELECT_MAX_SCAN, g_order));
}

static void test_tied_rssi_keeps_slot_order(void) {
  store(3);
  wifi_scan_entry_t scan[] = {{"work", -60}, {"home", -60}};
  wifi_select_order(g_stored, 3, scan, 2, g_order);
  TEST_ASSERT_EQUAL(0, g_order[0]); /* home: same RSSI, earlier slot */
  TEST_ASSERT_EQUAL(1, g_order[1]);
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_strongest_visible_beats_slot_order);
  RUN_TEST(test_all_unseen_yields_slot_order);
  RUN_TEST(test_duplicate_scan_entries_collapse_to_strongest);
  RUN_TEST(test_empty_store_is_empty_order);
  RUN_TEST(test_bounds_full_store_full_scan);
  RUN_TEST(test_tied_rssi_keeps_slot_order);
  return UNITY_END();
}
