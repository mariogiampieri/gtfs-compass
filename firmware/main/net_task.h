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
  GC_NET_KEEP,        /* pairing-only publish: leave the conn state as-is */
  GC_NET_AUTH_REVOKED, /* internal to net_task (401): never published — the
                          loop clears the token and refetches anonymously */
} gc_net_status_t;

/*
 * Full-snapshot queue contract (pairing plan U3): the channel is a length-1
 * overwrite queue, so two publishes in one loop pass destroy the first.
 * Every message therefore carries the complete current state — net status,
 * model (when fresh), pairing snapshot, and the unpaired marker — so an
 * overwritten message loses nothing.
 */
typedef struct {
  gc_net_status_t status; /* GC_NET_KEEP when no fetch outcome rides along */
  /* Non-NULL only when THIS message carries a fresh successful fetch; points
   * at a PSRAM buffer the net task will not touch again until after the NEXT
   * successful fetch — the consumer must copy before then (it copies
   * immediately). Never re-published for pairing-only messages: re-applying
   * an old model would reset staleness accounting the honesty rules forbid. */
  model_nearby_t *model;
  /* Pairing snapshot (always valid). seconds_left is a point-in-time value;
   * the UI decrements locally from it (the departures minutes convention). */
  pair_state_t pair_phase;
  char pair_code[PAIR_USER_CODE_LEN];
  int32_t pair_seconds_left;
  /* Bumps on every console `pair` command — the UI clears its view-dismissal
   * on a bump, which is what makes re-issuing `pair` re-display a live code. */
  uint8_t pair_epoch;
  /* The revoked marker: a token died since the last successful pair. Renders
   * as the unpaired chip state, distinct from never-paired (plan R11). */
  bool unpaired;
} gc_net_msg_t;

/* Start WiFi + the polling task; returns the length-1 overwrite queue. */
QueueHandle_t gc_net_start(void);

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
