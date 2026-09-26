# Compute ingress

The supplied Caddy configuration exposes scientific services over HTTPS while their
container ports stay bound to loopback. A host firewall restricts HTTPS access to the
application host and approved operators. TLS encrypts requests; the allowlist controls
who can use these unauthenticated compute endpoints.

## Route contract

| Public path | Loopback target | Application setting | Prefix behavior |
|---|---|---|---|
| `/docking*` | `8000` | `ASINEX_DOCKING_API_URL` | Retained |
| `/convertSTR*` | `8001` | `SDF_CONVERTER_URL` | Retained |
| `/molecular-docking/*` | `8002` | `DIFFDOCK_API_URL` | Retained |
| `/tanimoto/*` | `8003` | `TANIMOTO_API_BASE` | Stripped |
| `/glioblastoma/*` | `8005` | `GLIOBLASTOMA_API_BASE` | Stripped |
| `/gromacs/*` | `8006` | `GROMACS_API_BASE` | Stripped |
| `/ingress-health` | Caddy response | — | Returns `ok` |

Other paths return `404`. A successful ingress-health response does not prove any backend.
DiffDock has no explicit proxy response timeout in this Caddyfile; validate any timeout
change against long-running requests and the application deadline.

## Installation prerequisites

Use [operations](../../../docs/OPERATIONS.md) for the approved host, domain and recovery
plan. Review scripts before running them on shared hosts:

- `install.sh <box-domain> <admin-email>` installs/configures host Caddy, checks domain
  resolution, validates the rendered configuration and reloads or restarts Caddy.
- `firewall.sh <allowed-ip> [more-allowed-ips...]` changes host firewall policy. It removes
  existing port-443 grants, allows the supplied addresses, allows SSH and ACME port 80,
  and enables the firewall. It is not scoped to one application.

Use measured addresses; old host names in script comments are not deployment inputs.
Confirm the intended DNS target separately: successful name resolution alone does not
prove it points to this machine. Preserve recovery access before firewall/SSH changes.

## Verify the boundary

1. Verify all compute container publications remain on loopback.
2. Confirm HTTPS works from the application host and approved operator address.
3. Confirm HTTPS and direct compute ports are inaccessible from an unapproved host.
4. Open a fresh SSH session to verify management access still works.
5. Exercise each backend through its prefixed route before changing application settings.

Docker port publishing can bypass host firewall assumptions, so inspect actual bindings
and test from outside; firewall status output is insufficient. The supplied host Caddy
setup uses public port 80 for certificate validation. Do not close it without a separately
configured and verified certificate-renewal method.
