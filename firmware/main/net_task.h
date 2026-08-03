#ifndef GC_NET_TASK_H
#define GC_NET_TASK_H

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "model.h"

typedef enum {
  GC_NET_OK = 0,
  GC_NET_OFFLINE,     /* fetch/scan/parse failed */
  GC_NET_NO_LOCATION, /* API 422 */
  GC_NET_NO_CREDS,    /* nothing in NVS — console provisioning needed */
} gc_net_status_t;

typedef struct {
  gc_net_status_t status;
  /* Valid only when status == GC_NET_OK; points at a PSRAM buffer the net
   * task will not touch again until after the NEXT successful fetch — the
   * consumer must copy before then (it copies immediately). */
  model_nearby_t *model;
} gc_net_msg_t;

/* Start WiFi + the polling task; returns the length-1 overwrite queue. */
QueueHandle_t gc_net_start(void);

#endif
