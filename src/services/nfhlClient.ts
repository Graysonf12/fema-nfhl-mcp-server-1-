import axios, { AxiosError } from "axios";
import {
  NFHL_BASE_URL,
  NFHL_LAYER_NAMES,
  NFHL_LAYERS,
  REQUEST_TIMEOUT_MS
} from "../constants.js";
import type {
  ArcGisIdentifyResponse,
  ArcGisIdentifyResult,
  FirmPanelFinding,
  FloodZoneFinding,
  QueriedPoint
} from "../types.js";

/**
 * Runs an ArcGIS REST "identify" operation against the FEMA NFHL MapServer
 * at a single point, for the given layer IDs. This is the same operation
 * the FEMA NFHL web viewer uses under a map click.
 */
export async function identifyAtPoint(
  point: QueriedPoint,
  layerIds: number[]
): Promise<ArcGisIdentifyResult[]> {
  // Small bounding box around the point — required by the identify operation
  // to establish map scale/tolerance context. 0.01 degrees is generously
  // larger than any FIRM panel pixel tolerance needs at typical site scale.
  const delta = 0.01;
  const mapExtent = [
    point.longitude - delta,
    point.latitude - delta,
    point.longitude + delta,
    point.latitude + delta
  ].join(",");

  const geometry = JSON.stringify({
    x: point.longitude,
    y: point.latitude,
    spatialReference: { wkid: 4326 }
  });

  const request = () =>
    axios.get<ArcGisIdentifyResponse>(`${NFHL_BASE_URL}/identify`, {
      timeout: REQUEST_TIMEOUT_MS,
      params: {
        geometry,
        geometryType: "esriGeometryPoint",
        sr: 4326,
        layers: `all:${layerIds.join(",")}`,
        tolerance: 3,
        mapExtent,
        imageDisplay: "600,550,96",
        returnGeometry: false,
        f: "json"
      }
    });

  // FEMA's public service drops connections now and then (ECONNRESET, timeouts,
  // 5xx) and usually answers again within seconds to minutes (seen live
  // 2026-11-02: down ~10 min, then fine). Retry once after a short pause before
  // giving up, so a brief blip doesn't fail the whole lookup.
  try {
    const response = await request();
    return response.data.results ?? [];
  } catch (firstError) {
    if (!isTransient(firstError)) {
      throw new Error(formatNfhlError(firstError, point));
    }
    await sleep(RETRY_DELAY_MS);
    try {
      const response = await request();
      return response.data.results ?? [];
    } catch (secondError) {
      throw new Error(formatNfhlError(secondError, point, true));
    }
  }
}

const RETRY_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Network drops, timeouts, rate limits and server-side errors are worth one
// retry. A 4xx other than 429 means the request itself is wrong — don't retry.
function isTransient(error: unknown): boolean {
  if (!(error instanceof AxiosError)) return false;
  if (!error.response) return true;
  const status = error.response.status;
  return status === 429 || status >= 500;
}

export function formatNfhlError(error: unknown, point?: QueriedPoint, retried = false): string {
  const where = point ? ` for point (${point.latitude}, ${point.longitude})` : "";
  const after = retried ? " (after one automatic retry)" : "";
  const outage =
    " FEMA's public NFHL service has short outages that usually clear within minutes — try again shortly; if it is still down, fall back to the manual msc.fema.gov coordinate route.";
  if (error instanceof AxiosError) {
    if (error.response) {
      return `FEMA NFHL request failed${where} with HTTP ${error.response.status}${after}.${outage}`;
    }
    if (error.code === "ECONNABORTED") {
      return `FEMA NFHL request timed out${where} after ${REQUEST_TIMEOUT_MS}ms${after}.${outage}`;
    }
    return `FEMA NFHL could not be reached${where}${after}: ${error.message}.${outage}`;
  }
  // identifyAtPoint already throws a formatted message — pass it through
  // instead of wrapping it a second time.
  if (error instanceof Error && error.message.startsWith("FEMA NFHL")) {
    return error.message;
  }
  return `Unexpected error querying FEMA NFHL${where}: ${
    error instanceof Error ? error.message : String(error)
  }`;
}

export function layerName(layerId: number): string {
  return NFHL_LAYER_NAMES[layerId] ?? `Layer ${layerId}`;
}

/**
 * Extracts flood hazard zone polygon findings (layer 28, S_Fld_Haz_Ar) from
 * a raw identify response. A point can legitimately return zero results
 * (site outside any mapped/digitized flood study area) or, rarely, more
 * than one overlapping result at a boundary — both are surfaced as-is
 * rather than collapsed, so the caller can flag ambiguity.
 */
export function extractFloodZones(results: ArcGisIdentifyResult[]): FloodZoneFinding[] {
  return results
    .filter((r) => r.layerId === NFHL_LAYERS.FLOOD_HAZARD_ZONES)
    .map((r) => ({
      layerId: r.layerId,
      fldZone: asString(r.attributes.FLD_ZONE),
      zoneSubtype: asString(r.attributes.ZONE_SUBTY),
      sfhaFlag: asString(r.attributes.SFHA_TF),
      staticBfeFeet: asBfe(r.attributes.STATIC_BFE),
      vDatum: asString(r.attributes.V_DATUM),
      dfirmId: asString(r.attributes.DFIRM_ID),
      floodAreaId: asString(r.attributes.FLD_AR_ID),
      studyType: asString(r.attributes.STUDY_TYP)
    }));
}

/**
 * Extracts FIRM panel findings (layer 3, S_FIRM_Pan) from a raw identify
 * response — panel number, effective date, and status.
 */
export function extractFirmPanels(results: ArcGisIdentifyResult[]): FirmPanelFinding[] {
  return results
    .filter((r) => r.layerId === NFHL_LAYERS.FIRM_PANELS)
    .map((r) => ({
      layerId: r.layerId,
      firmPanelNumber: asString(r.attributes.FIRM_PAN),
      panel: asString(r.attributes.PANEL),
      suffix: asString(r.attributes.SUFFIX),
      effectiveDate: formatEsriDate(r.attributes.EFF_DATE),
      status: asString(r.attributes.STATUS),
      dfirmId: asString(r.attributes.DFIRM_ID)
    }));
}

function asString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

// FEMA stores "no BFE established" as -9999 (seen live 2026-11-02 on a Zone X
// polygon). Treat that sentinel — and any similar large negative — as "no BFE",
// never as an elevation.
function asBfe(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= -9000) return null;
  return n;
}

// ArcGIS date fields commonly arrive as epoch milliseconds (number) or as
// an already-formatted string, depending on the layer's field config.
function formatEsriDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (value <= 0) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  return asString(value);
}
