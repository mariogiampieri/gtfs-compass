/* Host tests for components/model — runs with plain cc + Unity, no IDF. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "model.h"
#include "unity.h"

void setUp(void) {}
void tearDown(void) {}

static char *read_file(const char *relpath, size_t *out_len) {
  char path[512];
  snprintf(path, sizeof(path), "%s/%s", FIXTURE_DIR, relpath);
  FILE *f = fopen(path, "rb");
  TEST_ASSERT_NOT_NULL_MESSAGE(f, path);
  fseek(f, 0, SEEK_END);
  long n = ftell(f);
  fseek(f, 0, SEEK_SET);
  char *buf = malloc((size_t)n + 1);
  TEST_ASSERT_NOT_NULL(buf);
  TEST_ASSERT_EQUAL(1, fread(buf, (size_t)n, 1, f));
  buf[n] = '\0';
  fclose(f);
  if (out_len) *out_len = (size_t)n;
  return buf;
}

static model_nearby_t g_model; /* large struct: keep off the test stack */

static void parse_ok(const char *json) {
  TEST_ASSERT_EQUAL(MODEL_PARSE_OK, model_parse_nearby(json, strlen(json), &g_model));
}

/* ---------- live capture ---------- */

static void test_live_fixture_parses_with_expected_shape(void) {
  size_t len;
  char *body = read_file("live-jay-st.json", &len);
  TEST_ASSERT_EQUAL(MODEL_PARSE_OK, model_parse_nearby(body, len, &g_model));
  free(body);

  TEST_ASSERT_TRUE(g_model.rail.present);
  TEST_ASSERT_FALSE(g_model.rail.no_data);
  TEST_ASSERT_TRUE(g_model.rail.fetched_at > 0);
  TEST_ASSERT_EQUAL_STRING("Uptown", g_model.rail.direction_labels[0]);
  TEST_ASSERT_EQUAL_STRING("Downtown", g_model.rail.direction_labels[1]);
  TEST_ASSERT_EQUAL(5, g_model.rail.stop_count);
  TEST_ASSERT_EQUAL_STRING("Jay St-MetroTech", g_model.rail.stops[0].name);
  TEST_ASSERT_TRUE(g_model.rail.stops[0].trunk_count >= 2);

  const model_trunk_t *t = &g_model.rail.stops[0].trunks[0];
  TEST_ASSERT_TRUE(t->route_count >= 1);
  TEST_ASSERT_TRUE(t->color != 0);
  /* Arrivals somewhere in the capture — per-trunk counts are time-of-day
   * dependent (a cold 5 AM capture once had zero everywhere; recapture
   * with `make capture` if this ever fails on a fresh fixture). */
  int total_arrivals = 0;
  for (int s = 0; s < g_model.rail.stop_count; s++) {
    for (int tr = 0; tr < g_model.rail.stops[s].trunk_count; tr++) {
      total_arrivals += g_model.rail.stops[s].trunks[tr].directions[0].arrival_count +
                        g_model.rail.stops[s].trunks[tr].directions[1].arrival_count;
    }
  }
  TEST_ASSERT_TRUE(total_arrivals > 0);

  TEST_ASSERT_TRUE(g_model.bike.present);
  TEST_ASSERT_TRUE(g_model.bike.station_count > 0);
  TEST_ASSERT_TRUE(g_model.bike.stations[0].capacity > 0);
  TEST_ASSERT_TRUE(g_model.bus_present);
  TEST_ASSERT_EQUAL_STRING("imperial", g_model.units);
  TEST_ASSERT_TRUE(g_model.loc_lat > 40.0 && g_model.loc_lat < 41.0);
}

/* ---------- status fields ---------- */

static void test_cold_body_sets_no_data(void) {
  parse_ok("{\"location\":{\"lat\":40.7,\"lon\":-74.0,\"accuracy\":null},"
           "\"generated_at\":\"2026-08-03T00:00:00Z\",\"units\":\"imperial\",\"systems\":["
           "{\"mode\":\"rail\",\"direction_labels\":null,\"fetched_at\":null,\"stops\":[]}]}");
  TEST_ASSERT_TRUE(g_model.rail.present);
  TEST_ASSERT_TRUE(g_model.rail.no_data);
  TEST_ASSERT_EQUAL(0, g_model.rail.fetched_at);
  TEST_ASSERT_EQUAL_STRING("", g_model.rail.direction_labels[0]);
  TEST_ASSERT_FALSE(g_model.bike.present);
  /* accuracy null -> -1 sentinel */
  TEST_ASSERT_EQUAL_DOUBLE(-1.0, g_model.loc_accuracy);
}

static void test_partial_flag_lands(void) {
  parse_ok("{\"units\":\"imperial\",\"systems\":[{\"mode\":\"rail\",\"direction_labels\":null,"
           "\"fetched_at\":123,\"partial\":true,\"stops\":[]}]}");
  TEST_ASSERT_TRUE(g_model.rail.partial);
  TEST_ASSERT_EQUAL(123, g_model.rail.fetched_at);
}

static void test_nearest_distance_label_and_missing_optionals(void) {
  parse_ok("{\"units\":\"metric\",\"systems\":["
           "{\"mode\":\"rail\",\"direction_labels\":null,\"fetched_at\":null,\"stops\":[],"
           "\"nearest_distance_label\":\"2.4 km\"},"
           "{\"mode\":\"bike\",\"fetched_at\":null,\"stations\":[],\"nearest_distance_label\":null}]}");
  TEST_ASSERT_EQUAL_STRING("2.4 km", g_model.rail.nearest_distance_label);
  TEST_ASSERT_EQUAL_STRING("", g_model.bike.nearest_distance_label);
  TEST_ASSERT_EQUAL_STRING("metric", g_model.units);
}

/* ---------- trunks, routes, arrivals, alerts ---------- */

static const char *stop_with_trunks(int n_trunks) {
  static char buf[8192];
  char *p = buf;
  p += sprintf(p, "{\"units\":\"imperial\",\"systems\":[{\"mode\":\"rail\","
                  "\"direction_labels\":[\"Uptown\",\"Downtown\"],\"fetched_at\":9,\"stops\":["
                  "{\"id\":\"X\",\"name\":\"Busy Hub\",\"distance_label\":\"100 ft\",\"trunks\":[");
  for (int i = 0; i < n_trunks; i++) {
    p += sprintf(p,
                 "%s{\"key\":\"k%d\",\"color\":\"#00%02X00\",\"text_color\":\"#FFFFFF\","
                 "\"routes\":[{\"label\":\"R%d\",\"shape\":\"circle\"}],\"alert\":null,\"note\":null,"
                 "\"directions\":[{\"direction_id\":0,\"label\":null,\"arrivals\":[]},"
                 "{\"direction_id\":1,\"label\":null,\"arrivals\":[]}]}",
                 i ? "," : "", i, i + 1, i);
  }
  sprintf(p, "]}]}]}");
  return buf;
}

static void test_trunk_clamp_at_cap(void) {
  parse_ok(stop_with_trunks(9));
  TEST_ASSERT_EQUAL(MODEL_MAX_TRUNKS, g_model.rail.stops[0].trunk_count);
  TEST_ASSERT_EQUAL(1, g_model.rail.stops[0].trunks_clamped);
  /* retained trunks keep their identity */
  TEST_ASSERT_EQUAL_STRING("R7", g_model.rail.stops[0].trunks[7].routes[0].label);
}

static void test_alert_and_arrival_fields(void) {
  parse_ok(
      "{\"units\":\"imperial\",\"systems\":[{\"mode\":\"rail\","
      "\"direction_labels\":[\"Uptown\",\"Downtown\"],\"fetched_at\":9,\"stops\":["
      "{\"id\":\"A41\",\"name\":\"Jay St\",\"distance_label\":\"0 ft\",\"trunks\":["
      "{\"key\":\"0039a6\",\"color\":\"#0039A6\",\"text_color\":\"#FFFFFF\","
      "\"routes\":[{\"label\":\"A\",\"shape\":\"circle\"},{\"label\":\"M15-SBS\",\"shape\":\"pill\"}],"
      "\"alert\":{\"severity\":\"delay\",\"text\":\"[3] is suspended\",\"directions\":[1]},"
      "\"note\":null,"
      "\"directions\":["
      "{\"direction_id\":0,\"label\":null,\"arrivals\":[{\"route\":\"A\",\"headsign\":null,\"eta_min\":0}]},"
      "{\"direction_id\":1,\"label\":null,\"arrivals\":["
      "{\"route\":\"A\",\"headsign\":\"Far Rockaway-Mott Av\",\"eta_min\":7}]}]}]}]}]}");
  const model_trunk_t *t = &g_model.rail.stops[0].trunks[0];
  TEST_ASSERT_EQUAL_HEX32(0x0039A6, t->color);
  TEST_ASSERT_EQUAL_HEX32(0xFFFFFF, t->text_color);
  TEST_ASSERT_EQUAL(2, t->route_count);
  TEST_ASSERT_EQUAL(MODEL_SHAPE_CIRCLE, t->routes[0].shape);
  TEST_ASSERT_EQUAL(MODEL_SHAPE_PILL, t->routes[1].shape);
  TEST_ASSERT_EQUAL(MODEL_ALERT_DELAY, t->alert.severity);
  TEST_ASSERT_EQUAL_STRING("[3] is suspended", t->alert.text);
  TEST_ASSERT_EQUAL(0x2, t->alert.directions_mask); /* dir 1 only */
  TEST_ASSERT_EQUAL(1, t->directions[0].arrival_count);
  TEST_ASSERT_EQUAL_STRING("", t->directions[0].arrivals[0].headsign); /* null -> "" */
  TEST_ASSERT_EQUAL(0, t->directions[0].arrivals[0].eta_min);
  TEST_ASSERT_EQUAL_STRING("Far Rockaway-Mott Av", t->directions[1].arrivals[0].headsign);
  TEST_ASSERT_EQUAL(7, t->directions[1].arrivals[0].eta_min);
}

static void test_overlong_strings_truncate_nul_terminated(void) {
  char json[4096];
  char longname[300];
  memset(longname, 'N', sizeof(longname) - 1);
  longname[sizeof(longname) - 1] = '\0';
  snprintf(json, sizeof(json),
           "{\"units\":\"imperial\",\"systems\":[{\"mode\":\"rail\",\"direction_labels\":null,"
           "\"fetched_at\":9,\"stops\":[{\"id\":\"X\",\"name\":\"%s\",\"distance_label\":\"1 mi\","
           "\"trunks\":[]}]}]}",
           longname);
  parse_ok(json);
  TEST_ASSERT_EQUAL(MODEL_NAME_LEN - 1, strlen(g_model.rail.stops[0].name));
}

/* ---------- bike ---------- */

static void test_bike_null_counts_become_sentinels(void) {
  parse_ok("{\"units\":\"imperial\",\"systems\":[{\"mode\":\"bike\",\"fetched_at\":null,"
           "\"partial\":true,\"stations\":[{\"id\":\"s\",\"name\":\"Cold Dock\","
           "\"distance_label\":\"90 ft\",\"bikes_classic\":null,\"bikes_electric\":null,"
           "\"docks_open\":null,\"capacity\":19}]}]}");
  const model_bike_station_t *s = &g_model.bike.stations[0];
  TEST_ASSERT_EQUAL(-1, s->bikes_classic);
  TEST_ASSERT_EQUAL(-1, s->bikes_electric);
  TEST_ASSERT_EQUAL(-1, s->docks_open);
  TEST_ASSERT_EQUAL(19, s->capacity);
  TEST_ASSERT_TRUE(g_model.bike.partial);
  TEST_ASSERT_TRUE(g_model.bike.no_data);
}

static void test_bike_zero_counts_stay_zero(void) {
  parse_ok("{\"units\":\"imperial\",\"systems\":[{\"mode\":\"bike\",\"fetched_at\":5,"
           "\"stations\":[{\"id\":\"s\",\"name\":\"Empty Dock\",\"distance_label\":\"90 ft\","
           "\"bikes_classic\":0,\"bikes_electric\":0,\"docks_open\":31,\"capacity\":31}]}]}");
  TEST_ASSERT_EQUAL(0, g_model.bike.stations[0].bikes_classic);
  TEST_ASSERT_EQUAL(31, g_model.bike.stations[0].docks_open);
  TEST_ASSERT_FALSE(g_model.bike.no_data);
}

/* ---------- error paths ---------- */

static void test_garbage_and_wrong_shape(void) {
  model_nearby_t m;
  TEST_ASSERT_EQUAL(MODEL_PARSE_ERR_JSON, model_parse_nearby("not json", 8, &m));
  TEST_ASSERT_EQUAL(MODEL_PARSE_ERR_SHAPE, model_parse_nearby("{}", 2, &m));
  TEST_ASSERT_EQUAL(MODEL_PARSE_ERR_SHAPE, model_parse_nearby("[1,2,3]", 7, &m));
  TEST_ASSERT_EQUAL(MODEL_PARSE_ERR_SHAPE,
                    model_parse_nearby("{\"systems\":\"nope\"}", 18, &m));
}

static void test_malformed_entries_skipped_not_fatal(void) {
  /* a null stop entry and a trunk missing its directions must not crash */
  parse_ok("{\"units\":\"imperial\",\"systems\":[{\"mode\":\"rail\",\"direction_labels\":null,"
           "\"fetched_at\":9,\"stops\":[null,"
           "{\"id\":\"X\",\"name\":\"OK\",\"distance_label\":\"1 mi\","
           "\"trunks\":[{\"key\":\"k\",\"color\":\"#112233\",\"routes\":[]}]}]}]}");
  TEST_ASSERT_EQUAL(1, g_model.rail.stop_count);
  TEST_ASSERT_EQUAL_STRING("OK", g_model.rail.stops[0].name);
  TEST_ASSERT_EQUAL(1, g_model.rail.stops[0].trunk_count);
  TEST_ASSERT_EQUAL(0, g_model.rail.stops[0].trunks[0].directions[0].arrival_count);
}


/* ---------- review-driven regressions ---------- */

static void test_stop_and_arrival_clamps(void) {
  /* 7 stops (cap 5); one direction with 10 arrivals (cap 8) */
  static char buf[16384];
  char *p = buf;
  p += sprintf(p, "{\"units\":\"imperial\",\"systems\":[{\"mode\":\"rail\","
                  "\"direction_labels\":null,\"fetched_at\":9,\"stops\":[");
  for (int s = 0; s < 7; s++) {
    p += sprintf(p, "%s{\"id\":\"S%d\",\"name\":\"Stop %d\",\"distance_label\":\"1 mi\","
                    "\"trunks\":[{\"key\":\"k\",\"color\":\"#112233\",\"text_color\":\"#FFFFFF\","
                    "\"routes\":[{\"label\":\"A\",\"shape\":\"circle\"}],\"alert\":null,"
                    "\"directions\":[{\"direction_id\":0,\"arrivals\":[",
                 s ? "," : "", s, s);
    for (int a = 0; a < 10; a++) {
      p += sprintf(p, "%s{\"route\":\"A\",\"headsign\":\"X\",\"eta_min\":%d}", a ? "," : "", a);
    }
    p += sprintf(p, "]},{\"direction_id\":1,\"arrivals\":[]}]}]}");
  }
  sprintf(p, "]}]}");
  parse_ok(buf);
  TEST_ASSERT_EQUAL(MODEL_MAX_STOPS, g_model.rail.stop_count);
  TEST_ASSERT_EQUAL(MODEL_MAX_ARRIVALS,
                    g_model.rail.stops[0].trunks[0].directions[0].arrival_count);
  /* retained arrivals are the FIRST 8 (soonest — API sorts ascending) */
  TEST_ASSERT_EQUAL(0, g_model.rail.stops[0].trunks[0].directions[0].arrivals[0].eta_min);
  TEST_ASSERT_EQUAL(7, g_model.rail.stops[0].trunks[0].directions[0].arrivals[7].eta_min);
}

static void test_null_alert_yields_zero_values(void) {
  parse_ok("{\"units\":\"imperial\",\"systems\":[{\"mode\":\"rail\",\"direction_labels\":null,"
           "\"fetched_at\":9,\"stops\":[{\"id\":\"X\",\"name\":\"S\",\"distance_label\":\"1 mi\","
           "\"trunks\":[{\"key\":\"k\",\"color\":\"#112233\",\"routes\":[],\"alert\":null}]}]}]}");
  const model_alert_t *al = &g_model.rail.stops[0].trunks[0].alert;
  TEST_ASSERT_EQUAL(MODEL_ALERT_NONE, al->severity);
  TEST_ASSERT_EQUAL_STRING("", al->text);
  TEST_ASSERT_EQUAL(0, al->directions_mask);
}

static void test_headsign_and_alert_text_truncate(void) {
  char longtext[512];
  memset(longtext, 'A', sizeof(longtext) - 1);
  longtext[sizeof(longtext) - 1] = '\0';
  char json[4096];
  snprintf(json, sizeof(json),
           "{\"units\":\"imperial\",\"systems\":[{\"mode\":\"rail\",\"direction_labels\":null,"
           "\"fetched_at\":9,\"stops\":[{\"id\":\"X\",\"name\":\"S\",\"distance_label\":\"1 mi\","
           "\"trunks\":[{\"key\":\"k\",\"color\":\"#112233\",\"routes\":[],"
           "\"alert\":{\"severity\":\"delay\",\"text\":\"%.300s\",\"directions\":[0]},"
           "\"directions\":[{\"direction_id\":0,\"arrivals\":["
           "{\"route\":\"A\",\"headsign\":\"%.100s\",\"eta_min\":1}]}]}]}]}]}",
           longtext, longtext);
  parse_ok(json);
  const model_trunk_t *t = &g_model.rail.stops[0].trunks[0];
  TEST_ASSERT_EQUAL(MODEL_ALERT_TEXT_LEN - 1, strlen(t->alert.text));
  TEST_ASSERT_EQUAL(MODEL_HEADSIGN_LEN - 1, strlen(t->directions[0].arrivals[0].headsign));
}

static void test_generated_at_seeds_initial_age(void) {
  /* generated 2026-08-03T04:02:43Z = 1785729763; fetched 120s earlier */
  parse_ok("{\"generated_at\":\"2026-08-03T04:02:43Z\",\"units\":\"imperial\",\"systems\":["
           "{\"mode\":\"rail\",\"direction_labels\":null,\"fetched_at\":1785729643,\"stops\":[]}]}");
  TEST_ASSERT_EQUAL(1785729763, (long long)g_model.generated_at);
  TEST_ASSERT_EQUAL(120, g_model.rail.initial_age_s);

  /* fresh: age 0; skewed (fetched_at ahead): clamps to 0, never negative */
  parse_ok("{\"generated_at\":\"2026-08-03T04:02:43Z\",\"units\":\"imperial\",\"systems\":["
           "{\"mode\":\"rail\",\"direction_labels\":null,\"fetched_at\":1785729999,\"stops\":[]}]}");
  TEST_ASSERT_EQUAL(0, g_model.rail.initial_age_s);

  /* cold body: unknown age */
  parse_ok("{\"generated_at\":\"2026-08-03T04:02:43Z\",\"units\":\"imperial\",\"systems\":["
           "{\"mode\":\"rail\",\"direction_labels\":null,\"fetched_at\":null,\"stops\":[]}]}");
  TEST_ASSERT_EQUAL(-1, g_model.rail.initial_age_s);

  /* no generated_at: unknown age */
  parse_ok("{\"units\":\"imperial\",\"systems\":["
           "{\"mode\":\"rail\",\"direction_labels\":null,\"fetched_at\":123,\"stops\":[]}]}");
  TEST_ASSERT_EQUAL(-1, g_model.rail.initial_age_s);
}

static void test_depth_bomb_rejected_not_crashed(void) {
  /* 200 nested arrays: must fail via CJSON_NESTING_LIMIT (48), not the stack */
  char bomb[512];
  int i = 0;
  for (; i < 200; i++) bomb[i] = '[';
  bomb[i] = '\0';
  model_nearby_t m;
  TEST_ASSERT_EQUAL(MODEL_PARSE_ERR_JSON, model_parse_nearby(bomb, strlen(bomb), &m));
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_live_fixture_parses_with_expected_shape);
  RUN_TEST(test_cold_body_sets_no_data);
  RUN_TEST(test_partial_flag_lands);
  RUN_TEST(test_nearest_distance_label_and_missing_optionals);
  RUN_TEST(test_trunk_clamp_at_cap);
  RUN_TEST(test_alert_and_arrival_fields);
  RUN_TEST(test_overlong_strings_truncate_nul_terminated);
  RUN_TEST(test_bike_null_counts_become_sentinels);
  RUN_TEST(test_bike_zero_counts_stay_zero);
  RUN_TEST(test_garbage_and_wrong_shape);
  RUN_TEST(test_malformed_entries_skipped_not_fatal);
  RUN_TEST(test_stop_and_arrival_clamps);
  RUN_TEST(test_null_alert_yields_zero_values);
  RUN_TEST(test_headsign_and_alert_text_truncate);
  RUN_TEST(test_generated_at_seeds_initial_age);
  RUN_TEST(test_depth_bomb_rejected_not_crashed);
  return UNITY_END();
}
