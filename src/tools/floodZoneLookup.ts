import { CHARACTER_LIMIT, FLOOD_ZONE_RISK, NFHL_BASE_URL, NFHL_LAYERS } from "../constants.js";
import {
  extractFirmPanels,
  extractFloodZones,
  formatNfhlError,
  identifyAtPoint
} from "../services/nfhlClient.js";
import { ResponseFormat, type FloodZoneLookupInput } from "../schemas/index.js";
import type { FirmPanelFinding, FloodZoneFinding, PointFloodResult, QueriedPoint } from "../types.js";

const QUERY_LAYERS = [NFHL_LAYERS.FLOOD_HAZARD_ZONES, NFHL_LAYERS.FIRM_PANELS];

export async function runFloodZoneLookup(params: FloodZoneLookupInput) {
  const results: PointFloodResult[] = [];
  const perPointErrors: { point: QueriedPoint; error: string }[] = [];

  for (const p of params.points) {
    const point: QueriedPoint = { label: p.label, latitude: p.latitude, longitude: p.longitude };
    try {
      const raw = await identifyAtPoint(point, QUERY_LAYERS);
      results.push({
        point,
        floodZones: extractFloodZones(raw),
        firmPanels: extractFirmPanels(raw),
        queriedAt: new Date().toISOString(),
        sourceUrl: `${NFHL_BASE_URL}/identify`
      });
    } catch (error) {
      perPointErrors.push({ point, error: formatNfhlError(error, point) });
    }
  }

  if (!results.length) {
    const detail = perPointErrors.map((e) => `${e.point.label}: ${e.error}`).join(" | ");
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: could not resolve any of the ${params.points.length} point(s) against the FEMA NFHL service. ${detail} Per standing SIR doctrine, do not leave the field silently unrouted.`
        }
      ]
    };
  }

  const anySfha = results.some((r) => r.floodZones.some((z) => z.sfhaFlag === "T"));
  const zonesTouched = uniqueZones(results);
  const splitZone = zonesTouched.length > 1;

  const output = {
    query_summary: {
      points_queried: params.points.length,
      points_resolved: results.length,
      points_failed: perPointErrors.length,
      any_point_in_sfha: anySfha,
      distinct_flood_zones_across_points: zonesTouched,
      split_zone_condition: splitZone
    },
    points: results.map(formatPointForOutput),
    failed_points: perPointErrors.map((e) => ({ label: e.point.label, error: e.error })),
    source: `${NFHL_BASE_URL}/identify`
  };

  let textContent: string;
  if (params.response_format === ResponseFormat.MARKDOWN) {
    textContent = renderMarkdown(output, params);
  } else {
    textContent = JSON.stringify(output, null, 2);
  }

  if (textContent.length > CHARACTER_LIMIT) {
    textContent =
      textContent.slice(0, CHARACTER_LIMIT) +
      `\n\n[Truncated at ${CHARACTER_LIMIT} characters — re-run with fewer points or response_format='json' with targeted field extraction.]`;
  }

  return {
    content: [{ type: "text" as const, text: textContent }],
    structuredContent: output
  };
}

// A point near a county or community line can return FIRM panels from more
// than one study (seen live 2026-11-02: a Marion County panel, 47115C, came back
// beside the Hamilton County panel, 47065C, that actually maps the point). The
// panel whose DFIRM study matches the flood-zone polygon's study is the one
// that governs here; any other panel is flagged rather than silently listed.
function panelGoverns(panelDfirm: string | null, zoneDfirms: Set<string>): boolean | null {
  if (!zoneDfirms.size || !panelDfirm) return null;
  return zoneDfirms.has(panelDfirm);
}

function formatPointForOutput(r: PointFloodResult) {
  const zoneDfirms = new Set(
    r.floodZones.map((z) => z.dfirmId).filter((d): d is string => Boolean(d))
  );
  return {
    label: r.point.label,
    latitude: r.point.latitude,
    longitude: r.point.longitude,
    in_sfha: r.floodZones.some((z) => z.sfhaFlag === "T"),
    flood_zones: r.floodZones.map((z) => ({
      zone: z.fldZone,
      zone_subtype: z.zoneSubtype,
      sfha: z.sfhaFlag === "T",
      base_flood_elevation_ft: z.staticBfeFeet,
      vertical_datum: z.vDatum,
      dfirm_id: z.dfirmId,
      study_type: z.studyType,
      risk_note: z.fldZone ? FLOOD_ZONE_RISK[z.fldZone]?.meaning ?? null : null
    })),
    firm_panels: r.firmPanels.map((p) => ({
      panel_number: p.firmPanelNumber,
      effective_date: p.effectiveDate,
      status: p.status,
      dfirm_id: p.dfirmId,
      governs_this_point: panelGoverns(p.dfirmId, zoneDfirms)
    })),
    note:
      r.floodZones.length === 0
        ? "No flood hazard polygon returned at this point — outside a digitized NFHL study area, or in an unshaded Zone X not rendered as a discrete polygon in some panels. Confirm against the FIRM panel result before concluding 'no flood risk'."
        : undefined
  };
}

function uniqueZones(results: PointFloodResult[]): string[] {
  const set = new Set<string>();
  for (const r of results) {
    for (const z of r.floodZones) {
      if (z.fldZone) set.add(z.fldZone);
    }
  }
  return [...set].sort();
}

function renderMarkdown(
  output: {
    query_summary: {
      points_queried: number;
      points_resolved: number;
      points_failed: number;
      any_point_in_sfha: boolean;
      distinct_flood_zones_across_points: string[];
      split_zone_condition: boolean;
    };
    points: ReturnType<typeof formatPointForOutput>[];
    failed_points: { label: string; error: string }[];
    source: string;
  },
  params: FloodZoneLookupInput
): string {
  const lines: string[] = [];
  lines.push(`# FEMA NFHL Flood Zone Lookup`);
  lines.push("");
  lines.push(
    `Queried ${output.query_summary.points_queried} point(s) · ${output.query_summary.points_resolved} resolved · ${output.query_summary.points_failed} failed`
  );
  lines.push(
    `**In a Special Flood Hazard Area (SFHA)?** ${output.query_summary.any_point_in_sfha ? "YES — at least one queried point" : "No — none of the queried points fell in an SFHA"}`
  );
  if (output.query_summary.split_zone_condition) {
    lines.push(
      `⚠ **Split-zone condition:** the queried points return different flood zones (${output.query_summary.distinct_flood_zones_across_points.join(
        ", "
      )}) — the site is not uniformly zoned. Note this explicitly in the SIR rather than reporting a single zone for the whole parcel.`
    );
  }
  lines.push("");

  for (const p of output.points) {
    lines.push(`## ${p.label} (${p.latitude}, ${p.longitude})`);
    if (!p.flood_zones.length) {
      lines.push(`- No flood hazard polygon at this point.`);
      lines.push(`  - ${p.note}`);
    }
    for (const z of p.flood_zones) {
      lines.push(`- **Zone ${z.zone ?? "(unlabeled)"}**${z.zone_subtype ? ` — ${z.zone_subtype}` : ""}`);
      lines.push(`  - In SFHA: ${z.sfha ? "Yes" : "No"}`);
      if (z.base_flood_elevation_ft !== null) {
        lines.push(`  - Base Flood Elevation: ${z.base_flood_elevation_ft} ft ${z.vertical_datum ?? ""}`.trim());
      }
      if (z.risk_note) lines.push(`  - ${z.risk_note}`);
      if (z.dfirm_id) lines.push(`  - DFIRM ID: ${z.dfirm_id}`);
    }
    for (const panel of p.firm_panels) {
      const governs =
        panel.governs_this_point === true
          ? " · ✅ governs this point (same study as the flood zone)"
          : panel.governs_this_point === false
            ? ` · ⚠ different study (${panel.dfirm_id}) from the flood zone mapped here — not the governing panel; confirm which county/community study applies before citing it`
            : "";
      lines.push(
        `  - FIRM Panel: ${panel.panel_number ?? "(not returned)"} · Effective: ${panel.effective_date ?? "(not returned)"} · Status: ${panel.status ?? "n/a"}${governs}`
      );
    }
    lines.push("");
  }

  if (output.failed_points.length) {
    lines.push(`## Points that could not be resolved`);
    for (const f of output.failed_points) {
      lines.push(`- **${f.label}**: ${f.error}`);
    }
    lines.push("");
  }

  lines.push(`Source: ${output.source} (FEMA NFHL, live ArcGIS REST identify)`);
  lines.push(
    `Suggested SIR tag: \`[Confirmed · FEMA NFHL live query, ${new Date().toISOString().slice(0, 10)}]\` for each resolved field — carries the coordinates queried, per Quality Rule 8.`
  );
  return lines.join("\n");
}
