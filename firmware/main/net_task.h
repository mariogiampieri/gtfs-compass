#ifndef GC_NET_TASK_H
#define GC_NET_TASK_H

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "model.h"
#include "pair_fsm.h"

typedef enum {
  GC_NET_OK = 0,
  GC_NET_OFFLINE,     /* fetch/scan/parse failed */
  GC_NET_NO_LOCATION, /* API 422 */
  GC_NET_NO_CREDS,    /* nothing in NVS — console provisioning needed */
  GC_NET_AUTH_REVOKED, /* internal to net_task (401): never published — the
                          loop clears the token and refetches anonymously */
} gc_net_status_t;

/*
 * Two length-1 overwrite queues, one per state dimension (review fix: a
 * single queue carrying both meant a pairing publish could displace an
 * unconsumed fetch result, silently dropping a fresh model for up to 30 s).
 * With separate channels, a message only ever displaces an older message of
 * its own kind — latest-wins is then correct by construction.
 */

/* Fetch outcomes. */
typedef struct {
  gc_net_status_t status;
  /* Non-NULL only when THIS message carries a fresh successful fetch; points
   * at a PSRAM buffer the net task will not touch again until after the NEXT
   * successful fetch — the consumer must copy before then (it copies
   * immediately). */
  model_nearby_t *model;
} gc_net_msg_t;

/* Pairing snapshot + identity marker. seconds_left is a point-in-time value;
 * the UI decrements locally (the departures minutes convention). */
typedef struct {
  pair_state_t phase;
  char code[PAIR_USER_CODE_LEN];
  int32_t seconds_left;
  /* Bumps on every console `pair` — the UI clears its view-dismissal on a
   * bump, which is what makes re-issuing `pair` re-display a live code. */
  uint8_t epoch;
  /* A start was refused 429: the FAILED screen says "server busy". */
  bool rate_limited;
  /* The revoked marker: a token died since the last successful pair (plan
   * R11) — rendered distinct from never-paired. */
  bool unpaired;
} gc_pair_msg_t;

/* Start WiFi + the polling task; returns the fetch-outcome queue. */
QueueHandle_t gc_net_start(void);
/* The pairing-snapshot queue; valid after gc_net_start returns. */
QueueHandle_t gc_net_pair_queue(void);

/*
 * Console/UI → net_task commands. Safe from any task context: they set a
 * flag and wake the net task's interruptible wait. `pair` during an active
 * session re-displays the live code (never burns it); dismiss leaves a
 * terminal EXPIRED/FAILED screen; token_dropped tells the loop the console
 * cleared NVS so the in-RAM token must go too.
 */
void gc_net_pair_request(void);
void gc_net_pair_dismiss(void);
void gc_net_token_dropped(void);

#endif
