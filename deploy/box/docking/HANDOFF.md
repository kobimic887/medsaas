# Docking maintenance entry point

The implementation is in [`service/`](service/). Use its [README](service/README.md)
for engines, configuration, cache behavior and verification commands.

- [Acceptance requirements](BRIEF.md)
- [Application response contract](../../../docs/DOCKING-CONTRACT.md)
- [Reference fixtures](reference/README.md)
- [Compute cutover](../../../docs/ARRIVAL-RUNBOOK.md)

Do not treat old session state or test counts as evidence that the current build is ready.
For a release, verify the selected real engine on the target runtime and keep the canonical
response verifier and receptor-coordinate checks intact. Replay tests establish compatibility;
they do not establish inference quality, performance or hardware readiness.
