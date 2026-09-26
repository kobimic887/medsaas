# DiffDock reference fixtures

These fixtures preserve the upstream wire format used to develop the compatibility service.
They are test data, not current service-status evidence or a complete inference benchmark.

## Request

| Field | Fixture value or shape |
|---|---|
| `protein` | PDB text; truncated in `request-canonical.json` |
| `ligand` | SDF text |
| `ligand_file_type` | `"sdf"` |
| `num_poses` | Requested pose count |
| `time_divisions` | `20` |
| `steps` | `18` |
| `save_trajectory` | `false` |
| `is_staged` | `false` |

Use a full valid protein/SDF input to qualify real inference. Do not submit the truncated
canonical request and interpret a failure as evidence about the engine.

## Response

| Key | Success | Chemistry failure |
|---|---|---|
| `status` | `"success"` | `"failed"` |
| `details` | Descriptive text | Descriptive error text |
| `ligand_positions` | SDF strings, with padding if needed | Empty strings |
| `position_confidence` | Numbers aligned to poses | Nulls |
| `trajectory` | Per-pose entries | Empty strings |
| `protein` | Verbatim request value | Verbatim request value |
| `ligand` | Verbatim request value | Verbatim request value |

A chemistry failure may be HTTP `200`; inspect `status`. Arrays are padded to `num_poses`,
so array length is not a successful pose count. Confidence is best-first and each
`position_confidence[i]` describes `ligand_positions[i]`.

Treat `details` as text rather than a machine-readable error code. Upstream failures may
also produce HTML instead of JSON, as represented by the error-page fixture.

## Files

| File | Coverage |
|---|---|
| `request-canonical.json` | Request shape and escaping; protein truncated |
| `response-success-1pose.json` | Complete one-pose success |
| `response-success-100pose-trimmed.json` | Large response with arrays shortened to three entries |
| `response-failed-unreadable-ligand.json` | Ligand parsing failure |
| `response-failed-complex-graph.json` | Complex-graph failure |
| `response-html-error-page.txt` | Non-JSON upstream error |

Trimming metadata records original array lengths. Do not turn the trimmed lengths into
runtime requirements. See [the service README](../README.md) for verification and engines.
