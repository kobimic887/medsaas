# Box spec — what was ordered, and why

**Status:** configured and priced; purchase enquiry with Coreto. Supersedes the machine spec
in [COMPUTE-BOX-MIGRATION.md](./COMPUTE-BOX-MIGRATION.md), which described an earlier
configuration for an earlier workload.

**RECT WS-3229C** (RECT-ID 1493), Coreto/RECT, Friedberg DE. **€24,727.00 net**, ex VAT,
delivered to the Netherlands. Budget was ~€25k net.

---

## 1. Why this machine exists

**Asinex's servers are in Moscow, and they go down because of the war.**

That is the reason for the purchase. Not throughput, not cost, not self-reliance as a
principle. Every docking job the platform runs today — both engines — is answered by a host
in a country under sanctions, in a war, on infrastructure nobody involved can influence.
When it is down, `app.pyxis-discovery.com` cannot dock, which is the product.

The box moves the docking path into a building in Amsterdam under our own control, in the
EU. Everything else in this document follows from that, including choices that look like
overspending until you remember the machine exists to *not be unavailable*.

### The second reason: this is the part that cannot be bought

Structure prediction and molecule generation are available, well-served, on NVIDIA's hosted
NIM (`health.api.nvidia.com`), on datacenter parts we will not beat per job. They stay
there — permanently, not "until the OSS stack works". `/api/openfold3/predict` and
`/api/generate-molecules` are untouched by this move.

Docking at the shape this product wants is not available that way. So it is the thing being
built here.

**Selection rule for the purchase: spec for docking. Anything that benefits incidentally is
welcome; nothing that only benefits incidentally gets a euro.** Tanimoto search, ADMET,
GROMACS and the glioblastoma model all get faster on this machine — none of them justified
changing a component.

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

**So the workload is interactive latency, not batch throughput.** One user, one ligand,
watching a spinner. That determined the GPU choice more than any core-count table.

### DiffDock is Asinex's, not NVIDIA's

Worth stating because it is easy to get backwards. Only two endpoints in this codebase call
NVIDIA: MolMIM (`server/index.js:268`) and OpenFold3 (`:319`), both at
`health.api.nvidia.com`. **DiffDock calls `services.asinex.com:58000`** (`:88`).

The path and payload (`ligand_file_type`, `num_poses`, `time_divisions`, `steps`,
`save_trajectory`, `is_staged`) are the NVIDIA DiffDock **NIM container** schema exactly — so
Asinex pulled the NIM container and runs it on their own GPU. NIM software, Moscow hardware.

**Consequence: DiffDock dies with Asinex.** It is not something the move preserves for free.
Rebuild it locally from **OSS DiffDock** (`gcorso/DiffDock`, MIT) — the NIM container needs
NVIDIA AI Enterprise, which was refused, and NIM is not supported on GeForce anyway.

---

## 2. The configuration

| Component | Choice |
|---|---|
| Chassis / board | RECT WS-3229C, Big-Tower (black, noise-damped), AMD **WRX90**, 2× 10 GbE, IPMI 2.0 over LAN |
| CPU | AMD Ryzen Threadripper **PRO 9975WX** — 32C/64T, 4.00 GHz base, 5.40 GHz turbo, 128 MB cache |
| CPU cooling | High-efficiency Noctua air cooler (**not** the €26 AIO — see below) |
| Memory | **128 GB DDR5-5600 ECC Reg — 4× 32 GB RDIMM** |
| GPU | **2× NVIDIA GeForce RTX 5090, 32 GB GDDR7** |
| Boot / data | **2× 2 TB Samsung 9100 PRO (PCIe 5.0), RAID 1 mirror** |
| Scratch | 1× 4 TB Samsung 9100 PRO (PCIe 5.0), unmirrored |
| Archive | 1× 24 TB Toshiba MG Enterprise, 7200 rpm SATA |
| PSU | 2200 W, high-efficiency, single |
| OS | Ubuntu Server 24.04 LTS, headless, pre-installed on the mirror |
| Warranty | **36 months pick-up** — on-site was not available for the Netherlands |
| **Total** | **€24,727.00 net** |

One M.2 slot of four remains free.

---

## 3. Why each choice, including the ones that look wrong

### GPU — 2× RTX 5090, not RTX PRO, not four cards

**There is no bigger card.** The RTX 5090 and the RTX PRO 6000 Blackwell are the **same
GB202 die** — full chip is 192 SM, the PRO gets 188 enabled, the 5090 gets 170. Same 512-bit
GDDR7, same ~1,792 GB/s. The 5090 is 89 % of the largest Blackwell silicon NVIDIA makes, for
€4,417 against €13,090.

So "buy one big card instead" has no referent. The only question was how many of the best
card, and whether the PRO line's ECC and VRAM were worth 2–4× the price on a workload whose
docking working set is about 2 GB.

€ per SM, Coreto's list, net:

| Card | SM | Price | €/SM |
|---|---|---|---|
| RTX 5070 Ti | 70 | €1,029 | 15 |
| RTX 5080 | 84 | €1,355 | 16 |
| **RTX 5090** | **170** | **€4,417** | **26** |
| PRO 4000 24 GB | 70 | €2,154 | 31 |
| PRO 4500 32 GB | 82 | €3,364 | 41 |
| PRO 5000 48 GB | 110 | €6,259 | 57 |
| PRO 6000 96 GB | 188 | €13,090 | 70 |

**Four cards is physically capped at two GeForce.** Coreto's configurator counts GPU slots
against a **4-piece maximum**: every GeForce card takes 2, every RTX PRO takes 1. So the
four-card path exists only in PRO parts — and 4× PRO 4500 is 328 SM for €13,456 against
2× 5090's **340 SM for €8,834**. More compute, €4,622 less. 4× PRO 4000 is 280 SM for
€8,616 — fewer SM for the same money, and each card is ~40 % of a 5090 on a single job.

For an interactive single-ligand workload that last point is decisive: with four slow cards,
three sit idle while the one user waits twice as long.

**Two cards rather than one** is a redundancy decision, not a throughput one. A dead GPU on a
pick-up warranty is weeks with no docking, and the whole point of the machine is not being
unavailable. Two also lets one user run DiffDock while another runs AutoDock.

The 5090's 1,792 GB/s also earns its place on DiffDock specifically, which is
bandwidth-bound (PyTorch + e3nn tensor products) rather than compute-bound.

### CPU — 32 cores, and the bigger part would be slower

Not a budget answer. The workload is one user waiting on one ligand — **latency, not
throughput** — and the 64-core 9985WX gives up 20 % base clock (3.20 GHz vs **4.00 GHz**) to
fit twice the cores in the same envelope, for €6,977 against €2,761.

The extra cores would idle, because **AutoDock-GPU does the docking on the 5090s.** The CPU
does receptor preparation, `autogrid` map generation, ligand conversion, and the CPU-side of
Tanimoto/Postgres.

**`autogrid` maps are per-receptor, CPU-bound, ~30–60 s, and cacheable** — roughly 60 MB per
target. Once a protein is cached, every subsequent ligand against it skips that step
entirely. That is why 32 cores is enough: grid generation happens once per target, not once
per dock.

32 cores also keeps classic CPU AutoDock Vina viable as a reference/fallback path, which is
the one scenario where cores would become the engine.

### Memory — 128 GB as 4× 32 GB

**Four modules, not two.** The configurator offers 128 GB as 2× 64 GB for €104 *less* than
4× 32 GB — which populates half the channels and halves memory bandwidth. A trap; avoided.

128 GB is more than docking alone needs. It is justified by everything else that lands on
this box: Postgres with the RDKit cartridge and fingerprint GiST indexes (Tanimoto),
Mongo, RabbitMQ, ADMET workers, and per-job docking prep. It is also the hedge on the
catalog — `dev.asinex.com:58181` is in the same Moscow, and when it goes down for the same
reason, moving it here wants the RAM.

Eight-channel memory was never bought: a genuine 8-channel fill (8× 32 GB) is €9,932, and the
original case for eight channels was MSA bandwidth, which left with the MSA.

### Storage — three tiers with three different failure semantics

**RAID 1 mirror for OS, Docker, Mongo and config.** Not because disks fail often, but
because **on-site service is not available in the Netherlands**. Any component failure ships
a 30 kg tower to Germany and takes docking out for one to three weeks. Internal redundancy
is the only protection this machine has, which is the same reason there are two GPUs.

**Scratch is deliberately *not* on the mirror.** RAID 1 doubles every write. Docking is
write-churn — per-job temp dirs, PDBQT conversions, `autogrid` output, DiffDock's 100 poses
per call — and running that through the mirror burns both drives' 1200 TBW endurance at
twice the rate, for data that gets thrown away. The unmirrored 4 TB absorbs it.

**RAID 1 is not a backup.** It survives a dead disk, not a bad `DROP`, not a fire, not a
theft. Offsite backup is still unsolved and still required — see
[COMPUTE-BOX-MIGRATION.md §6](./COMPUTE-BOX-MIGRATION.md#6-storage-what-goes-on-which-medium).

**No RAID 0 anywhere.** A single 9100 PRO does 14.8 GB/s and 2.2M IOPS against a workload
that reads ~60 MB of grid maps per job and writes ~100 KB of poses. Striping would double
the failure surface of the scratch volume to fix a bottleneck that does not exist.

The 24 TB Toshiba MG replaced an 8 TB WD Red Plus for €565: enterprise 7200 rpm instead of
5400 rpm NAS, and Coreto's list is mispriced at the top end (the 22 TB at €797 is cheaper
than the 20 TB at €833).

### PSU — 2200 W

2× 575 W GPU + 350 W CPU + board, drives and 10 GbE ≈ **1,620 W continuous**, over what a
1600 W unit should carry, before the RTX 5090's transient spikes. The 2200 W was €44 more
than the 1600 W and carries four 12+4-pin GPU connectors instead of two.

### Air cooling, not the €26 AIO

350 W is well inside a Noctua TR5 tower's rating — the CPU is not the thermal constraint;
two 575 W triple-slot cards are. An AIO adds a pump, the only wear part with a single point
of failure in the cooling system, on a machine where a failure means weeks of downtime. The
€26 upcharge also buys a basic AIO in place of an included €100+ Noctua.

---

## 4. Open — Coreto has not confirmed this build

**The only technical unknown left: will Coreto build and warranty two triple-slot RTX 5090s
in the noise-damped Big-Tower?** Their own KeyFacts say *"up to 4× RTX PRO 6000 Blackwell
**or 2×** GeForce RTX 5090/5080"*, so two is within their stated envelope — but slot spacing
between the two x16 slots they select, and airflow between two adjacent axial-cooled cards
under sustained 100 % load, have not been answered. This machine will run close to
continuously, not in bursts.

Also outstanding with them: confirmation that the 2200 W is rated for this build including
transients, that the two free-text fields (RAID 1 with an EFI System Partition on **both**
mirror disks; NVIDIA **570-branch** driver with CUDA 12.8+, not the 550 branch) will be
honoured, intra-EU B2B reverse-charge VAT treatment against the Pyxis VAT number, shipping
cost to the Netherlands, and lead time.

**Not from Coreto:** buy a third 2 TB NVMe retail (~€200) and keep it on a shelf. Pick-up
warranty turns any drive failure into weeks of downtime; a spare turns it into an afternoon.

---

## 5. What is not being replaced, and why

"Replace Asinex" is four services, and only two of them are this machine's job.

| Asinex service | Config key | Replaced? |
|---|---|---|
| 1-click docking `services.asinex.com:8000` | `dockingApiUrl` | **Yes** — AutoDock-GPU locally |
| DiffDock `services.asinex.com:58000` | `diffdockApiUrl` | **Yes** — OSS DiffDock locally |
| Catalog + structure search `dev.asinex.com:58181` | `catalogApiBase` | Not now. Postgres + RDKit could, but it needs the Asinex compound file — a licensing question, not a hardware one |
| Stock & availability `stock.asinex.com:5443` | `stockApiUrl` | **Cannot be.** No machine computes whether Asinex has 5 mg on a shelf. Keep calling them, negotiate a feed, or drop the feature — owner's call, "when needed" |

Pricing is already half-local: the `mol_price` collection is imported from xlsx
(`import:mol-price`, served at `server/index.js:2316` and `:5649`). What is genuinely
missing without Asinex is **live availability**, not price.

---

## 6. Still open, and it blocks Phase 0

**The Oracle-versus-83 data question.** The owner states the user data on Oracle does not
matter and only the data on 83 does. That contradicts Pile 1 in
[COMPUTE-BOX-MIGRATION.md](./COMPUTE-BOX-MIGRATION.md), which moves Mongo off Oracle *with a
data restore*. Either 83 proxies to Oracle (and Oracle's Mongo is production after all), or
**83 has its own backend and database that has never been inventoried**.

This never blocked the hardware. It does block the migration sequence, and it turns "what
answers the production API on 83" from a nice-to-know into the thing Phase 0 depends on.
Answer it on that machine, not from here.
