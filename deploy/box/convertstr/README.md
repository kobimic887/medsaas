# convertSTR — SMILES to 3D SDF

`convertSTR` is the small, CPU-only conversion service used by the DiffDock path. It replaces
what was formerly expected at `83.229.87.94:8001`, which is currently down. It runs on the
Amsterdam compute box only; it is not an API-server component and has no GPU, database, volume,
or network dependency at request time.

**Verification status:** 16 service tests and a live Uvicorn health/conversion/error smoke pass in
an isolated local dependency directory. This host has no Docker daemon, so container build and
offline container smoke remain required on a Docker host before deployment.

## HTTP contract and parity

The only consumer contract captured from `chem_beo/index.js:2540` is:

```http
POST /convertSTR
Content-Type: application/json

{ "smiles": "CC(=O)Oc1ccccc1C(=O)O" }
```

The value is a **raw SMILES string**, not URL-encoded. On a usable conversion the service returns:

```http
200 OK
Content-Type: application/json

{ "sdf": "<SDF text>" }
```

The service creates an explicit-hydrogen, embedded **3D** conformer with RDKit ETKDGv3 followed
by MMFF optimization. Its successful SDF is newline (`\n`) delimited and ends with an SDF record
separator (`$$$$`), so the existing caller can use it without relying on its compatibility
fallback:

```js
const normalizedSdf = sdfJson.sdf.replace(/\r\n/g, '\n');
const sdfWithDelimiter = normalizedSdf.includes('$$$$')
  ? normalizedSdf
  : `${normalizedSdf}\n$$$$\n`;
```

`GET /health` is the liveness endpoint used by Compose. Its body is not a platform data contract;
a successful 2xx response is the requirement.

### Deliberate, documented differences

These choices are intentional rather than claims about the missing production implementation:

- **Fixed embedding seed.** The service fixes the ETKDG embedding random seed. The same accepted
  SMILES therefore produces reproducible coordinates and SDF output for a given image/RDKit
  version. Production's seed behavior is unknown.
- **Strict failures.** Invalid JSON, a missing or non-string `smiles`, an unparsable molecule,
  failed conformer embedding, failed MMFF optimization, or failed SDF serialization returns a
  non-2xx JSON response with a readable `error`. In particular, the service must never return a
  2xx response containing an empty, flat, partial, or otherwise unusable `sdf`. Chemistry-input
  and conversion failures are `400`, request-shape validation is `422`, and unexpected server
  faults are `500`.
- **Semicolons are rejected.** A `;` in `smiles` returns `400` with an explanation. The frontend
  has historically rewritten commas to semicolons, but accepting that ambiguous value would
  silently change molecular meaning. Callers must send valid SMILES rather than relying on a
  separator rewrite.

## Genuine unknowns

The original `:8001` service has no recoverable source copy and nothing listens on that port. The
success request/response above is the full observed platform contract, not a byte-for-byte
reference implementation. The following remain unknown and must not be represented as parity:

- the original RDKit version, embedding algorithm and parameters, random seed, force-field
  handling, conformer selection, atom ordering, and exact SDF header/formatting;
- whether it wrote explicit hydrogens, CRLF versus LF, or a trailing `$$$$` record delimiter;
- its status codes and error-body shape for malformed JSON, invalid SMILES, embedding/optimization
  failures, or a semicolon; and
- whether it accepted extra request fields or any non-raw/encoded SMILES variant.

The service guarantees chemical and HTTP usability, not identical coordinates or SDF bytes to the
unavailable service. The required acceptance checks are: aspirin (`CC(=O)Oc1ccccc1C(=O)O`) round
trips through RDKit to the same canonical SMILES, output has non-zero Z coordinates, and garbage
input produces a readable non-2xx error.

## Docker-only x86_64 build, test, and offline smoke check

Do not install Python, RDKit, or application dependencies on the operator's machine. Build and
run only the container image. Run these from a checkout on an x86_64 Docker host (the box), or use
a Docker builder capable of `linux/amd64`:

```bash
export REPO=/path/to/medsaas

docker build --platform linux/amd64 \
  --target test \
  --tag box-convertstr:test \
  "$REPO/deploy/box/convertstr"

docker run --rm --network none --platform linux/amd64 \
  box-convertstr:test

docker build --platform linux/amd64 \
  --target runtime \
  --tag box-convertstr:local \
  "$REPO/deploy/box/convertstr"
```

The build may fetch immutable image/package layers; the test container itself has no network. The
following smoke check starts the already-built image with Docker networking disabled, verifies the
health endpoint from inside the container, and submits one known SMILES. `curl` is required in the
image because the Compose healthcheck uses it too.

```bash
docker rm -f box-convertstr-offline 2>/dev/null || true
cleanup() { docker rm -f box-convertstr-offline >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --network none --platform linux/amd64 \
  --name box-convertstr-offline box-convertstr:local

healthy=false
attempt=1
while [ "$attempt" -le 30 ]; do
  if [ "$(docker inspect -f '{{.State.Running}}' box-convertstr-offline 2>/dev/null)" != "true" ]; then
    docker logs box-convertstr-offline >&2
    exit 1
  fi
  if docker exec box-convertstr-offline \
    curl --fail --silent --show-error http://127.0.0.1:8001/health; then
    healthy=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done

if [ "$healthy" != "true" ]; then
  docker logs box-convertstr-offline >&2
  exit 1
fi

docker exec box-convertstr-offline \
  curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  --data '{"smiles":"CC(=O)Oc1ccccc1C(=O)O"}' \
  http://127.0.0.1:8001/convertSTR
```

For the Compose-managed service, build and start this service alone, not the complete stack:

```bash
docker compose -f "$REPO/deploy/box/compose.yml" \
  --env-file "$REPO/deploy/box/.env" build convertstr

docker compose -f "$REPO/deploy/box/compose.yml" \
  --env-file "$REPO/deploy/box/.env" up -d convertstr
```

## Existing Compose integration and exposure boundary

No Compose change is required. `deploy/box/compose.yml` already defines `convertstr` with:

- build context `./convertstr`, container name `box-convertstr`, and port `8001`;
- health probe `curl -fsS http://localhost:8001/health` every 30 seconds; and
- published-port binding `${BIND_ADDR:-127.0.0.1}:8001:8001`.

The service also belongs to the private `box` Compose network. DiffDock reaches it only over that
network through `http://convertstr:8001/convertSTR` and declares `depends_on: [convertstr]`.

`convertSTR` is unauthenticated by design only because it is a **private compute dependency**. It
must never be exposed to the public internet. Keep `BIND_ADDR` on loopback while testing; for the
83-to-box cutover, bind it to the approved private/VPN interface and allowlist 83 only. Do not set
`BIND_ADDR=0.0.0.0`, and do not add a public proxy, DNS record, or public firewall rule. The
platform-side `SDF_CONVERTER_URL` retains the `/convertSTR` path and changes host only. Cut over
that one setting after the offline and live probes pass. No functioning converter rollback exists:
port `8001` on 83 is already down and its source is gone.
