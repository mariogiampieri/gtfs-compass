/*
 * model.c — /v1/nearby JSON → model_nearby_t.
 *
 * cJSON is vendored (firmware/third_party/cjson, pinned 1.7.18) and used on
 * both host and device — this also sidesteps ESP-IDF 6.0's removal of the
 * bundled json component. Pattern per the plan: parse, copy into fixed
 * fields, free the tree in one exit path; never store pointers into the
 * tree; every field access is null-checked (the Worker is ours, the network
 * is not).
 */
#include "model.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"

/* strlcpy is BSD/macOS + ESP-IDF (libbsd-style); provide a fallback. */
static void copy_str(char *dst, size_t cap, const cJSON *item) {
  dst[0] = '\0';
  if (!cJSON_IsString(item) || item->valuestring == NULL) return;
  size_t n = strlen(item->valuestring);
  if (n >= cap) n = cap - 1;
  memcpy(dst, item->valuestring, n);
  dst[n] = '\0';
}

static uint32_t parse_color(const cJSON *item) {
  if (!cJSON_IsString(item) || item->valuestring == NULL) return 0;
  const char *s = item->valuestring;
  if (s[0] == '#') s++;
  uint32_t v = 0;
  for (int i = 0; i < 6 && s[i]; i++) {
    char c = s[i];
    uint32_t d;
    if (c >= '0' && c <= '9') d = (uint32_t)(c - '0');
    else if (c >= 'a' && c <= 'f') d = (uint32_t)(c - 'a' + 10);
    else if (c >= 'A' && c <= 'F') d = (uint32_t)(c - 'A' + 10);
    else return 0;
    v = (v << 4) | d;
  }
  return v;
}

static model_shape_t parse_shape(const cJSON *item) {
  if (cJSON_IsString(item) && item->valuestring) {
    if (strcmp(item->valuestring, "pill") == 0) return MODEL_SHAPE_PILL;
    if (strcmp(item->valuestring, "disc") == 0) return MODEL_SHAPE_DISC;
  }
  return MODEL_SHAPE_CIRCLE;
}

/* null / absent / non-number → fallback */
static int32_t number_or(const cJSON *item, int32_t fallback) {
  return cJSON_IsNumber(item) ? (int32_t)item->valuedouble : fallback;
}

/* "2026-08-03T04:02:43Z" → epoch seconds (UTC only); 0 on any mismatch.
 * Days-from-civil per Howard Hinnant's algorithm — no timegm on all libcs. */
static int64_t parse_iso_utc(const cJSON *item) {
  if (!cJSON_IsString(item) || item->valuestring == NULL) return 0;
  int y, mo, d, h, mi, s;
  if (sscanf(item->valuestring, "%d-%d-%dT%d:%d:%d", &y, &mo, &d, &h, &mi, &s) != 6) return 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
  int64_t yy = y - (mo <= 2 ? 1 : 0);
  int64_t era = (yy >= 0 ? yy : yy - 399) / 400;
  int64_t yoe = yy - era * 400;
  int64_t doy = (153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  int64_t doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  int64_t days = era * 146097 + doe - 719468;
  return days * 86400 + h * 3600 + mi * 60 + s;
}

/* generated_at - fetched_at, clamped; -1 when either side is unknown. */
static int32_t initial_age(int64_t generated_at, int64_t fetched_at, bool no_data) {
  if (no_data || generated_at <= 0 || fetched_at <= 0) return -1;
  int64_t age = generated_at - fetched_at;
  if (age < 0) age = 0;
  return age > INT32_MAX ? INT32_MAX : (int32_t)age;
}

static void parse_alert(const cJSON *alert, model_alert_t *out) {
  memset(out, 0, sizeof(*out));
  if (!cJSON_IsObject(alert)) return; /* null or absent → NONE */
  const cJSON *sev = cJSON_GetObjectItemCaseSensitive(alert, "severity");
  if (cJSON_IsString(sev) && sev->valuestring && strcmp(sev->valuestring, "delay") == 0) {
    out->severity = MODEL_ALERT_DELAY;
  } else {
    out->severity = MODEL_ALERT_INFO;
  }
  copy_str(out->text, sizeof(out->text), cJSON_GetObjectItemCaseSensitive(alert, "text"));
  const cJSON *dirs = cJSON_GetObjectItemCaseSensitive(alert, "directions");
  const cJSON *d;
  cJSON_ArrayForEach(d, dirs) {
    if (cJSON_IsNumber(d)) {
      int v = (int)d->valuedouble;
      if (v == 0) out->directions_mask |= 0x1;
      if (v == 1) out->directions_mask |= 0x2;
    }
  }
  if (out->directions_mask == 0) out->directions_mask = 0x3; /* no selectors → both */
}

static void parse_trunk(const cJSON *trunk, model_trunk_t *out) {
  memset(out, 0, sizeof(*out));
  out->color = parse_color(cJSON_GetObjectItemCaseSensitive(trunk, "color"));
  out->text_color = parse_color(cJSON_GetObjectItemCaseSensitive(trunk, "text_color"));

  const cJSON *routes = cJSON_GetObjectItemCaseSensitive(trunk, "routes");
  const cJSON *r;
  cJSON_ArrayForEach(r, routes) {
    if (!cJSON_IsObject(r) || out->route_count >= MODEL_MAX_ROUTES_PER_TRUNK) continue;
    model_route_t *route = &out->routes[out->route_count];
    copy_str(route->label, sizeof(route->label), cJSON_GetObjectItemCaseSensitive(r, "label"));
    route->shape = parse_shape(cJSON_GetObjectItemCaseSensitive(r, "shape"));
    out->route_count++;
  }

  parse_alert(cJSON_GetObjectItemCaseSensitive(trunk, "alert"), &out->alert);

  const cJSON *dirs = cJSON_GetObjectItemCaseSensitive(trunk, "directions");
  const cJSON *d;
  cJSON_ArrayForEach(d, dirs) {
    if (!cJSON_IsObject(d)) continue;
    int32_t dir_id = number_or(cJSON_GetObjectItemCaseSensitive(d, "direction_id"), -1);
    if (dir_id != 0 && dir_id != 1) continue;
    model_direction_t *dst = &out->directions[dir_id];
    const cJSON *arrivals = cJSON_GetObjectItemCaseSensitive(d, "arrivals");
    const cJSON *a;
    cJSON_ArrayForEach(a, arrivals) {
      if (!cJSON_IsObject(a) || dst->arrival_count >= MODEL_MAX_ARRIVALS) continue;
      model_arrival_t *arr = &dst->arrivals[dst->arrival_count];
      copy_str(arr->route, sizeof(arr->route), cJSON_GetObjectItemCaseSensitive(a, "route"));
      copy_str(arr->headsign, sizeof(arr->headsign),
               cJSON_GetObjectItemCaseSensitive(a, "headsign")); /* null → "" */
      arr->eta_min = (int16_t)number_or(cJSON_GetObjectItemCaseSensitive(a, "eta_min"), 0);
      dst->arrival_count++;
    }
  }
}

static void parse_rail_system(const cJSON *sys, model_rail_system_t *out) {
  out->present = true;
  const cJSON *fetched = cJSON_GetObjectItemCaseSensitive(sys, "fetched_at");
  if (cJSON_IsNumber(fetched)) {
    out->fetched_at = (int64_t)fetched->valuedouble;
  } else {
    out->no_data = true;
  }
  out->partial = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(sys, "partial"));

  const cJSON *labels = cJSON_GetObjectItemCaseSensitive(sys, "direction_labels");
  if (cJSON_IsArray(labels)) {
    for (int i = 0; i < 2; i++) {
      copy_str(out->direction_labels[i], MODEL_DIR_LABEL_LEN, cJSON_GetArrayItem(labels, i));
    }
  }
  copy_str(out->nearest_distance_label, sizeof(out->nearest_distance_label),
           cJSON_GetObjectItemCaseSensitive(sys, "nearest_distance_label"));

  const cJSON *stops = cJSON_GetObjectItemCaseSensitive(sys, "stops");
  const cJSON *s;
  cJSON_ArrayForEach(s, stops) {
    if (!cJSON_IsObject(s) || out->stop_count >= MODEL_MAX_STOPS) continue;
    model_stop_t *stop = &out->stops[out->stop_count];
    memset(stop, 0, sizeof(*stop));
    copy_str(stop->name, sizeof(stop->name), cJSON_GetObjectItemCaseSensitive(s, "name"));
    copy_str(stop->distance_label, sizeof(stop->distance_label),
             cJSON_GetObjectItemCaseSensitive(s, "distance_label"));
    const cJSON *trunks = cJSON_GetObjectItemCaseSensitive(s, "trunks");
    const cJSON *t;
    cJSON_ArrayForEach(t, trunks) {
      if (!cJSON_IsObject(t)) continue;
      if (stop->trunk_count >= MODEL_MAX_TRUNKS) {
        stop->trunks_clamped++;
        continue;
      }
      parse_trunk(t, &stop->trunks[stop->trunk_count]);
      stop->trunk_count++;
    }
    out->stop_count++;
  }
}

static void parse_bike_system(const cJSON *sys, model_bike_system_t *out) {
  out->present = true;
  const cJSON *fetched = cJSON_GetObjectItemCaseSensitive(sys, "fetched_at");
  if (cJSON_IsNumber(fetched)) {
    out->fetched_at = (int64_t)fetched->valuedouble;
  } else {
    out->no_data = true;
  }
  out->partial = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(sys, "partial"));
  copy_str(out->nearest_distance_label, sizeof(out->nearest_distance_label),
           cJSON_GetObjectItemCaseSensitive(sys, "nearest_distance_label"));

  const cJSON *stations = cJSON_GetObjectItemCaseSensitive(sys, "stations");
  const cJSON *s;
  cJSON_ArrayForEach(s, stations) {
    if (!cJSON_IsObject(s) || out->station_count >= MODEL_MAX_BIKE_STATIONS) continue;
    model_bike_station_t *st = &out->stations[out->station_count];
    memset(st, 0, sizeof(*st));
    copy_str(st->name, sizeof(st->name), cJSON_GetObjectItemCaseSensitive(s, "name"));
    copy_str(st->distance_label, sizeof(st->distance_label),
             cJSON_GetObjectItemCaseSensitive(s, "distance_label"));
    st->bikes_classic = (int16_t)number_or(cJSON_GetObjectItemCaseSensitive(s, "bikes_classic"), -1);
    st->bikes_electric =
        (int16_t)number_or(cJSON_GetObjectItemCaseSensitive(s, "bikes_electric"), -1);
    st->docks_open = (int16_t)number_or(cJSON_GetObjectItemCaseSensitive(s, "docks_open"), -1);
    st->capacity = (int16_t)number_or(cJSON_GetObjectItemCaseSensitive(s, "capacity"), -1);
    out->station_count++;
  }
}

model_parse_result_t model_parse_nearby(const char *buf, size_t len, model_nearby_t *out) {
  memset(out, 0, sizeof(*out));
  out->loc_accuracy = -1.0;

  cJSON *root = cJSON_ParseWithLength(buf, len);
  if (root == NULL) return MODEL_PARSE_ERR_JSON;

  model_parse_result_t result = MODEL_PARSE_ERR_SHAPE;
  const cJSON *systems = cJSON_GetObjectItemCaseSensitive(root, "systems");
  if (!cJSON_IsObject(root) || !cJSON_IsArray(systems)) goto cleanup;

  copy_str(out->units, sizeof(out->units), cJSON_GetObjectItemCaseSensitive(root, "units"));
  out->generated_at = parse_iso_utc(cJSON_GetObjectItemCaseSensitive(root, "generated_at"));

  const cJSON *loc = cJSON_GetObjectItemCaseSensitive(root, "location");
  if (cJSON_IsObject(loc)) {
    const cJSON *lat = cJSON_GetObjectItemCaseSensitive(loc, "lat");
    const cJSON *lon = cJSON_GetObjectItemCaseSensitive(loc, "lon");
    const cJSON *acc = cJSON_GetObjectItemCaseSensitive(loc, "accuracy");
    if (cJSON_IsNumber(lat)) out->loc_lat = lat->valuedouble;
    if (cJSON_IsNumber(lon)) out->loc_lon = lon->valuedouble;
    if (cJSON_IsNumber(acc)) out->loc_accuracy = acc->valuedouble;
  }

  const cJSON *sys;
  cJSON_ArrayForEach(sys, systems) {
    if (!cJSON_IsObject(sys)) continue;
    const cJSON *mode = cJSON_GetObjectItemCaseSensitive(sys, "mode");
    if (!cJSON_IsString(mode) || mode->valuestring == NULL) continue;
    if (strcmp(mode->valuestring, "rail") == 0 && !out->rail.present) {
      parse_rail_system(sys, &out->rail);
    } else if (strcmp(mode->valuestring, "bike") == 0 && !out->bike.present) {
      parse_bike_system(sys, &out->bike);
    } else if (strcmp(mode->valuestring, "bus") == 0) {
      out->bus_present = true;
    }
  }
  out->rail.initial_age_s = initial_age(out->generated_at, out->rail.fetched_at, out->rail.no_data);
  out->bike.initial_age_s = initial_age(out->generated_at, out->bike.fetched_at, out->bike.no_data);
  result = MODEL_PARSE_OK;

cleanup:
  cJSON_Delete(root);
  return result;
}
