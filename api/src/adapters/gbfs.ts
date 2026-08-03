import { ParseError } from "./types";

/** Per-station realtime status, reduced to what the device renders. */
export interface StationStatus {
  classic: number;
  electric: number;
  docks: number;
}

export interface GbfsStatusSnapshot {
  /** Top-level `last_updated` (epoch seconds); 0 when absent/non-numeric. */
  lastUpdated: number;
  stations: Map<string, StationStatus>;
}

// Citi Bike GBFS 2.3 vehicle types (verified live 2026-08-02). This split is
// the source of truth — the legacy `num_ebikes_available` field is known to
// disagree on ~2% of stations and must not be used.
const CLASSIC_VEHICLE_TYPE_ID = "1";
const ELECTRIC_VEHICLE_TYPE_ID = "2";

/**
 * Reduce a GBFS `station_status` JSON body to per-station counts. Pure:
 * no I/O, no clock. Throws ParseError on garbage input so callers can
 * distinguish a broken upstream from a bug.
 */
export function parseStationStatus(body: string): GbfsStatusSnapshot {
  let doc: unknown;
  try {
    doc = JSON.parse(body);
  } catch (cause) {
    throw new ParseError("station_status is not valid JSON", cause);
  }
  if (typeof doc !== "object" || doc === null) {
    throw new ParseError("station_status is not a JSON object");
  }
  const root = doc as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  if (typeof data !== "object" || data === null || !Array.isArray(data.stations)) {
    throw new ParseError("station_status missing data.stations");
  }
  // GBFS 2.3 requires last_updated; mirror the RT header-timestamp handling
  // anyway — 0 skips the freshness gate rather than freezing it at 0 <= 0.
  const lastUpdated = typeof root.last_updated === "number" ? root.last_updated : 0;

  const stations = new Map<string, StationStatus>();
  for (const raw of data.stations as unknown[]) {
    const station = raw as Record<string, unknown> | null;
    if (!station || typeof station.station_id !== "string" || station.station_id === "") {
      continue; // malformed entry: skip, don't fail the whole snapshot
    }
    stations.set(station.station_id, stationStatus(station));
  }
  return { lastUpdated, stations };
}

function stationStatus(station: Record<string, unknown>): StationStatus {
  const docks = count(station.num_docks_available);
  // A station that isn't renting has no bikes to offer, whatever the counts
  // claim; docks stay real — a disabled-rental station still accepts returns.
  // Lyft sends numeric 0/1 today, but the GBFS 2.x spec mandates booleans —
  // accept both so a spec-compliance or 3.0 migration can't defeat the gate.
  if (station.is_renting === 0 || station.is_renting === false) {
    return { classic: 0, electric: 0, docks };
  }
  let classic = 0;
  let electric = 0;
  if (Array.isArray(station.vehicle_types_available)) {
    for (const raw of station.vehicle_types_available as unknown[]) {
      const vt = raw as Record<string, unknown> | null;
      if (!vt) continue;
      if (vt.vehicle_type_id === CLASSIC_VEHICLE_TYPE_ID) classic += count(vt.count);
      else if (vt.vehicle_type_id === ELECTRIC_VEHICLE_TYPE_ID) electric += count(vt.count);
      // other vehicle type ids (future scooters etc.): ignored, not classic
    }
  } else {
    // No per-type breakdown: report the total as classic rather than lying
    // about an electric count we don't have.
    classic = count(station.num_bikes_available);
  }
  return { classic, electric, docks };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}
