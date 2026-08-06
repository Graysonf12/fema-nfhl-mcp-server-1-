import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { FloodZoneLookupInputSchema, IdentifyLayerInputSchema } from "./schemas/index.js";
import { runFloodZoneLookup } from "./tools/floodZoneLookup.js";
import { runIdentifyLayer } from "./tools/identifyLayer.js";

/**
 * Builds a fresh, fully-configured McpServer instance.
 *
 * Streamable HTTP in stateless mode creates one MCP server + transport pair
 * per incoming request (see index.ts) rather than one long-lived server for
 * the whole process — this keeps the server safe to run on hosts that may
 * spin the process down between requests (e.g. free-tier Render) with no
 * in-memory session state to lose. Tool logic itself is already stateless
 * (each call is an independent read-only FEMA lookup), so this costs
 * nothing in practice.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "fema-nfhl-mcp-server",
    version: "1.0.0"
  });

  server.registerTool(
    "fema_flood_zone_lookup",
    {
      title: "FEMA Flood Zone Lookup",
      description: `Look up FEMA National Flood Hazard Layer (NFHL) data for one or more coordinate points — flood zone, whether the point sits within a Special Flood Hazard Area (SFHA), Base Flood Elevation (BFE), and the governing FIRM panel number and effective date.

This is a live, unauthenticated query against FEMA's own NFHL ArcGIS service (the same data source behind msc.fema.gov, which is not directly fetchable). It does NOT require msc.fema.gov, a browser, or an API key.

Args:
  - points (array, 1-8): each with label, latitude, longitude (WGS84 decimal degrees). Pass a single centroid point for a quick check, or multiple points (e.g. all four parcel corners + centroid) to catch a split flood-zone condition where part of a site is in a Special Flood Hazard Area and part isn't.
  - response_format ('markdown' | 'json'): default 'markdown'.

Returns (per point):
  - Whether the point is in an SFHA
  - Flood zone code(s) (X, AE, AH, A, VE, etc.) with the zone subtype and a plain-language risk note
  - Base Flood Elevation in feet + vertical datum, where established
  - Governing FIRM panel number, effective date, and status
  - A flag if the queried points return different zones (split-zone condition)

Examples:
  - Use when: "Is this parcel in a flood zone?" -> one point (site centroid)
  - Use when: "Does any part of this site fall in the SFHA?" -> 4-5 points (corners + centroid)
  - Don't use when: you need historical/superseded FIRM data, or a LOMR/LOMA lookup specifically — use fema_identify_layer with layer_ids [1] or [34] instead.

Error Handling:
  - A point with zero flood-zone results is reported, not silently dropped — it may mean the area is genuinely outside any mapped SFHA, or that the NFHL has no digitized study coverage there; the FIRM panel result usually disambiguates.
  - If the live service is unreachable, the tool says so explicitly and does not fabricate a zone — fall back to the manual msc.fema.gov coordinate route.`,
      inputSchema: FloodZoneLookupInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params) => runFloodZoneLookup(params)
  );

  server.registerTool(
    "fema_identify_layer",
    {
      title: "FEMA NFHL Generic Layer Identify",
      description: `Lower-level identify against any layer(s) of FEMA's NFHL ArcGIS MapServer at a single point. Use this for lookups the standard fema_flood_zone_lookup tool doesn't cover — most commonly checking for a Letter of Map Revision (LOMR) or Letter of Map Amendment (LOMA) on or near a parcel, or reading the political-jurisdiction / FIRM-availability layers directly.

Args:
  - latitude, longitude (WGS84 decimal degrees)
  - layer_ids (array of int, default = all known layers): 0=NFHL Availability, 1=LOMRs, 3=FIRM Panels, 14=Cross-Sections, 20=Water Lines, 22=Political Jurisdictions, 28=Flood Hazard Zones, 34=LOMAs
  - response_format ('markdown' | 'json'): default 'markdown'

Returns: every feature found at the point across the requested layers, with all attributes returned as-is by the service (field names are FEMA's own NFHL schema, e.g. FLD_ZONE, EFF_DATE, CASE_NO).

Examples:
  - Use when: "Has a LOMR been issued on this parcel?" -> layer_ids: [1]
  - Use when: "Pull every NFHL attribute FEMA has at this point" -> layer_ids omitted (defaults to all)
  - Don't use when: you just want the flood zone/BFE/panel — use fema_flood_zone_lookup instead, it's purpose-built and easier to read.

Error Handling:
  - Zero results across all queried layers is reported plainly — check layer 0 (NFHL Availability) if you need to know whether the area is digitized at all versus genuinely clear.`,
      inputSchema: IdentifyLayerInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params) => runIdentifyLayer(params)
  );

  return server;
}
