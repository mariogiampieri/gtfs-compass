/*
 * model.h — the /v1/nearby response as fixed-size value structs.
 *
 * This component is deliberately platform-free: no LVGL, no ESP-IDF, no
 * FreeRTOS includes (the simulator build enforces it). Structs are value
 * types with no heap ownership, so a parsed model crosses the network→UI
 * task boundary by copy and feeds host tests and the simulator identically.
 *
 * Sizing mirrors the API contract's real caps (api/src/nearby.ts:
 * STOPS_PER_SYSTEM=5, ARRIVALS_PER_DIRECTION=8, ALERT_TEXT_MAX=200) plus
 * MODEL_MAX_TRUNKS=8 — the API does not cap trunks per stop, 8 covers NYC's
 * busiest color groupings, and trunks 5..8 feed the overflow bullet tray.
 */
#ifndef GTFS_COMPASS_MODEL_H
#define GTFS_COMPASS_MODEL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define MODEL_MAX_STOPS 5
#define MODEL_MAX_TRUNKS 8
#define MODEL_MAX_ROUTES_PER_TRUNK 6
#define MODEL_MAX_ARRIVALS 8
#define MODEL_MAX_BIKE_STATIONS 5

#define MODEL_NAME_LEN 48        /* station names ("Station Number 5 With A Long Name") */
#define MODEL_HEADSIGN_LEN 40    /* "Far Rockaway-Mott Av" */
#define MODEL_ROUTE_LABEL_LEN 10 /* "M15-SBS" + margin */
#define MODEL_DISTANCE_LEN 12    /* "2.4 mi" / "460 ft" */
#define MODEL_ALERT_TEXT_LEN 224 /* API truncates at ~200; margin for the ellipsis */
#define MODEL_DIR_LABEL_LEN 16   /* "Downtown" */
#define MODEL_UNITS_LEN 10       /* "imperial" */

typedef enum {
  MODEL_SHAPE_CIRCLE = 0,
  MODEL_SHAPE_PILL,
  MODEL_SHAPE_DISC,
} model_shape_t;

typedef enum {
  MODEL_ALERT_NONE = 0,
  MODEL_ALERT_INFO,
  MODEL_ALERT_DELAY,
} model_alert_severity_t;

typedef struct {
  char label[MODEL_ROUTE_LABEL_LEN];
  model_shape_t shape;
} model_route_t;

typedef struct {
  char route[MODEL_ROUTE_LABEL_LEN];
  char headsign[MODEL_HEADSIGN_LEN]; /* "" when the API sent null */
  int16_t eta_min;
} model_arrival_t;

typedef struct {
  model_arrival_t arrivals[MODEL_MAX_ARRIVALS];
  uint8_t arrival_count;
} model_direction_t;

typedef struct {
  model_alert_severity_t severity;
  char text[MODEL_ALERT_TEXT_LEN];
  /* bit 0 = direction 0, bit 1 = direction 1 */
  uint8_t directions_mask;
} model_alert_t;

typedef struct {
  uint32_t color;      /* 0xRRGGBB */
  uint32_t text_color; /* 0xRRGGBB */
  model_route_t routes[MODEL_MAX_ROUTES_PER_TRUNK];
  uint8_t route_count;
  model_alert_t alert; /* severity == MODEL_ALERT_NONE when null */
  model_direction_t directions[2];
} model_trunk_t;

typedef struct {
  char name[MODEL_NAME_LEN];
  char distance_label[MODEL_DISTANCE_LEN];
  model_trunk_t trunks[MODEL_MAX_TRUNKS];
  uint8_t trunk_count;
  uint8_t trunks_clamped; /* how many the API sent beyond MODEL_MAX_TRUNKS */
} model_stop_t;

typedef struct {
  char name[MODEL_NAME_LEN];
  char distance_label[MODEL_DISTANCE_LEN];
  /* -1 = unknown (status source down); >=0 = real count (0 = actually empty) */
  int16_t bikes_classic;
  int16_t bikes_electric;
  int16_t docks_open;
  int16_t capacity; /* -1 when the feed had none */
} model_bike_station_t;

typedef struct {
  bool present;  /* the mode appeared in systems[] */
  bool no_data;  /* fetched_at was null: never fetched, distinct from empty */
  bool partial;  /* arrivals data incomplete (M1: parsed + logged, not rendered) */
  int64_t fetched_at; /* epoch seconds; 0 when no_data */
  char direction_labels[2][MODEL_DIR_LABEL_LEN]; /* "" when null (compass-tag feeds) */
  model_stop_t stops[MODEL_MAX_STOPS];
  uint8_t stop_count;
  char nearest_distance_label[MODEL_DISTANCE_LEN]; /* "" unless empty-with-nearest */
} model_rail_system_t;

typedef struct {
  bool present;
  bool no_data;
  bool partial;
  int64_t fetched_at;
  model_bike_station_t stations[MODEL_MAX_BIKE_STATIONS];
  uint8_t station_count;
  char nearest_distance_label[MODEL_DISTANCE_LEN];
} model_bike_system_t;

typedef struct {
  model_rail_system_t rail;
  model_bike_system_t bike;
  bool bus_present; /* configured-empty in v1; presence only */
  char units[MODEL_UNITS_LEN];
  /* Top-level location echo — debug logging only in M1, never rendered. */
  double loc_lat;
  double loc_lon;
  double loc_accuracy; /* -1 when the API sent null (GET path) */
} model_nearby_t;

typedef enum {
  MODEL_PARSE_OK = 0,
  MODEL_PARSE_ERR_JSON,  /* body is not valid JSON */
  MODEL_PARSE_ERR_SHAPE, /* JSON but not a nearby response */
} model_parse_result_t;

/*
 * Parse a /v1/nearby body into *out (fully overwritten; zeroed first).
 * Never allocates into *out; the cJSON tree is freed before returning on
 * every path. Unknown fields are ignored (forward compatibility). Over-cap
 * collections are clamped and counted, never overflowed.
 */
model_parse_result_t model_parse_nearby(const char *buf, size_t len, model_nearby_t *out);

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_MODEL_H */
