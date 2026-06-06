# Runtime Environment Report

_Generated: 2026-06-04T20:46:20.419Z_
_Target: local_

## Local Runtime

| Binary | Path | Version |
|--------|------|---------|
| `bun` | `/Users/kobigenis/.bun/bin/bun` | 1.3.14 |
| `node` | `/opt/homebrew/opt/node@22/bin/node` | v22.22.3 |
| `npm` | `/opt/homebrew/opt/node@22/bin/npm` | 10.9.8 |
| `docker` | not found | — |

## Oracle Runtime

_Not probed (target=local). Oracle host: `oracle`._

**Exact command form used for oracle noninteractive checks:**

```bash
ssh oracle 'bash -lc "for b in bun node npm docker; do echo -n \"$b: \"; command -v $b 2>/dev/null && $b --version 2>/dev/null | head -1 | tr -d \"\\n\" || echo not_found; echo; done"'
```

## Execution Path

Phase 5 server runtime scripts invoke binaries by name through npm scripts.
The exact binary executed depends on which is first on the execution host PATH.

| Context | Default runtime binary | Rollback binary |
|---------|----------------------|-----------------|
| Local dev/prod | `bun` | `node` |
| Oracle (smoke/measurement) | depends on host PATH / container | install or activate explicitly |

Later plans (05-02, 05-03) that run smoke tests or capture measurements MUST
verify `bun --version` succeeds on the execution host before proceeding.

## Blocking Missing Runtime

None — all required binaries found on local host.
