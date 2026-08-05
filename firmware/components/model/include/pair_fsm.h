/*
 * pair_fsm.h — the RFC 8628 device-authorization client as a pure state
 * machine (pairing plan U2).
 *
 * Platform-free by the same rule as model.h: no LVGL, no ESP-IDF, no
 * FreeRTOS. The FSM owns protocol state, timing decisions, and wire-body
 * parsing; net_task executes the actions it emits (HTTP calls, NVS writes)
 * and feeds results back. Everything time-based takes `now` (seconds,
 * monotonic or epoch — only differences are used) so host tests drive the
 * clock.
 *
 * Server contract (api/src/routes/pair.ts, deployed):
 *   start 200 → {device_code, user_code:"XXXX-XXXX", verification_uri,
 *                expires_in:300, interval:5};  429 → {error:"rate limited"}
 *   poll  200 → {access_token:"gtfsc_dev_…", token_type, device_id, scopes[]}
 *   poll  400 → {error:"authorization_pending" | "expired_token" |
 *                "invalid_request"}   (RFC 8628 §3.5; no slow_down today)
 *
 * The local `expires_in` deadline is a backstop, not a verdict: the server
 * extends collection by 120 s once the code is claimed (PAIR_DELIVERY_TTL_S),
 * so a last-second browser approval still pairs. The FSM keeps polling
 * through that grace window and expires only on the server's `expired_token`
 * or grace exhaustion.
 */
#ifndef GTFS_COMPASS_PAIR_FSM_H
#define GTFS_COMPASS_PAIR_FSM_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* "XXXX-XXXX" + NUL, with margin. */
#define PAIR_USER_CODE_LEN 12
/* base64url(32 bytes) is 43 chars; margin against server-side changes. */
#define PAIR_DEVICE_CODE_LEN 64
/* "gtfsc_dev_" + 43-char base64url + NUL, with margin. */
#define PAIR_TOKEN_LEN 64
/* Server's PAIR_DELIVERY_TTL_S: how long a claimed code stays collectable. */
#define PAIR_DELIVERY_GRACE_S 120
/* Fallback cadence if a start response ever omits/zeroes `interval`. */
#define PAIR_DEFAULT_INTERVAL_S 5

typedef enum {
  PAIR_IDLE = 0,   /* no session; board runs anonymously or with its token */
  PAIR_STARTING,   /* start requested; POST /pair/start not yet answered */
  PAIR_CODE_ACTIVE, /* code on screen, polling for the token */
  PAIR_PAIRED,     /* token received (terminal; persist action emitted once) */
  PAIR_EXPIRED,    /* server said expired_token, or deadline + grace passed */
  PAIR_FAILED,     /* start failed, or the server called our poll malformed */
} pair_state_t;

typedef enum {
  PAIR_ACT_NONE = 0,
  PAIR_ACT_SEND_START,   /* POST /v1/device/pair/start */
  PAIR_ACT_SEND_POLL,    /* POST /v1/device/pair/poll, Bearer device_code */
  PAIR_ACT_PERSIST_TOKEN, /* write .token to NVS; clear the revoked marker */
} pair_action_t;

typedef struct {
  pair_state_t state;
  char user_code[PAIR_USER_CODE_LEN];     /* display-formatted, dash included */
  char device_code[PAIR_DEVICE_CODE_LEN]; /* secret: never displayed/logged */
  char token[PAIR_TOKEN_LEN];             /* valid once state == PAIR_PAIRED */
  int32_t interval_s;   /* advertised poll floor */
  int64_t deadline;     /* start-time now + expires_in */
  int64_t next_poll_at; /* earliest moment the next poll may fire */
  bool persist_emitted; /* PAIR_ACT_PERSIST_TOKEN handed out exactly once */
} pair_fsm_t;

void pair_fsm_init(pair_fsm_t *f);

/*
 * The console `pair` command. From IDLE/EXPIRED/FAILED begins a fresh
 * session and returns true. From CODE_ACTIVE returns false — the caller
 * re-displays the live code rather than burning it (plan: re-issuing `pair`
 * never starts a second session). From STARTING/PAIRED also a false no-op.
 */
bool pair_fsm_start(pair_fsm_t *f, int64_t now);

/* Leave a terminal EXPIRED/FAILED screen. No-op in any other state —
 * dismissing the *view* of an active session never cancels the session. */
void pair_fsm_dismiss(pair_fsm_t *f);

/*
 * The one scheduler entry point: what should net_task do right now?
 * Consuming semantics — a returned SEND_POLL advances next_poll_at and a
 * returned PERSIST_TOKEN latches persist_emitted, so asking twice never
 * doubles an action. Also where deadline + grace exhaustion is enforced.
 */
pair_action_t pair_fsm_take_action(pair_fsm_t *f, int64_t now);

/* Transport results. status is the HTTP status; body may be NULL on
 * transport failure (use pair_fsm_on_transport_error instead when the
 * request never completed). */
void pair_fsm_on_start_response(pair_fsm_t *f, int status, const char *body, size_t len,
                                int64_t now);
void pair_fsm_on_poll_response(pair_fsm_t *f, int status, const char *body, size_t len,
                               int64_t now);
/* The request never reached the server (join lost, DNS, TLS). Transient
 * during CODE_ACTIVE; fatal for a start that never got its code. */
void pair_fsm_on_transport_error(pair_fsm_t *f, int64_t now);

/* When net_task should next wake for this FSM (poll due / grace expiry),
 * or 0 when the FSM needs no wakeup (IDLE and terminal states). */
int64_t pair_fsm_next_deadline(const pair_fsm_t *f);

/* Seconds of code validity left to render, clamped at 0. */
int32_t pair_fsm_seconds_left(const pair_fsm_t *f, int64_t now);

/*
 * The request-path decision for a nearby fetch (plan U4, R9): a stored token
 * expresses intent to use server-side resolution, so it beats the dev
 * fixed-location override; the override applies only to unpaired boards.
 */
typedef enum {
  PAIR_PLAN_POST_AUTH = 0, /* POST scan body + Authorization: Bearer */
  PAIR_PLAN_GET_FIXED,     /* GET ?lat=&lon= — unpaired dev override */
  PAIR_PLAN_POST_ANON,     /* POST scan body, no credential */
} pair_request_plan_t;

pair_request_plan_t pair_request_plan(bool token_present, bool override_set);

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_PAIR_FSM_H */
