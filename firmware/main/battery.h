#ifndef GC_BATTERY_H
#define GC_BATTERY_H

void gc_battery_init(void);
/* Battery percentage 0-100, or -1 when unavailable. */
int gc_battery_pct(void);

#endif
