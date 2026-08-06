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

  try {
    const response = await axios.get<ArcGisIdentifyResponse>(
      `${NFHL_BASE_URL}/identify`,
      {
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
      }
    );
    return response.data.results ?? [];
  } catch (error) {
    throw new Error(formatNfhlError(error, point));
  }
}

export function formatNfhlError(error: unknown, point?: QueriedPoint): string {
  const where = point ? ` for point (${point.latitude}, ${point.longitude})` : "";
  if (error instanceof AxiosError) {
    if (error.response) {
      return `FEMA NFHL request failed${where} with HTTP ${error.response.status}. The public NFHL ArcGIS service is occasionally rate-limited or briefly unavailable — retry once before treating this as a hard block.`;
    }
    if (error.code === "ECONNABORTED") {
      return `FEMA NFHL request timed out${where} after ${REQUEST_TIMEOUT_MS}ms. Retry; if it persists across multiple points, the service may be down — fall back to the manual msc.fema.gov coordinate route.`;
    }
    return `FEMA NFHL network error${where}: ${error.message}.`;
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
      staticBfeFeet: asNumber(r.attributes.STATIC_BFE),
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

function asNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
