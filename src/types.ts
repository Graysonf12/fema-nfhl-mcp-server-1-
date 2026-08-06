export interface ArcGisIdentifyResultAttribute {
  [fieldName: string]: string | number | null;
}

export interface ArcGisIdentifyResult {
  layerId: number;
  layerName: string;
  value: string; // primary display value ArcGIS assigns (usually the display field)
  attributes: ArcGisIdentifyResultAttribute;
}

export interface ArcGisIdentifyResponse {
  results?: ArcGisIdentifyResult[];
}

export interface FloodZoneFinding {
  layerId: number;
  fldZone: string | null;
  zoneSubtype: string | null;
  sfhaFlag: string | null; // "T" = within Special Flood Hazard Area, "F" = not
  staticBfeFeet: number | null;
  vDatum: string | null;
  dfirmId: string | null;
  floodAreaId: string | null;
  studyType: string | null;
}

export interface FirmPanelFinding {
  layerId: number;
  firmPanelNumber: string | null; // e.g. "12345C0123D"
  panel: string | null;
  suffix: string | null;
  effectiveDate: string | null; // ISO date string
  status: string | null;
  dfirmId: string | null;
}

export interface QueriedPoint {
  label: string;
  latitude: number;
  longitude: number;
}

export interface PointFloodResult {
  point: QueriedPoint;
  floodZones: FloodZoneFinding[];
  firmPanels: FirmPanelFinding[];
  queriedAt: string;
  sourceUrl: string;
}
