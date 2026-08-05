/*
 * pair_fsm.c — RFC 8628 client state machine (pairing plan U2).
 *
 * Pure and platform-free; see pair_fsm.h for the contract. cJSON is the
 * same vendored parser model.c uses, with the same bounded-copy discipline:
 * every string lands via copy_bounded and oversize input truncates rather
 * than overflows (an oversized device_code then simply fails to collect,
 * which is the fail-closed direction).
 */
#include "pair_fsm.h"

#include <string.h>

#include "cJSON.h"

static void copy_bounded(char *dst, size_t cap, const char *src) {
  size_t n = strlen(src);
  if (n >= cap) n = cap - 1;
  memcpy(dst, src, n);
  dst[n] = '\0';
}

void pair_fsm_init(pair_fsm_t *f) {
  memset(f, 0, sizeof(*f));
  f->state = PAIR_IDLE;
}

bool pair_fsm_start(pair_fsm_t *f, int64_t now) {
  (void)now;
  switch (f->state) {
    case PAIR_IDLE:
    case PAIR_EXPIRED:
    case PAIR_FAILED: {
      pair_fsm_init(f);
      f->state = PAIR_STARTING;
      return true;
    }
    default:
      /* CODE_ACTIVE: caller re-displays the live code. STARTING/PAIRED: no-op. */
      return false;
  }
}

void pair_fsm_dismiss(pair_fsm_t *f) {
  if (f->state == PAIR_EXPIRED || f->state == PAIR_FAILED) {
    pair_fsm_init(f);
  }
}

pair_action_t pair_fsm_take_action(pair_fsm_t *f, int64_t now) {
  switch (f->state) {
    case PAIR_STARTING:
      /* Emitted every call while STARTING; net_task performs the request
       * synchronously and answers before asking again, so this cannot
       * double-send. */
      return PAIR_ACT_SEND_START;
    case PAIR_CODE_ACTIVE:
      if (now >= f->deadline + PAIR_DELIVERY_GRACE_S) {
        /* Grace exhausted with no server verdict: the code row is gone
         * either way; stop spending polls. */
        f->state = PAIR_EXPIRED;
        return PAIR_ACT_NONE;
      }
      if (now >= f->next_poll_at) {
        f->next_poll_at = now + f->interval_s; /* floor, re-floored on answer */
        return PAIR_ACT_SEND_POLL;
      }
      return PAIR_ACT_NONE;
    case PAIR_PAIRED:
      if (!f->persist_emitted) {
        f->persist_emitted = true;
        return PAIR_ACT_PERSIST_TOKEN;
      }
      return PAIR_ACT_NONE;
    default:
      return PAIR_ACT_NONE;
  }
}

void pair_fsm_on_start_response(pair_fsm_t *f, int status, const char *body, size_t len,
                                int64_t now) {
  if (f->state != PAIR_STARTING) return;
  if (status != 200 || body == NULL) {
    f->state = PAIR_FAILED;
    return;
  }
  cJSON *root = cJSON_ParseWithLength(body, len);
  const cJSON *user = cJSON_GetObjectItemCaseSensitive(root, "user_code");
  const cJSON *dev = cJSON_GetObjectItemCaseSensitive(root, "device_code");
  const cJSON *exp = cJSON_GetObjectItemCaseSensitive(root, "expires_in");
  const cJSON *itv = cJSON_GetObjectItemCaseSensitive(root, "interval");
  if (!cJSON_IsString(user) || !cJSON_IsString(dev) || !cJSON_IsNumber(exp)) {
    cJSON_Delete(root);
    f->state = PAIR_FAILED;
    return;
  }
  copy_bounded(f->user_code, sizeof(f->user_code), user->valuestring);
  copy_bounded(f->device_code, sizeof(f->device_code), dev->valuestring);
  f->interval_s = cJSON_IsNumber(itv) && itv->valueint > 0 ? itv->valueint
                                                           : PAIR_DEFAULT_INTERVAL_S;
  f->deadline = now + (int64_t)exp->valuedouble;
  f->next_poll_at = now + f->interval_s;
  f->state = PAIR_CODE_ACTIVE;
  cJSON_Delete(root);
}

/* The poll's 400 bodies carry {"error": "..."} (RFC 8628 §3.5). */
typedef enum { POLL_ERR_PENDING, POLL_ERR_EXPIRED, POLL_ERR_INVALID, POLL_ERR_OTHER } poll_err_t;

static poll_err_t classify_poll_error(const char *body, size_t len) {
  poll_err_t out = POLL_ERR_OTHER;
  cJSON *root = cJSON_ParseWithLength(body, len);
  const cJSON *err = cJSON_GetObjectItemCaseSensitive(root, "error");
  if (cJSON_IsString(err)) {
    if (strcmp(err->valuestring, "authorization_pending") == 0) out = POLL_ERR_PENDING;
    else if (strcmp(err->valuestring, "expired_token") == 0) out = POLL_ERR_EXPIRED;
    else if (strcmp(err->valuestring, "invalid_request") == 0) out = POLL_ERR_INVALID;
  }
  cJSON_Delete(root);
  return out;
}

void pair_fsm_on_poll_response(pair_fsm_t *f, int status, const char *body, size_t len,
                               int64_t now) {
  if (f->state != PAIR_CODE_ACTIVE) return;
  /* Whatever happens, never poll faster than the advertised floor. */
  f->next_poll_at = now + f->interval_s;

  if (status == 200 && body != NULL) {
    cJSON *root = cJSON_ParseWithLength(body, len);
    const cJSON *tok = cJSON_GetObjectItemCaseSensitive(root, "access_token");
    if (cJSON_IsString(tok) && tok->valuestring[0] != '\0') {
      copy_bounded(f->token, sizeof(f->token), tok->valuestring);
      f->state = PAIR_PAIRED;
    }
    /* 200 with a malformed or token-less body: a proxy hiccup, not a
     * verdict — stay CODE_ACTIVE and keep polling. */
    cJSON_Delete(root);
    return;
  }
  if (status == 400 && body != NULL) {
    switch (classify_poll_error(body, len)) {
      case POLL_ERR_EXPIRED:
        f->state = PAIR_EXPIRED;
        return;
      case POLL_ERR_INVALID:
        /* The server called our request malformed — a client bug a retry
         * cannot fix. Fail loudly; a fresh `pair` is the recovery. */
        f->state = PAIR_FAILED;
        return;
      case POLL_ERR_PENDING:
      case POLL_ERR_OTHER:
        return; /* keep polling */
    }
  }
  /* 429, 5xx, unparseable: transient — keep polling at the floor. */
}

void pair_fsm_on_transport_error(pair_fsm_t *f, int64_t now) {
  switch (f->state) {
    case PAIR_STARTING:
      f->state = PAIR_FAILED;
      return;
    case PAIR_CODE_ACTIVE:
      f->next_poll_at = now + f->interval_s;
      return;
    default:
      return;
  }
}

int64_t pair_fsm_next_deadline(const pair_fsm_t *f) {
  switch (f->state) {
    case PAIR_STARTING:
      return 1; /* immediately actionable */
    case PAIR_CODE_ACTIVE: {
      int64_t grace_end = f->deadline + PAIR_DELIVERY_GRACE_S;
      return f->next_poll_at < grace_end ? f->next_poll_at : grace_end;
    }
    case PAIR_PAIRED:
      return f->persist_emitted ? 0 : 1;
    default:
      return 0;
  }
}

int32_t pair_fsm_seconds_left(const pair_fsm_t *f, int64_t now) {
  if (f->state != PAIR_CODE_ACTIVE) return 0;
  int64_t left = f->deadline - now;
  return left > 0 ? (int32_t)left : 0;
}

pair_request_plan_t pair_request_plan(bool token_present, bool override_set) {
  if (token_present) return PAIR_PLAN_POST_AUTH; /* token beats override (R9) */
  if (override_set) return PAIR_PLAN_GET_FIXED;
  return PAIR_PLAN_POST_ANON;
}
