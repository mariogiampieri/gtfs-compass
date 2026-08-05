/*
 * gc_str.h — the one bounded string copy (review fix: three byte-identical
 * private copies had grown in pair_fsm.c / ui_state.c / ui_nav.c; the repo's
 * extraction rule says judgment-free identical helpers are shared, parallel
 * structure is reserved for judgment-bearing code).
 *
 * Platform-free like everything under components/model.
 */
#ifndef GTFS_COMPASS_GC_STR_H
#define GTFS_COMPASS_GC_STR_H

#include <stddef.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Copy src into dst (capacity cap), truncating; always NUL-terminates.
 * src must be NUL-terminated. */
static inline void gc_copy_bounded(char *dst, size_t cap, const char *src) {
  size_t n = strlen(src);
  if (n >= cap) n = cap - 1;
  memcpy(dst, src, n);
  dst[n] = '\0';
}

#ifdef __cplusplus
}
#endif

#endif /* GTFS_COMPASS_GC_STR_H */
