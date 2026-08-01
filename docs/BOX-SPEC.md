# Box spec — what to order, and why

> ## STATUS: ORDERED. Awaiting delivery.
>
> Placed 2026-08-01. Everything below is what was bought and why; the open items in §5 that
> were pre-order questions are now **things to check on the invoice and on arrival**, not
> decisions.
>
> **Nothing has been executed on the machine.** Do not write any doc, script or comment in
> the past tense about work done *on* it. The arrival sequence is
> [ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md).

**RECT WS-3229C** (RECT-ID 1493), Coreto/RECT, Friedberg DE, delivered to Amsterdam.
Budget ~€25k net.

---

## 1. Why this machine exists

**Asinex's servers are in Moscow, and they go down because of the war.**

That is the reason for the purchase. Not throughput, not cost, not self-reliance as a
principle. Every docking job the platform runs today — both engines — is answered by a host
in a country under sanctions, in a war, on infrastructure nobody involved can influence.
When it is down, `app.pyxis-discovery.com` cannot dock, which is the product.

The box moves the docking path into a building in Amsterdam under our own control, in the
EU. Everything else here follows from that, including choices that look like overspending
until you remember the machine exists to *not be unavailable*.

### The second reason: this is the part that cannot be bought

Structure prediction and molecule generation are available, well-served, on NVIDIA's hosted
NIM (`health.api.nvidia.com`), on datacenter parts we will not beat per job. They stay
there — permanently, not "until the OSS stack works". `/api/openfold3/predict` and
`/api/generate-molecules` are untouched by this move.

Docking at the shape this product wants is not available that way. So it is the thing being
built here.

**Selection rule for the purchase: spec for docking. Anything that benefits incidentally is
welcome; nothing that only benefits incidentally gets a euro.**

> ⚠ **That is a rule for choosing components, not for how the machine gets used.** The
> shorthand once drifted in `CLAUDE.md` into "those workloads get no attention", which is
> wrong. Once the money is spent, every cycle those workloads take is already paid for, and
> they run today on a shared VPS, a small Ampere VPS, or nowhere at all:
>
> | | Today | On the box |
> |---|---|---|
> | Tanimoto / RDKit search | Oracle Ampere **arm64** VPS, 2.9 M molecules | x86_64, 32 cores, 128 GB |
> | GROMACS MD | 83, Docker, **CPU-only apt build** | CUDA build |
> | ADMET | **never deployed.** Every job ever queued is still `status: "queued"` | GPU torch cu128 |
> | Glioblastoma | never deployed | runs at all |
>
> The rule forbids one thing only: **spending more money, or delaying the docking cutover,
> for their sake.** Docking goes first and alone; the rest comes after.

### What the workload actually is — verified in code, not assumed

Every docking path in this repo is **one protein, one ligand, synchronous, one credit**:

| Route | Payload | Backend |
|---|---|---|
| `POST /api/simulation` (`server/index.js:2822`, GET at `:2676`) | `{pdbid, smiles}` | `services.asinex.com:8000/docking` — **AutoDock**, confirmed by the Asinex/Pyxis CEO |
| `POST /api/diffdock/generate` (`:4392`) | `{protein, ligand}`, `num_poses: 100` | `services.asinex.com:58000/molecular-docking/diffdock/generate` |
| `POST /api/diffdock/generate_file` (`:4575`) | one protein, one ligand | dead code — calls `diff_dock.sh` at a `localhost:8000` NIM that has never run |

`batch` appears twice in the repo and neither is docking (`/tanimoto/v1/search/batch`,
`/glioblastoma/batch-predict`). RabbitMQ carries **ADMET only**. The client
(`client/src/pages/dashboard/simulation.jsx`) searches the catalog, takes **one** molecule,
posts once, blocks, and writes singular `localStorage` keys (`diffdock_result`,
`ligand_positions[0]`).

**So the workload today is interactive latency, not batch throughput.** One user, one
ligand, watching a spinner. Keep that in mind when reading the GPU decision below — it is
the one assumption the four-card choice trades against.

### DiffDock is Asinex's, not NVIDIA's

Easy to get backwards. Only two endpoints in this codebase call NVIDIA: MolMIM
(`server/index.js:268`) and OpenFold3 (`:319`), both at `health.api.nvidia.com`.
**DiffDock calls `services.asinex.com:58000`** (`:88`).

The path and payload (`ligand_file_type`, `num_poses`, `time_divisions`, `steps`,
`save_trajectory`, `is_staged`) are the NVIDIA DiffDock **NIM container** schema exactly — so
Asinex pulled the NIM container and runs it on their own GPU. NIM software, Moscow hardware.

**Consequence: DiffDock dies with Asinex.** It is not something the move preserves for free.
Rebuild it locally from **OSS DiffDock** (`gcorso/DiffDock`, MIT).

---

## 2. The configuration

| Component | Choice |
|---|---|
| Chassis / board | RECT WS-3229C, Big-Tower (black, noise-damped), AMD **WRX90**, 2× 10 GbE, IPMI 2.0 over LAN |
| CPU | AMD Ryzen Threadripper **PRO 9975WX** — 32C/64T, 4.00 GHz base, 5.40 GHz turbo, 128 MB cache |
| CPU cooling | High-efficiency Noctua air cooler (**not** the €26 AIO — see §3) |
| Memory | **128 GB DDR5-5600 ECC Reg — 4× 32 GB RDIMM** |
| GPU | **4× NVIDIA RTX PRO 4000 Blackwell, 24 GB** — settled by the owner 2026-08-01 |
| Boot / data | **2× 2 TB Samsung 9100 PRO (PCIe 5.0), RAID 1 mirror** |
| Scratch | 1× 4 TB Samsung 9100 PRO (PCIe 5.0), unmirrored |
| Archive | 1× 24 TB Toshiba MG Enterprise, 7200 rpm SATA |
| PSU | see §3 — **the 2200 W figure was sized for 2× 575 W GeForce and needs requoting** |
| OS | Ubuntu Server 24.04 LTS, headless, pre-installed on the mirror |
| Warranty | **36 months pick-up** — on-site was not available for the Netherlands |

One M.2 slot of four remains free.

**Price is not settled.** The €24,727 net figure quoted through 2026-07-31 was for 2× RTX
5090 (€8,834). Four PRO 4000 is €8,616 on Coreto's list — €218 less on the cards alone — but
the PSU and cooling were specified around two 575 W triple-slot GeForce parts and should come
down as well. **Get a fresh quote; do not carry the old total into a purchase order.**

---

## 3. Why each choice

### GPU — 4× RTX PRO 4000

Settled by the owner, 2026-08-01. The honest trade:

| | 4× PRO 4000 | 2× RTX 5090 |
|---|---|---|
| Total SM | 280 | 340 |
| Card price, Coreto net | €8,616 | €8,834 |
| VRAM | 4× 24 GB = 96 GB, **ECC** | 2× 32 GB = 64 GB, no ECC |
| Single-job speed | ~40 % of a 5090 | baseline |
| Concurrent jobs | **4** | 2 |
| Degradation on one dead card | to 75 % | to 50 % |
| GeForce driver EULA datacenter clause | **does not apply** | unresolved risk |

**Slower per interactive dock, better under load, and it closes a legal question.** Given the
workload today is one user waiting on one ligand (§1), the single-job regression is real and
should not be talked away — but four cards means four concurrent docks, the pick-up warranty
makes graceful degradation worth a lot, and the GeForce datacenter clause stops being an
unexamined assumption on a machine that will run near-continuously.

Two smaller consequences: PRO cards take **one slot each** rather than two, and draw far
less — so both the "will Coreto warranty two triple-slot 5090s in a noise-damped tower"
question and the 2200 W PSU sizing disappear with the GeForce parts.

> **⚠ NIM is still not an option, and RTX PRO does not change that.** Owner decision,
> 2026-07-31: *"we are not buying nvidia enterprise"*. NIM containers require an NVIDIA AI
> Enterprise licence **whatever card is installed** — "not supported on GeForce" was only ever
> the second of two blockers, and the first is a purchase that has been declined.
> **DiffDock is rebuilt from OSS `gcorso/DiffDock` (MIT). That is the plan, not the fallback.**
> Do not re-propose NIM and do not price AI Enterprise.

*Rejected, for the record:* a single bigger card has no referent — the RTX 5090 and RTX PRO
6000 are the same GB202 die (170 vs 188 SM enabled), so the 5090 is 89 % of the largest
Blackwell NVIDIA makes for €4,417 against €13,090. And Coreto's configurator caps GPUs at a
**4-slot budget** where GeForce takes 2 slots and RTX PRO takes 1, so any four-card build is
necessarily an RTX PRO build. €/SM across the line: 5070 Ti 15, 5080 16, 5090 26,
PRO 4000 31, PRO 4500 41, PRO 5000 57, PRO 6000 70.

### CPU — 32 cores, and the bigger part would be slower

Not a budget answer. The 64-core 9985WX gives up 20 % base clock (3.20 GHz vs **4.00 GHz**)
to fit twice the cores in the same envelope, for €6,977 against €2,761. Classic AutoDock Vina
is CPU-bound and embarrassingly parallel across 32 cores — a first-class workload here, not
an afterthought — but the interactive path wants clock.

### Memory — 128 GB as 4× 32 GB

ECC registered, and four DIMMs rather than eight so the channels can be filled later without
throwing the existing sticks away. Budget it explicitly once everything is resident: cap
Postgres `shared_buffers`, cap any Mongo WiredTiger cache, and run one ADMET worker, not four.

### Storage — three tiers with three different failure semantics

Mirror for anything whose loss costs time (OS, service state, the Tanimoto index). Unmirrored
NVMe for scratch that is regenerable by definition. Spinning archive for cold results.

### Cooling — air, not the €26 AIO

An AIO adds a pump: the only wear part with a single point of failure in the cooling system,
on a machine where a failure means weeks of downtime under a pick-up warranty. The €26
upcharge also buys a basic AIO in place of an included €100+ Noctua.

---

## 4. What runs on a GPU, and what a GPU cannot help

Blackwell is **sm_120** — both the 5090 and the RTX PRO Blackwell parts. That means CUDA
**≥ 12.8** and PyTorch **cu128** wheels everywhere. flash-attn must be built with
`TORCH_CUDA_ARCH_LIST="12.0"`, or use flash-attn 4.

| Workload | GPU? | What to do |
|---|---|---|
| AutoDock-GPU | **Yes** | build for sm_120. **The throughput workhorse, and the reason the box is being bought** |
| DiffDock | **Yes** | cu128 torch. Bandwidth-sensitive (e3nn tensor products), not purely core-count-sensitive |
| GROMACS | **Yes** | current image is the Ubuntu distro package = **CPU only**. Rebuild from source with `-DGMX_GPU=CUDA`; do not ship the apt build |
| ADMET-AI (chemprop) | Yes, marginal | models are tiny, GPU barely helps — but install the **cu128 torch wheel BEFORE `admet-ai`** |
| AutoDock Vina (classic) | No | CPU, embarrassingly parallel across 32 cores |
| Tanimoto / RDKit cartridge search | No | CPU + RAM-resident index; no CUDA path exists |
| Glioblastoma predictor | No | scikit-learn RandomForest. CPU |
| Folding / molecule generation | n/a | **stays on hosted NIM, permanently.** Not built here |

**Why folding stays hosted, settled 2026-07-28:** the gain would not be per-job speed. NVIDIA
almost certainly serves OpenFold3 on datacenter parts (H100 ~3.35 TB/s, H200 ~4.8 TB/s HBM3)
against a workstation card's ~1.79 TB/s, and transformer inference tracks memory bandwidth.
Worse, the hosted call includes the **MSA** — locally that becomes ours, roughly ⅔ of job wall
clock, pure CPU, and no GPU touches it. Building it means an MSA pipeline plus ~900 GB of
reference databases. The strongest counter-argument is that an MSA cache keyed on protein
sequence would make a 300-ligand screen inference-only — but that rests on an untested
assumption, and there is a hosted endpoint that already works.

**Everything that was not on NIM is a straight upgrade**, because what it replaces is a
2 vCPU / 12 GB free-tier Ampere instance (and for GROMACS, a CPU-only build): Tanimoto search
goes arm64 → x86_64 with 32 cores; GROMACS gains CUDA; ADMET and glioblastoma get deployed at
all, for the first time.

---

## 5. Open — to settle before the order goes in

**1. VAT — worth ~€5.2k, and it is not automatic.** Purchaser is **Pyxis Discovery BV**,
Science Park 408 Unit 1.05, 1098 XH Amsterdam, **VAT ID NL811799189B01**. Coreto AG is in
Friedberg, Germany (VAT DE218312839), so this is an intra-EU B2B supply and qualifies for
**reverse charge at 0 % VAT, delivered to Amsterdam**. On a ~€24.5k net order, German VAT
would add roughly €5,200. **Ask for it explicitly and check it on the invoice** — a quote
issued with VAT applied is the default, not an error to be corrected later.

**2. A fresh quote for the four-card build.** The configuration changed after the €24,727
figure was produced. Confirm the PSU rating for 4× PRO 4000 (it should fall well below
2200 W), and that four single-slot PRO cards fit the board's slot layout.

**3. The two free-text build requests, in writing.** RAID 1 with an EFI System Partition on
**both** mirror disks, and the NVIDIA **570-branch** driver with CUDA 12.8+, not the 550
branch.

**4. Shipping cost to the Netherlands, and lead time.**

**Not from Coreto:** buy a third 2 TB NVMe retail (~€200) and keep it on a shelf. Pick-up
warranty turns any drive failure into weeks of downtime; a spare turns it into an afternoon.

*(Coreto shop credentials are deliberately not recorded in this repo. They are in the owner's
email, and that is where they stay.)*

---

## 6. What is not being replaced, and why

"Replace Asinex" is four services, and only two of them are this machine's job.

| Asinex service | Config key | Replaced? |
|---|---|---|
| 1-click docking `services.asinex.com:8000` | `dockingApiUrl` | **Yes** — AutoDock-GPU locally |
| DiffDock `services.asinex.com:58000` | `diffdockApiUrl` | **Yes** — OSS DiffDock locally |
| Catalog + structure search `dev.asinex.com:58181` | `catalogApiBase` | Not now, but **temporary**. Postgres + RDKit could do it; it needs the Asinex compound file — a licensing question, not a hardware one |
| Stock & availability `stock.asinex.com:5443` | `stockApiUrl` | Not by this machine — no computer determines whether Asinex has 5 mg on a shelf. **Also temporary**: to be moved later by a data feed or a different supplier. Buyer has accepted the interim |

Pricing is already half-local: the `mol_price` collection is imported from xlsx
(`import:mol-price`, served at `server/index.js:2316` and `:5649`). What is genuinely
missing without Asinex is **live availability**, not price.

---

## 7. The database, and the concentration risk

⚠ **Clarified 2026-08-01, because both of the obvious summaries are wrong.**

An earlier §6 said *"83's Mongo is production"*. An earlier draft of this rewrite then
over-corrected to *"the database has nothing to do with 83"*. Neither is right:

- **The database is not hosted on 83.** It is **MongoDB Atlas**, measured over SSH on
  2026-07-28 — see [PRODUCTION-83-INVENTORY.md](./PRODUCTION-83-INVENTORY.md). Database name
  is `test`. It is not on 83 and not on Oracle, and it does **not** move to the box.
- **But 83 is effectively the only machine that can reach it.** Atlas enforces an IP
  allowlist and 83 is on it. That is why the server **cannot be booted from a dev machine** —
  Atlas rejects a non-allowlisted IP with TLS alert 80, which reads as a confusing handshake
  failure rather than an access error. Any rig that needs real data has to run *on 83*.

So "83's database" is wrong about hosting and right about access. Say it precisely: **Atlas
holds it; 83 is the only thing allowlisted to talk to it.**

**The arrival-day consequence is a simplification.** The critical path — docking, DiffDock,
convertSTR, Tanimoto — **never opens a Mongo connection**, so none of it needs an Atlas
allowlist entry. Arrival day can complete with the box unable to reach the database at all.

⚠ **But one later service does need it, and it is easy to miss.** The **ADMET worker** polls a
Mongo job collection — `deploy/box/compose.yml:186` passes it `MONGODB_URI`. So before ADMET
can run ([ARRIVAL-RUNBOOK.md](./ARRIVAL-RUNBOOK.md) §11), **the box's IP must be added to the
Atlas allowlist**, and nothing about the failure will say so: a non-allowlisted IP is rejected
with TLS alert 80, which reads as a handshake error rather than an access error.

That also removes most of the concentration risk this section used to warn about. Because the
API stays on 83 and the database stays in Atlas
([BOX-ARCHITECTURE.md](./BOX-ARCHITECTURE.md)), the box is **compute only**. If it dies:
docking stops, and the product survives. That is the whole reason for the split, and it is
what makes a pick-up warranty tolerable.

What is genuinely concentrated is **docking itself** — one chassis, no second site. The RAID 1
mirror covers a disk, four cards cover a GPU, and the retail spare NVMe covers a rebuild
afternoon. Nothing covers the chassis, and the accepted answer is that Asinex remains
reachable as a fallback for as long as Moscow is up.
