import { CHARACTER_LIMIT, NFHL_BASE_URL } from "../constants.js";
import { formatNfhlError, identifyAtPoint, layerName } from "../services/nfhlClient.js";
import { ResponseFormat, type IdentifyLayerInput } from "../schemas/index.js";
import type { QueriedPoint } from "../types.js";

export async function runIdentifyLayer(params: IdentifyLayerInput) {
  const point: QueriedPoint = {
    label: "query point",
    latitude: params.latitude,
    longitude: params.longitude
  };

  let raw;
  try {
    raw = await identifyAtPoint(point, params.layer_ids);
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: formatNfhlError(error, point) }]
    };
  }

  const output = {
    latitude: params.latitude,
    longitude: params.longitude,
    layers_queried: params.layer_ids.map((id) => ({ id, name: layerName(id) })),
    result_count: raw.length,
    results: raw.map((r) => ({
      layer_id: r.layerId,
      layer_name: layerName(r.layerId),
      display_value: r.value,
      attributes: r.attributes
    })),
    source: `${NFHL_BASE_URL}/identify`
  };

  let textContent: string;
  if (params.response_format === ResponseFormat.MARKDOWN) {
    const lines = [
      `# FEMA NFHL Layer Identify — (${params.latitude}, ${params.longitude})`,
      "",
      `Queried layers: ${output.layers_queried.map((l) => `${l.name} (${l.id})`).join(", ")}`,
      `${output.result_count} feature(s) returned.`,
      ""
    ];
    if (!output.result_count) {
      lines.push(
        "No features found at this point on the queried layers. This can mean the point is genuinely clear (e.g. no LOMR/LOMA on file) or that the layer has no digitized coverage here — check `NFHL Availability` (layer 0) if that distinction matters."
      );
    }
    for (const r of output.results) {
      lines.push(`## ${r.layer_name} (layer ${r.layer_id})`);
      lines.push(`- Display value: ${r.display_value}`);
      for (const [k, v] of Object.entries(r.attributes)) {
        if (v === null || v === undefined || v === "") continue;
        lines.push(`  - ${k}: ${v}`);
      }
      lines.push("");
    }
    lines.push(`Source: ${output.source}`);
    textContent = lines.join("\n");
  } else {
    textContent = JSON.stringify(output, null, 2);
  }

  if (textContent.length > CHARACTER_LIMIT) {
    textContent =
      textContent.slice(0, CHARACTER_LIMIT) +
      `\n\n[Truncated at ${CHARACTER_LIMIT} characters — narrow layer_ids or use response_format='json'.]`;
  }

  return {
    content: [{ type: "text" as const, text: textContent }],
    structuredContent: output
  };
}
