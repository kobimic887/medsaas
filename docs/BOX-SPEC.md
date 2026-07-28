# Box spec — re-quote request

**Status:** open. The RECT WS-2229C configuration in
[COMPUTE-BOX-MIGRATION.md](./COMPUTE-BOX-MIGRATION.md) was specified for a workload that has
since changed. This document is the reasoning for a new Coreto quote and the list of
questions to put to them.

---

## 1. The decision that changes the spec

**Structure prediction and molecule generation stay on NVIDIA's hosted NIM.**
`/api/openfold3/predict` and `/api/generate-molecules` keep proxying to
`health.api.nvidia.com`. They are not brought in-house.

The reason is in COMPUTE-BOX-MIGRATION.md §5: NVIDIA almost certainly serves those endpoints
on datacenter parts (H100 ~3.35 TB/s, H200 ~4.8 TB/s HBM) against a resident MSA database.
Transformer inference tracks memory bandwidth, so a local RTX PRO card was always going to be
slower per cold job — and the MSA that NVIDIA does inside their call would have become ours,
at roughly two thirds of every job's wall clock.

**What the box is actually for, in priority order:**

1. **Docking** — AutoDock-GPU, AutoDock Vina, DiffDock. This is the point of the machine.
2. Everything else that can use CUDA — GROMACS, ADMET — explicitly a **bonus**, not a
   requirement, and not something to optimise the purchase around.
3. The rest of the backend — Express, Mongo, Postgres+RDKit, RabbitMQ, MCP server.

### Why docking and not everything

The goal is not self-hosting for its own sake. It is being **best at the one thing that
cannot be bought**.

Folding and molecule generation are available, well-served, on someone else's datacenter
GPUs — NVIDIA sells them, and sells them on hardware we will not beat per job. Docking at the
scale and in the shape this product wants is **not** available that way, on NIM or on any
other hosted service, so it is the thing being built here.

That is the whole selection rule for this purchase: **spec for docking. Anything that
benefits incidentally is welcome; nothing that only benefits incidentally gets a euro spent
on it.** GROMACS, ADMET, the glioblastoma model and the Tanimoto search all get faster on
this machine — none of them justifies changing a component.

### The largest saving here is not hardware

Keeping NIM deletes most of Pile 3:

| Removed from the build | Was going to cost |
|---|---|
| MMseqs2 / ColabFold MSA pipeline | the single biggest net-new engineering item |
| ColabFold reference databases | ~900 GB download, index build at ~2× transient size |
| OSS OpenFold3 / Boltz-2 deployment | model serving, weights, version pinning |
| CPU-stage/GPU-stage RabbitMQ pipelining | needed only because MSA was CPU-bound |
| MolMIM OSS replacement (REINVENT4 or similar) | an open decision — now moot |

That is weeks of work, and it is a bigger win than any card choice below.

**The cost of the decision, stated honestly:** sequences and structures continue to leave the
building for a third-party API, the NIM rate limit and per-call metering continue to apply,
and the platform keeps a vendor dependency that a deprecation or price change can break. The
owner has weighed that and chosen speed. Recorded so it is not rediscovered as a surprise.

---

## 2. What this does to the GPU choice — it inverts it

The old spec bought **VRAM**: 48 GB cards, MIG off, because OpenFold3 needs roughly a 32 GB
floor and 2×24 GB would not clear it.

Docking has the opposite profile. A single AutoDock-GPU or Vina-GPU run has a working set of
a couple of GB at most, and the jobs are independent. So:

> For docking throughput the figure of merit is **aggregate CUDA cores × clock per euro**,
> inside the power and slot budget. VRAM per card is nearly irrelevant.

More small cards beat fewer big ones, which is the exact reverse of the folding case.

| Config | Cards | Aggregate CUDA cores | GPU power | vs. 2×5000 |
|---|---|---|---|---|
| **A** (as ordered) | 2× RTX PRO 5000 48 GB | 28,160 | 600 W | baseline |
| **B** | 4× RTX PRO 4500 32 GB | 41,984 | ~800 W | **+49 % cores** |
| **C** | 4× RTX PRO 4000 24 GB | 35,840 | ~560 W | **+27 % cores, less power** |
| **D** | 2× RTX PRO 6000 96 GB | 48,128 | 600–1200 W | +71 % cores, 96 GB wasted |
| **E** | 4× RTX PRO 5000 48 GB | 56,320 | ~1200 W | +100 % cores, **likely over budget** |

Per-card figures: PRO 5000 = 14,080 cores / 48 GB / ~1.3 TB/s / 300 W · PRO 4500 = 10,496 /
32 GB / 200 W · PRO 4000 = 8,960 / 24 GB / 672 GB/s / 140 W · PRO 6000 = 24,064 / 96 GB.

### Budget

**~€25k net, with room to negotiate slightly above.** Rough allocation on the original
config: cards ≈ €10k, the other €15k is 64-core CPU, 128 GB ECC, ~14 TB of storage, board,
chassis, PSU, 2×10 GbE, IPMI, assembly and warranty.

That non-GPU €15k is largely fixed — it barely moves between options A–E, apart from the PSU
and possibly the board. So the whole question is **how many cores the GPU budget buys**, and
option E (4× PRO 5000, ~€20k of cards) almost certainly does not fit. **B is the realistic
ceiling.** Confirm against the line-item pricing before committing to that reading.

### The honest caveat, and it is a large one

**The AutoDock : DiffDock ratio is unknown, and the two want different hardware.**

- **AutoDock-GPU and Vina-GPU** are compute-bound with a tiny working set. Cores is the
  right metric. Option B or C wins clearly.
- **DiffDock** is PyTorch + e3nn tensor products and tracks **memory bandwidth** more than
  core count. Per card, a 672 GB/s PRO 4000 is meaningfully slower than a ~1.3 TB/s PRO 5000.

And the awkward part: **AutoDock-GPU and Vina do not exist in any traced repo.** DiffDock is
the only one of the three the product calls today (`POST /api/diffdock/generate`, proxied to
an Asinex-hosted URL). So the core-count table above is specifying €25k against a job mix
that has never actually run here.

Do not read the table as settled. It says *if the load is mostly AutoDock screening, buy more
smaller cards* — which is likely, because screening is the stated use case, but it is a
prediction.

### Which means: buy the chassis for four, populate for price

The irreversible parts of the purchase are the **board, chassis and PSU**. A 2-GPU chassis
with a 1200 W supply can never become a 4-GPU box. Cards can be added later; a backplane
cannot. So:

**Specify for four double-width cards. Populate two or four depending on the quoted €/card.**

- Board + chassis that physically seats **4 double-width** active-cooled cards with real
  airflow between them.
- PSU sized for 4× full card TDP + ~350 W CPU + drives → **~2000 W**, and confirm the
  Science Park circuit can carry it.
- The Threadripper 9980X has **88 usable PCIe 5.0 lanes**, so 4×16 plus NVMe fits. Whether
  the TRX50-class board Coreto uses actually seats four double-width cards is **their**
  question to answer, not something to infer from the lane count.

### Recommendation: 32 GB cards, i.e. option B

Not for the VRAM as such — docking does not need it — but because **24 GB permanently
forecloses ever bringing folding in-house.** COMPUTE-BOX-MIGRATION.md §5 argues that caching
the MSA on the protein-sequence hash inverts the NIM comparison for exactly this workload
(one target, many ligands), and that argument is untested. 32 GB keeps that a choice rather
than a closed door, and costs nothing today.

So: **NIM stays, and 32 GB cards mean that stays a decision we can revisit.**

---

## 3. CPU and memory — keep non-PRO, and here is the reason

**Threadripper 9980X (non-PRO, 64C, quad-channel) stays.** The case for Threadripper PRO was
eight memory channels, and it was made entirely on MSA: MMseqs2 is memory-bandwidth-bound and
four channels cost roughly 1.3 min/job versus eight. **MSA is leaving, so that argument
leaves with it.** Vina and AutoDock are compute-bound, not bandwidth-bound. Non-PRO is a real
saving on a re-quote, taken for a stated reason.

**Core count still matters, and arguably more than before.** Classic AutoDock Vina is
CPU-only and embarrassingly parallel; so are the RDKit/Tanimoto cartridge search, ADMET, the
glioblastoma RandomForest, and the CPU half of GROMACS. 64 cores is the right call.

**128 GB stays.** It was argued for concurrent MSA slots plus a hot Tanimoto fingerprint
index. The MSA half of that is gone, so 128 GB is now comfortable rather than tight — Mongo,
Postgres, RabbitMQ and an Asinex catalog mirror all fit. Do not reduce it; do not increase it.

---

## 4. Storage — revised, but do not cut the drive

Dropping the ColabFold databases frees roughly 900 GB **on the 4 TB NVMe**, not a whole disk:
`/srv/refdb`, `/srv/scratch` and `/srv/db` were all assigned to that same device.

Keep 2 TB + 4 TB NVMe + 8 TB HDD. What now fills the 4 TB:

| Mount | Contents after the change |
|---|---|
| `/srv/db` | Postgres `pgdata` — and this grows: the **Asinex catalog mirror** with RDKit fingerprint GiST indexes is not small. Plus Mongo `dbPath` |
| `/srv/scratch` | docking poses and per-job dirs (small), GROMACS running trajectories (**not** small) |
| `/srv/refdb` | no longer needed |
| `/srv/archive` (8 TB HDD) | finished outputs, `mongodump` / `pg_dump`, catalog dumps |

Offsite backup is still unsolved and still required — see COMPUTE-BOX-MIGRATION.md §6.

---

## 5. Questions to put to Coreto

1. **Line-item GPU pricing** for RTX PRO 4000 24 GB, 4500 32 GB, 5000 48 GB and 6000 96 GB.
   The 4×4500 vs 2×5000 decision hinges entirely on €/card and cannot be made without it.
2. Does the offered board and chassis seat **four double-width active-cooled** cards, with
   adequate spacing and airflow? If not, what platform does?
3. Maximum PSU available in that chassis, and its rating with four cards at full TDP.
4. Can the CPU be dropped from Threadripper PRO to non-PRO 9980X (or is it already), and
   what does that change on the board?
5. Delivery and warranty terms unchanged? The existing service level is **pick-up warranty** —
   a fault means the machine ships to Germany and is out for 1–3 weeks.
6. Is the quote re-issuable without losing the current delivery slot?
7. Target is **~€25k net**, with some room above it if the extra buys GPU throughput. State
   that, so they price the four-card option rather than assuming a hard ceiling.

---

## 6. Open, and now blocking

**The Oracle-versus-83 data question.** The owner states the user data on Oracle does not
matter and only the data on 83 does. That contradicts Pile 1 in COMPUTE-BOX-MIGRATION.md,
which moves Mongo off Oracle *with a data restore*. Either 83 proxies to Oracle (and Oracle's
Mongo is production after all), or **83 has its own backend and database that has never been
inventoried**.

This does not block the hardware quote. It does block the migration sequence, and it turns
"what answers the production API on 83" from a nice-to-know into the thing Phase 0 depends on.
Answer it on that machine, not from here.
