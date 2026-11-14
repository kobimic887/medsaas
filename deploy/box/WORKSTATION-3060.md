# RTX 3060 compute preparation

Use the standalone [`compose.3060.yml`](compose.3060.yml) to prepare only CPU Vina,
convertSTR and OSS DiffDock. Folding remains hosted NVIDIA. This is preparation,
not evidence of working GPU inference or permission to change the live application.
Run these gates directly in a workstation terminal, or through private SSH for
assisted setup; remote access is optional.
Do not install this scientific toolchain on an ARM laptop or VPS.

## Optional remote access

Preparation can be copied and run locally without remote access. For assisted setup,
join the workstation to the existing private Tailscale network and enable SSH on
its Linux environment (Ubuntu/WSL2 for Windows). Install the laptop's **public**
SSH key in that user's `~/.ssh/authorized_keys`; keep private keys on the laptop.
Use the workstation's private hostname for `ssh USER@HOST`, and verify its host-key
fingerprint on the workstation before accepting it. Do not open router ports or
publish compute endpoints to the internet. With WSL2, measure whether SSH reaches
the Linux environment and Docker's GPU runtime; a Windows login alone does not
establish either. Share only the private hostname and Linux username for access;
passwords/tokens, if needed, belong in the secure credential prompt.

## Read-only host gate

On the intended Linux x86_64 Docker host (or GPU-enabled WSL2), measure:

```bash
uname -m
free -h
df -h /srv
nvidia-smi --query-gpu=index,name,memory.total,driver_version --format=csv
docker version
docker compose version
```

Confirm the RTX 3060, available VRAM, compatible NVIDIA driver/container toolkit,
and enough disk for CUDA images and model downloads. No inference capacity or
latency is implied by the model name. Do not change firewall, drivers or unrelated
services as part of this checklist. Start with no concurrent GPU workloads.

## Prepare one service at a time

From the repository root on that host:

```bash
sudo install -d -o 10001 -g 10001 -m 0750 /srv/cache
sudo install -d -m 0750 /srv/models/diffdock
docker compose -f deploy/box/compose.3060.yml config --quiet
docker compose -f deploy/box/compose.3060.yml build docking
RUN_VINA=1 ./deploy/box/docking/service/test.sh
docker compose -f deploy/box/compose.3060.yml up -d docking
```

The Vina test performs real RCSB/receptor preparation and docking. Verify its
artifacts using [the docking contract](../../docs/DOCKING-CONTRACT.md), then qualify
scientific pose behavior. `autodock-gpu` remains an unavailable stub.

```bash
docker compose -f deploy/box/compose.3060.yml build convertstr diffdock
sudo deploy/box/diffdock/fetch-weights.sh /srv/models/diffdock
docker compose -f deploy/box/compose.3060.yml run --rm --no-deps \
  -v /srv/models/diffdock:/models \
  -v "$PWD/deploy/box/diffdock/prepare-embeddings.py:/prepare-embeddings.py:ro" \
  diffdock python /prepare-embeddings.py
# Verify the GPU is available inside this exact image and execute a CUDA operation.
docker compose -f deploy/box/compose.3060.yml run --rm --no-deps diffdock \
  python -c 'import torch; assert torch.cuda.is_available(); x=torch.ones((32,32),device="cuda"); assert (x@x)[0,0].item()==32; print(torch.cuda.get_device_name(0))'
docker compose -f deploy/box/compose.3060.yml run --rm --no-deps diffdock \
  python -m diffdock_service preflight
docker compose -f deploy/box/compose.3060.yml up -d convertstr diffdock
```

The one-shot embedding preparation mounts models writable; serving mounts them
read-only. The model fetch checks the pinned archive SHA-256. Never substitute
untrusted checkpoints: the runtime permits legacy checkpoint loading required by
this pinned upstream stack. No request should trigger a fresh model download.

Submit a complete qualified PDB/SDF pair to the loopback generation endpoint,
starting with one pose. The canonical fixture contains a truncated receptor and
cannot qualify inference. Verify positive usable pose count, finite coordinates
and confidences, alignment, elapsed time and GPU peak memory. Increase requested
poses only after measuring the smaller case. Batch size 2 is a starting setting,
not a guarantee that every receptor fits. Record image digest, dependency versions,
GPU/driver, inputs and measurements privately.

## Live cutover gate

Ports stay on loopback. Before application traffic, qualify private connectivity
and access controls from the application host, then the actual authenticated
submission, persistence, viewer and failure/refund path. The live gateway timeout
must accommodate measured inference; a process health response is insufficient.
Ask the owner before any change on 84, including tunnels or service settings.
Keep the measured provider endpoint recorded, but do not call an unavailable
provider a working rollback. Restore the previous app configuration on a failed
cutover and report the remaining outage honestly. Stop only these named compute
services if preparation fails; preserve caches and weights for diagnosis.
