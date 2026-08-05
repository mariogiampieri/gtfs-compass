/* Host tests for components/model/pair_fsm.c (pairing plan U2) — plain cc +
 * Unity, no IDF, no LVGL, ASan on.
 *
 * The scenarios are the plan's U2 list: happy path with the interval floor,
 * expired_token, the 120 s post-claim grace window (a last-second browser
 * approval must still pair), malformed-200 transience, transport-error
 * transience, start failure, restart-after-expiry, and exactly-one persist.
 * Wire bodies are verbatim shapes from api/src/routes/pair.ts.
 */
#include <stdio.h>
#include <string.h>

#include "pair_fsm.h"
#include "unity.h"

void setUp(void) {}
void tearDown(void) {}

static pair_fsm_t f;

#define START_OK                                                            \
  "{\"device_code\":\"dc_secret_base64url_value_43_chars_long_xx\","        \
  "\"user_code\":\"BCDF-GHJK\","                                            \
  "\"verification_uri\":\"https://compass.example/pair\","                  \
  "\"expires_in\":300,\"interval\":5}"

#define POLL_PENDING "{\"error\":\"authorization_pending\"}"
#define POLL_EXPIRED "{\"error\":\"expired_token\"}"
#define POLL_INVALID "{\"error\":\"invalid_request\"}"
#define POLL_TOKEN                                                          \
  "{\"access_token\":\"gtfsc_dev_abcdefghijklmnopqrstuvwxyz0123456789abc\"," \
  "\"token_type\":\"Bearer\",\"device_id\":\"dev_x1\","                     \
  "\"scopes\":[\"read:departures\",\"read:config\"]}"

static void start_session(int64_t now) {
  pair_fsm_init(&f);
  TEST_ASSERT_TRUE(pair_fsm_start(&f, now));
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_START, pair_fsm_take_action(&f, now));
  pair_fsm_on_start_response(&f, 200, START_OK, strlen(START_OK), now);
  TEST_ASSERT_EQUAL(PAIR_CODE_ACTIVE, f.state);
}

static void test_happy_path_with_interval_floor(void) {
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL_STRING("BCDF-GHJK", f.user_code);
  TEST_ASSERT_EQUAL(5, f.interval_s);

  /* Immediately after start: no poll before the interval elapses. */
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 1));
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 5));
  pair_fsm_on_poll_response(&f, 400, POLL_PENDING, strlen(POLL_PENDING), now + 5);

  /* Floor holds between polls, jitter or not (asserts a floor, not spacing). */
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 8));
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 11));
  pair_fsm_on_poll_response(&f, 200, POLL_TOKEN, strlen(POLL_TOKEN), now + 11);

  TEST_ASSERT_EQUAL(PAIR_PAIRED, f.state);
  TEST_ASSERT_EQUAL_STRING("gtfsc_dev_abcdefghijklmnopqrstuvwxyz0123456789abc", f.token);
}

static void test_persist_emitted_exactly_once(void) {
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 5));
  pair_fsm_on_poll_response(&f, 200, POLL_TOKEN, strlen(POLL_TOKEN), now + 5);

  TEST_ASSERT_EQUAL(PAIR_ACT_PERSIST_TOKEN, pair_fsm_take_action(&f, now + 5));
  /* Asking again — same tick or later — never re-emits the persist. */
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 5));
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 60));

  /* A duplicate token response after PAIRED changes nothing. */
  pair_fsm_on_poll_response(&f, 200, POLL_TOKEN, strlen(POLL_TOKEN), now + 10);
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 10));
}

static void test_expired_token_ends_session_and_restart_is_fresh(void) {
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 5));
  pair_fsm_on_poll_response(&f, 400, POLL_EXPIRED, strlen(POLL_EXPIRED), now + 5);
  TEST_ASSERT_EQUAL(PAIR_EXPIRED, f.state);
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 10));
  TEST_ASSERT_EQUAL(0, pair_fsm_next_deadline(&f));

  /* Restart begins a fresh session with a fresh code. */
  TEST_ASSERT_TRUE(pair_fsm_start(&f, now + 20));
  TEST_ASSERT_EQUAL(PAIR_STARTING, f.state);
  TEST_ASSERT_EQUAL_STRING("", f.user_code);
}

static void test_local_deadline_polls_through_delivery_grace(void) {
  int64_t now = 1000;
  start_session(now); /* deadline = now + 300 */

  /* Past expires_in but inside the 120 s grace: still polling — the server
   * rewrote expires_at on claim precisely for this window. */
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 305));
  pair_fsm_on_poll_response(&f, 400, POLL_PENDING, strlen(POLL_PENDING), now + 305);
  TEST_ASSERT_EQUAL(PAIR_CODE_ACTIVE, f.state);

  /* A claim in the window delivers: last-second approval still pairs. */
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 311));
  pair_fsm_on_poll_response(&f, 200, POLL_TOKEN, strlen(POLL_TOKEN), now + 311);
  TEST_ASSERT_EQUAL(PAIR_PAIRED, f.state);
}

static void test_grace_exhaustion_expires_without_server_verdict(void) {
  int64_t now = 1000;
  start_session(now);
  /* deadline + grace = now + 420. At 419 still willing; at 420 expired. */
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 419));
  pair_fsm_on_poll_response(&f, 400, POLL_PENDING, strlen(POLL_PENDING), now + 419);
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 420));
  TEST_ASSERT_EQUAL(PAIR_EXPIRED, f.state);
}

static void test_malformed_200_is_transient(void) {
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 5));
  pair_fsm_on_poll_response(&f, 200, "{\"weird\":true}", 14, now + 5);
  TEST_ASSERT_EQUAL(PAIR_CODE_ACTIVE, f.state);
  /* Truncated garbage likewise. */
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 10));
  pair_fsm_on_poll_response(&f, 200, "{\"access_tok", 12, now + 10);
  TEST_ASSERT_EQUAL(PAIR_CODE_ACTIVE, f.state);
  /* And the session still completes. */
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 15));
  pair_fsm_on_poll_response(&f, 200, POLL_TOKEN, strlen(POLL_TOKEN), now + 15);
  TEST_ASSERT_EQUAL(PAIR_PAIRED, f.state);
}

static void test_transient_failures_never_tighten_cadence(void) {
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 5));
  pair_fsm_on_poll_response(&f, 429, "{\"error\":\"rate limited\"}", 24, now + 5);
  TEST_ASSERT_EQUAL(PAIR_CODE_ACTIVE, f.state);
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 9));

  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 10));
  pair_fsm_on_transport_error(&f, now + 10);
  TEST_ASSERT_EQUAL(PAIR_CODE_ACTIVE, f.state);
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 14));
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 15));
}

static void test_start_failure_reaches_failed_without_polls(void) {
  int64_t now = 1000;
  pair_fsm_init(&f);
  TEST_ASSERT_TRUE(pair_fsm_start(&f, now));
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_START, pair_fsm_take_action(&f, now));
  pair_fsm_on_start_response(&f, 429, "{\"error\":\"rate limited\"}", 24, now);
  TEST_ASSERT_EQUAL(PAIR_FAILED, f.state);
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 5));

  /* Transport death during start is likewise fatal for that session. */
  pair_fsm_init(&f);
  TEST_ASSERT_TRUE(pair_fsm_start(&f, now));
  pair_fsm_on_transport_error(&f, now);
  TEST_ASSERT_EQUAL(PAIR_FAILED, f.state);
}

static void test_invalid_request_is_fatal_for_the_session(void) {
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 5));
  pair_fsm_on_poll_response(&f, 400, POLL_INVALID, strlen(POLL_INVALID), now + 5);
  TEST_ASSERT_EQUAL(PAIR_FAILED, f.state);
}

static void test_reissue_during_active_session_is_a_redisplay_not_a_restart(void) {
  int64_t now = 1000;
  start_session(now);
  char code_before[PAIR_USER_CODE_LEN];
  memcpy(code_before, f.user_code, sizeof(code_before));

  TEST_ASSERT_FALSE(pair_fsm_start(&f, now + 30));
  TEST_ASSERT_EQUAL(PAIR_CODE_ACTIVE, f.state);
  TEST_ASSERT_EQUAL_STRING(code_before, f.user_code);
}

static void test_dismiss_only_leaves_terminal_states(void) {
  int64_t now = 1000;
  start_session(now);
  pair_fsm_dismiss(&f);
  TEST_ASSERT_EQUAL(PAIR_CODE_ACTIVE, f.state); /* view dismiss ≠ cancel */

  pair_fsm_on_poll_response(&f, 400, POLL_EXPIRED, strlen(POLL_EXPIRED), now + 5);
  TEST_ASSERT_EQUAL(PAIR_EXPIRED, f.state);
  pair_fsm_dismiss(&f);
  TEST_ASSERT_EQUAL(PAIR_IDLE, f.state);
}

static void test_seconds_left_clamps_and_counts(void) {
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL(300, pair_fsm_seconds_left(&f, now));
  TEST_ASSERT_EQUAL(120, pair_fsm_seconds_left(&f, now + 180));
  TEST_ASSERT_EQUAL(0, pair_fsm_seconds_left(&f, now + 400));
}

static void test_next_deadline_tracks_poll_and_grace(void) {
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL(now + 5, pair_fsm_next_deadline(&f));
  pair_fsm_init(&f);
  TEST_ASSERT_EQUAL(0, pair_fsm_next_deadline(&f));
}

static void test_oversized_fields_truncate_not_overflow(void) {
  int64_t now = 1000;
  pair_fsm_init(&f);
  TEST_ASSERT_TRUE(pair_fsm_start(&f, now));
  char big[512];
  int n = snprintf(big, sizeof(big),
                   "{\"device_code\":\"%0200d\",\"user_code\":\"%0100d\",\"expires_in\":300,"
                   "\"interval\":5}",
                   1, 2);
  pair_fsm_on_start_response(&f, 200, big, (size_t)n, now);
  /* ASan proves no overflow; the truncated code simply fails to collect. */
  TEST_ASSERT_EQUAL(PAIR_CODE_ACTIVE, f.state);
  TEST_ASSERT_EQUAL(PAIR_USER_CODE_LEN - 1, (int)strlen(f.user_code));
}

static void test_request_plan_token_beats_override(void) {
  TEST_ASSERT_EQUAL(PAIR_PLAN_POST_AUTH, pair_request_plan(true, true));
  TEST_ASSERT_EQUAL(PAIR_PLAN_POST_AUTH, pair_request_plan(true, false));
  TEST_ASSERT_EQUAL(PAIR_PLAN_GET_FIXED, pair_request_plan(false, true));
  TEST_ASSERT_EQUAL(PAIR_PLAN_POST_ANON, pair_request_plan(false, false));
}

static void test_restart_allowed_after_paired(void) {
  /* Review P1: a token can die after a same-boot pairing (401 revocation or
   * token_clear); `pair` must mint a fresh session without a power cycle. */
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 5));
  pair_fsm_on_poll_response(&f, 200, POLL_TOKEN, strlen(POLL_TOKEN), now + 5);
  TEST_ASSERT_EQUAL(PAIR_PAIRED, f.state);

  TEST_ASSERT_TRUE(pair_fsm_start(&f, now + 60));
  TEST_ASSERT_EQUAL(PAIR_STARTING, f.state);
  TEST_ASSERT_EQUAL_STRING("", f.token);
}

static void test_persist_failure_lands_failed_not_paired(void) {
  /* Review P2: a failed NVS write must not leave the board claiming PAIRED
   * while it runs anonymous; no persist-retry loop may form. */
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 5));
  pair_fsm_on_poll_response(&f, 200, POLL_TOKEN, strlen(POLL_TOKEN), now + 5);
  TEST_ASSERT_EQUAL(PAIR_ACT_PERSIST_TOKEN, pair_fsm_take_action(&f, now + 5));
  pair_fsm_on_persist_result(&f, false);
  TEST_ASSERT_EQUAL(PAIR_FAILED, f.state);
  TEST_ASSERT_EQUAL(PAIR_ACT_NONE, pair_fsm_take_action(&f, now + 10)); /* no loop */
  TEST_ASSERT_TRUE(pair_fsm_start(&f, now + 20)); /* recovery is a fresh pair */

  /* The success path stays PAIRED. */
  start_session(now + 100);
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 105));
  pair_fsm_on_poll_response(&f, 200, POLL_TOKEN, strlen(POLL_TOKEN), now + 105);
  TEST_ASSERT_EQUAL(PAIR_ACT_PERSIST_TOKEN, pair_fsm_take_action(&f, now + 105));
  pair_fsm_on_persist_result(&f, true);
  TEST_ASSERT_EQUAL(PAIR_PAIRED, f.state);
}

static void test_rate_limited_start_sets_the_flag(void) {
  int64_t now = 1000;
  pair_fsm_init(&f);
  TEST_ASSERT_TRUE(pair_fsm_start(&f, now));
  pair_fsm_on_start_response(&f, 429, "{\"error\":\"rate limited\"}", 24, now);
  TEST_ASSERT_EQUAL(PAIR_FAILED, f.state);
  TEST_ASSERT_TRUE(f.rate_limited);
  /* a non-429 failure does not claim the server was busy */
  pair_fsm_init(&f);
  TEST_ASSERT_TRUE(pair_fsm_start(&f, now));
  pair_fsm_on_start_response(&f, 500, "oops", 4, now);
  TEST_ASSERT_EQUAL(PAIR_FAILED, f.state);
  TEST_ASSERT_FALSE(f.rate_limited);
}

static void test_unknown_400_error_keeps_polling(void) {
  /* RFC 8628 forward-compat: an unrecognized error string (e.g. slow_down
   * if the server ever adds it) is not a verdict — keep polling. */
  int64_t now = 1000;
  start_session(now);
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 5));
  pair_fsm_on_poll_response(&f, 400, "{\"error\":\"slow_down\"}", 22, now + 5);
  TEST_ASSERT_EQUAL(PAIR_CODE_ACTIVE, f.state);
  TEST_ASSERT_EQUAL(PAIR_ACT_SEND_POLL, pair_fsm_take_action(&f, now + 10));
}

int main(void) {
  UNITY_BEGIN();
  RUN_TEST(test_restart_allowed_after_paired);
  RUN_TEST(test_persist_failure_lands_failed_not_paired);
  RUN_TEST(test_rate_limited_start_sets_the_flag);
  RUN_TEST(test_unknown_400_error_keeps_polling);
  RUN_TEST(test_request_plan_token_beats_override);
  RUN_TEST(test_happy_path_with_interval_floor);
  RUN_TEST(test_persist_emitted_exactly_once);
  RUN_TEST(test_expired_token_ends_session_and_restart_is_fresh);
  RUN_TEST(test_local_deadline_polls_through_delivery_grace);
  RUN_TEST(test_grace_exhaustion_expires_without_server_verdict);
  RUN_TEST(test_malformed_200_is_transient);
  RUN_TEST(test_transient_failures_never_tighten_cadence);
  RUN_TEST(test_start_failure_reaches_failed_without_polls);
  RUN_TEST(test_invalid_request_is_fatal_for_the_session);
  RUN_TEST(test_reissue_during_active_session_is_a_redisplay_not_a_restart);
  RUN_TEST(test_dismiss_only_leaves_terminal_states);
  RUN_TEST(test_seconds_left_clamps_and_counts);
  RUN_TEST(test_next_deadline_tracks_poll_and_grace);
  RUN_TEST(test_oversized_fields_truncate_not_overflow);
  return UNITY_END();
}
