import { ParseError } from "./types";
import { nyctDirectionId } from "./nyct";

/**
 * MTA Mercury alerts adapter — pure reduction of the subway-alerts **JSON**
 * feed. The protobuf variant's standard `effect` field is uniformly
 * UNKNOWN_EFFECT (verified live 2026-08-03), so severity comes from MTA's
 * `transit_realtime.mercury_alert.alert_type` extension, which the JSON body
 * exposes as a plain key. Mercury is MTA-specific: this lives behind the
 * adapter seam like the NYCT group map; a second agency brings its own
 * alerts adapter (or a standard-GTFS-RT fallback) later.
 */

export type AlertSeverity = "delay" | "info";

export interface AlertItem {
  severity: AlertSeverity;
  text: string;
  /**
   * Direction ids from explicit selectors AND N/S-suffixed stop selectors,
   * narrowed to the device contract's 0|1 domain at this boundary.
   */
  directionIds: (0 | 1)[];
  /** Raw stop selector ids (parent or platform, as published) — scope filter. */
  stopIds: string[];
  /** [{start?, end?}] epoch seconds; empty = always active. */
  activePeriods: { start?: number; end?: number }[];
  /** Mercury updated_at (fall back created_at, then 0) — recency tiebreak. */
  updatedAt: number;
}

export interface ParsedAlerts {
  /** Feed header timestamp (epoch seconds); 0 when absent. */
  timestamp: number;
  /** route_id → alerts; AGENCY_WIDE_KEY ("*") holds agency-scoped alerts. */
  byRoute: Map<string, AlertItem[]>;
  /** Health counters: severity-signal loss must be distinguishable from calm. */
  entitiesParsed: number;
  entitiesWithMercury: number;
  skipped: number;
  /** Present-but-uncoercible active_period values — timestamp-shape drift. */
  unparseablePeriodValues: number;
}

/** Agency-scoped alerts (systemwide disruptions) apply to every trunk. */
export const AGENCY_WIDE_KEY = "*";

const MERCURY_KEY = "transit_realtime.mercury_alert";

/**
 * The severity band — Mario's blocking review item (plan A1). The design's
 * two-band world reads "delay" as "your ride is disrupted now": an active
 * suspension satisfies that more than a delay does, so active service
 * reductions ride the amber band. One predicate to flip.
 */
export const DELAY_TYPE_PATTERNS = ["Delays", "Suspended", "Stops Skipped", "Reduced Service"] as const;

/** Cap stored copy: composition truncates to ~200 anyway; snapshots must not
 *  grow with unbounded vendor prose. */
const STORED_TEXT_MAX = 400;
// Bounded: vendor drift to per-alert-unique type strings must not ratchet
// memory in a long-lived polling isolate.
const UNSEEN_TYPES_CAP = 100;
const unseenTypes = new Set<string>();

export function severityFor(alertType: string | undefined): AlertSeverity {
  if (!alertType) return "info";
  if (DELAY_TYPE_PATTERNS.some((p) => alertType.includes(p))) return "delay";
  // Known-info families need no warning; genuinely novel strings get one.
  const knownInfo = ["Planned", "Boarding", "Extra Service", "Special Schedule", "Station Notice"];
  if (!knownInfo.some((p) => alertType.includes(p)) && !unseenTypes.has(alertType)) {
    if (unseenTypes.size < UNSEEN_TYPES_CAP) {
      unseenTypes.add(alertType);
      console.warn(`[mta-alerts] unseen alert_type "${alertType}" mapped to info`);
    } else if (unseenTypes.size === UNSEEN_TYPES_CAP) {
      unseenTypes.add(`__overflow__`); // pushes size past cap so this logs once
      console.warn(`[mta-alerts] unseen alert_type variety exceeded ${UNSEEN_TYPES_CAP}; suppressing further warns`);
    }
  }
  return "info";
}

/**
 * The repo already hedges MTA route-id drift (NYCT_ROUTE_GROUP maps both SI
 * and SIR); alerts route ids normalize through the same alias posture so a
 * Mercury "SIR" alert lands on the static "SI" route's trunk.
 */
const ROUTE_ALIASES: Readonly<Record<string, string>> = { SIR: "SI" };

export function isActiveNow(item: AlertItem, nowSec: number): boolean {
  if (item.activePeriods.length === 0) return true;
  return item.activePeriods.some(
    (p) => (p.start ?? 0) <= nowSec && nowSec <= (p.end ?? Number.POSITIVE_INFINITY),
  );
}

export function parseMtaAlerts(text: string): ParsedAlerts {
  let feed: Record<string, unknown>;
  try {
    feed = JSON.parse(text) as Record<string, unknown>;
  } catch (cause) {
    throw new ParseError("failed to parse alerts JSON", cause);
  }
  if (typeof feed !== "object" || feed === null || !Array.isArray(feed.entity)) {
    throw new ParseError("alerts JSON has no entity array");
  }
  const header = feed.header as Record<string, unknown> | undefined;
  const timestamp = coerceEpoch(header?.timestamp);

  const byRoute = new Map<string, AlertItem[]>();
  let entitiesParsed = 0;
  let unparseablePeriodValues = 0;
  let entitiesWithMercury = 0;
  let skipped = 0;

  for (const raw of feed.entity as unknown[]) {
    const entity = raw as Record<string, unknown> | null;
    const alert = entity?.alert as Record<string, unknown> | undefined;
    if (!alert) continue;
    entitiesParsed++;

    const mercury = alert[MERCURY_KEY] as Record<string, unknown> | undefined;
    if (mercury) entitiesWithMercury++;

    const textEn = translationEn(alert.header_text);
    if (!textEn) {
      skipped++; // no English copy: nothing renderable
      continue;
    }

    // Selectors carry (route_id, stop_id, direction_id) TOGETHER (verified
    // live) — pooling them entity-wide would attach one route's stop scope
    // and direction to a co-informed route's trunk at transfer stations.
    // Group per route; routeless stop/direction selectors form a shared pool
    // every route inherits.
    interface Scope {
      stopIds: string[];
      directionIds: Set<0 | 1>;
    }
    const byRouteScope = new Map<string, Scope>();
    const shared: Scope = { stopIds: [], directionIds: new Set() };
    let agencyScoped = false;
    for (const sel of asArray(alert.informed_entity)) {
      const s = sel as Record<string, unknown>;
      let scope = shared;
      if (typeof s.route_id === "string" && s.route_id) {
        // hasOwn guard: route ids are upstream-controlled and a bare index of
        // "__proto__" would hand back Object.prototype from the alias map.
        const routeId = Object.hasOwn(ROUTE_ALIASES, s.route_id) ? ROUTE_ALIASES[s.route_id] : s.route_id;
        scope = byRouteScope.get(routeId) ?? { stopIds: [], directionIds: new Set() };
        byRouteScope.set(routeId, scope);
      } else if (typeof s.agency_id === "string" && s.agency_id) {
        agencyScoped = true;
      }
      if (typeof s.stop_id === "string" && s.stop_id) {
        scope.stopIds.push(s.stop_id);
        // Direction can hide in a platform suffix rather than a selector.
        const fromSuffix = nyctDirectionId(s.stop_id);
        if (fromSuffix !== null) scope.directionIds.add(fromSuffix);
      }
      // The device contract's direction domain is 0|1; anything else from the
      // untrusted body is dropped, never forwarded.
      if (s.direction_id === 0 || s.direction_id === 1) scope.directionIds.add(s.direction_id);
    }
    if (byRouteScope.size === 0 && !agencyScoped) {
      skipped++; // scoped to nothing we can attach
      continue;
    }

    const severity = severityFor(typeof mercury?.alert_type === "string" ? mercury.alert_type : undefined);
    const activePeriods = asArray(alert.active_period).map((p) => {
      const period = p as Record<string, unknown>;
      if ((period.start && !coerceEpoch(period.start)) || (period.end && !coerceEpoch(period.end))) {
        unparseablePeriodValues++; // present-but-uncoercible: shape drift signal
      }
      const start = coerceEpoch(period.start);
      const end = coerceEpoch(period.end);
      return { ...(start ? { start } : {}), ...(end ? { end } : {}) };
    });
    const updatedAt = coerceEpoch(mercury?.updated_at) || coerceEpoch(mercury?.created_at);
    // Snapshot hygiene: never store copy beyond what composition can render.
    const text = textEn.length > STORED_TEXT_MAX ? textEn.slice(0, STORED_TEXT_MAX) : textEn;

    const emit = (key: string, scope: Scope) => {
      const item: AlertItem = {
        severity,
        text,
        directionIds: [...new Set([...scope.directionIds, ...shared.directionIds])].sort() as (0 | 1)[],
        stopIds: [...scope.stopIds, ...shared.stopIds],
        activePeriods,
        updatedAt,
      };
      const list = byRoute.get(key) ?? [];
      list.push(item);
      byRoute.set(key, list);
    };
    if (byRouteScope.size > 0) {
      for (const [routeId, scope] of byRouteScope) emit(routeId, scope);
    } else {
      emit(AGENCY_WIDE_KEY, shared);
    }
  }

  return { timestamp, byRoute, entitiesParsed, entitiesWithMercury, skipped, unparseablePeriodValues };
}

function translationEn(headerText: unknown): string | null {
  const translations = asArray((headerText as Record<string, unknown> | undefined)?.translation);
  for (const raw of translations) {
    const t = raw as Record<string, unknown>;
    // "en" exactly — "en-html" carries markup the device can't render.
    if (t.language === "en" && typeof t.text === "string" && t.text.trim()) {
      return t.text.trim();
    }
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function coerceEpoch(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}
