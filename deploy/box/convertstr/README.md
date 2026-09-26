# convertSTR

A CPU service that converts one raw SMILES string into a validated 3D SDF. It uses
RDKit and has no GPU, database or network dependency during conversion.

## HTTP contract

```http
POST /convertSTR
Content-Type: application/json

{"smiles":"CC(=O)Oc1ccccc1C(=O)O"}
```

Success returns `200` with `{"sdf":"<SDF text>"}`. `GET /health` returns
`{"status":"ok"}`. Send raw SMILES, not URL-encoded input.

The converter trims surrounding whitespace, adds explicit hydrogens, embeds with ETKDGv3
using a fixed seed and optimizes with MMFF94. It re-parses the generated SDF to verify
finite 3D coordinates and atom/hydrogen preservation. Output uses LF newlines and ends
with `$$$$`.

| Failure | Status |
|---|---|
| Missing or non-string `smiles`, malformed request | `422` |
| Invalid/empty SMILES, unsupported chemistry, failed embedding/optimization/serialization | `400` |
| Unexpected server failure | `500` |

Errors return a readable `error` field. Semicolons are rejected; callers must not encode
multiple inputs with separators. A 2xx response must contain a usable 3D structure.

The fixed seed makes results reproducible for a given image and RDKit version. It does
not promise identical coordinates, atom order or SDF bytes to a different converter.

## Build and verify

Run on a Docker host with a `linux/amd64` builder, from the repository root:

```bash
docker build --platform linux/amd64 --target test -t pyxis-convertstr-test deploy/box/convertstr
docker run --rm --network none --platform linux/amd64 pyxis-convertstr-test
docker build --platform linux/amd64 --target runtime -t pyxis-convertstr deploy/box/convertstr
```

Use the container instead of installing RDKit on the development laptop. Before deployment,
exercise health, an aspirin conversion, invalid SMILES and malformed input through the
runtime HTTP service. Verify canonical SMILES round-trip and non-flat 3D output; passing
unit tests alone does not prove the deployed container.

## Integration

The shared [Compose file](../compose.yml) binds port `8001` to loopback by default.
DiffDock can call `http://convertstr:8001/convertSTR` within the Compose network.
The application setting `SDF_CONVERTER_URL` must retain the `/convertSTR` path.
It is read at application startup, so changing it requires an application restart.

This service has no application authentication. Preserve the loopback binding and
[ingress access controls](../ingress/README.md). Validate a working previous converter
before treating its URL as a rollback. Current installations are recorded in
[operations](../../../docs/OPERATIONS.md).
