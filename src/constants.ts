// FEMA's public, unauthenticated NFHL ArcGIS REST MapServer.
// Reference: https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer
export const NFHL_BASE_URL =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";

// Layer IDs within the NFHL MapServer (stable — confirmed against the live service).
export const NFHL_LAYERS = {
  NFHL_AVAILABILITY: 0,
  LOMRS: 1,
  FIRM_PANELS: 3,
  CROSS_SECTIONS: 14,
  WATER_LINES: 20,
  POLITICAL_JURISDICTIONS: 22,
  FLOOD_HAZARD_ZONES: 28, // S_Fld_Haz_Ar — FLD_ZONE, ZONE_SUBTY, SFHA_TF, STATIC_BFE, DFIRM_ID
  LOMAS: 34
} as const;

export const NFHL_LAYER_NAMES: Record<number, string> = {
  0: "NFHL Availability",
  1: "LOMRs",
  3: "FIRM Panels",
  14: "Cross-Sections",
  20: "Water Lines",
  22: "Political Jurisdictions",
  28: "Flood Hazard Zones",
  34: "LOMAs"
};

export const CHARACTER_LIMIT = 25000;

export const REQUEST_TIMEOUT_MS = 20000;

// Zone reference table (mirrors SIR_Agent_Field_Reference_v007_2.md Section 3).
export const FLOOD_ZONE_RISK: Record<string, { meaning: string; risk: string }> = {
  X: { meaning: "Outside the 500-year floodplain (unshaded X) or 0.2% annual chance (shaded X) — check ZONE_SUBTY to distinguish", risk: "Low to moderate" },
  AE: { meaning: "1% annual chance flood (100-year), Base Flood Elevation established", risk: "High — major cost impact" },
  AH: { meaning: "1% annual chance shallow flooding, BFE established", risk: "High" },
  AO: { meaning: "1% annual chance shallow flooding (sheet flow), depth shown instead of BFE", risk: "High" },
  A: { meaning: "1% annual chance flood, no BFE established (approximate study)", risk: "High" },
  VE: { meaning: "Coastal high-hazard area — wave action, 1% annual chance", risk: "Very high" },
  V: { meaning: "Coastal high-hazard area, no BFE established", risk: "Very high" },
  D: { meaning: "Undetermined but possible flood hazard — area not studied", risk: "Undetermined" }
};
