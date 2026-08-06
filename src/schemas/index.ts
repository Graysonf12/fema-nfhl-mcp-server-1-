import { z } from "zod";
import { NFHL_LAYERS } from "../constants.js";

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json"
}

const ResponseFormatSchema = z
  .nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe(
    "Output format: 'markdown' for a human-readable summary (default) or 'json' for the full structured data."
  );

const PointSchema = z
  .object({
    label: z
      .string()
      .min(1)
      .max(60)
      .describe(
        "Short label identifying this point, e.g. 'Site centroid', 'NW corner', 'Left-Front (0.0 reference)'."
      ),
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .describe("Latitude in decimal degrees, WGS84 (e.g. 38.2527)."),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude in decimal degrees, WGS84 (e.g. -85.7585). Negative for the Western hemisphere.")
  })
  .strict();

export const FloodZoneLookupInputSchema = z
  .object({
    points: z
      .array(PointSchema)
      .min(1, "Provide at least one point")
      .max(8, "Provide at most 8 points per call (typical parcel corners + centroid)")
      .describe(
        "One or more coordinate points to check — e.g. the site centroid alone, or all four parcel corners plus centroid to catch a split flood-zone condition across the site."
      ),
    response_format: ResponseFormatSchema
  })
  .strict();

export type FloodZoneLookupInput = z.infer<typeof FloodZoneLookupInputSchema>;

const KNOWN_LAYER_IDS = Object.values(NFHL_LAYERS) as number[];

export const IdentifyLayerInputSchema = z
  .object({
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .describe("Latitude in decimal degrees, WGS84."),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude in decimal degrees, WGS84."),
    layer_ids: z
      .array(z.number().int())
      .min(1)
      .max(10)
      .default([...KNOWN_LAYER_IDS])
      .describe(
        `Which NFHL layer IDs to query at this point. Known layers: 0=NFHL Availability, 1=LOMRs, 3=FIRM Panels, 14=Cross-Sections, 20=Water Lines, 22=Political Jurisdictions, 28=Flood Hazard Zones, 34=LOMAs. Defaults to all of these. Useful beyond the standard flood-zone lookup — e.g. layer 1 (LOMRs) or 34 (LOMAs) to check for a Letter of Map Change on or near the subject parcel, which the standard flood_zone_lookup tool does not surface.`
      ),
    response_format: ResponseFormatSchema
  })
  .strict();

export type IdentifyLayerInput = z.infer<typeof IdentifyLayerInputSchema>;
