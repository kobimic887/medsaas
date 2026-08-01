# ADMET worker

Predicts ADMET properties for docked compounds and writes them back to the platform.

**This has never run.** `chem_beo` has been publishing ADMET jobs to CloudAMQP since the
feature shipped and no consumer has ever connected, so every job any user ever queued is
still `status: "queued"`. Nobody noticed for months, because noticing would have meant
watching a broker's queue depth.

That is the actual argument for the rewrite. The broker is gone; jobs live in the
`admet_jobs` collection in the same MongoDB the platform already uses, so *"how many jobs
are stuck?"* is a `find()` instead of a management API nobody was going to open.

```
     server/utils/admetQueue.js                     services/admet
  ┌──────────────────────────────┐            ┌───────────────────────────┐
  │ createAdmetTask()            │ admet_jobs │ claim (atomic)            │
  │  · unique on simulationKey   │◀──────────▶│ heartbeat while predicting│
  │  · revives failed jobs       │            │ predict                   │
  │ getQueueStatus() counts      │            │ PUT result, then mark done│
  └──────────────────────────────┘            └───────────────────────────┘
                    ▲                                       │
                    └───── PUT /api/simulation/{key}/admet ─┘
                                 x-admet-secret
```

---

## Run it

```bash
# tests — no GPU, no network, no model, no Mongo
docker build --target test -t pyxis-admet-test services/admet
docker run --rm pyxis-admet-test

# the real image — x86_64, CUDA. Build it on the box.
docker compose -f deploy/box/compose.yml --env-file deploy/box/.env --profile extras build admet
```

One-shot smoke test on the box, before letting it loop:

```bash
docker compose -f deploy/box/compose.yml --profile extras run --rm admet python -m admet_worker --once
```

Config is in [`.env.example`](.env.example). Three variables are mandatory and the worker
**refuses to start** without them — `MONGODB_URI`, `ADMET_CALLBACK_URL`,
`ADMET_CALLBACK_SECRET`. Refusing up front is deliberate: a worker that started without a
secret would claim jobs, spend GPU time on them, and only then fail delivery with a 401.

⚠ The header is `x-admet-secret` and the server reads `ADMET_CALLBACK_SECRET`
(`server/index.js:1700`). `deploy/box/compose.yml` used to pass `ADMET_CALLBACK_TOKEN`,
which would have been silently empty. Both are `ADMET_CALLBACK_SECRET` now.

---

## The five things this gets right that the old one did not

**1. A stuck job is visible.** `GET /api/rabbitmq/queue-status` (path kept for
compatibility; the transport under it is Mongo now) returns counts per state, the oldest
queued timestamp, and how many `running` jobs have gone quiet.

**2. Two workers cannot take the same job.** The claim is a single
`find_one_and_update` with `status: "queued"` in the *filter*. The loser's filter stops
matching, so it gets `None` rather than a duplicate. Tested with two queues over one
collection.

**3. A worker killed mid-job does not lose it.** The worker touches `heartbeatAt` while it
predicts; anything `running` with a heartbeat older than 15 minutes goes back to the queue.
Every worker reaps on every poll, so recovery does not depend on someone visiting an admin
page.

**4. Retries end.** Three attempts, then the job is parked in `error` with the message. The
old path had no attempt count at all. A job with no SMILES is parked immediately rather than
burning two more attempts on something that cannot succeed.

**5. A failed callback is not success.** If the prediction works and the PUT is rejected,
the job returns to `queued`, not `done`. The platform never got the data, so the job is not
finished.

---

## The SMILES quoting bug, and where it went

The old producer did:

```js
smiles: simulation.smiles.split(',').map(smile => `"${smile.trim()}"`)
```

— wrapping every SMILES in literal double-quote **characters** — and the transport nested
that inside another array, putting `[["\"CCO\""]]` on the wire. The Python side grew a regex
for `"],["` to decode it. That regex was decoding a bug, not a format.

Both ends are fixed. `normalizeSmiles` splits, trims, strips stray quotes and de-duplicates;
the worker receives a plain array of strings. The quotes never existed in the data.

---

## GPU

`requirements-model.txt` installs **cu128 torch first, `admet-ai` second**, and the
Dockerfile runs those as two separate passes.

⚠ The other order does not fail — it succeeds *wrongly*. `admet-ai` pulls chemprop, whose
pins resolve a plain `torch`, and pip silently replaces the `+cu128` build with the CPU
wheel. The worker then starts, predicts, and returns correct answers, permanently on the
CPU, on a machine with four idle GPUs, with nothing in any log saying so.

Two checks guard it, because neither is sufficient alone:

- **at build time** — assert `"cu128" in torch.__version__` and that `sm_120` is in
  `torch.cuda.get_arch_list()`. `torch.cuda.is_available()` is *not* usable here: there is
  no GPU during a docker build and it would be `False` on a perfect image.
- **at startup** — log the device name, or `WARNING: CUDA NOT available` with the torch
  version. That is the half the build cannot see.

---

## Tests

22 tests. No GPU, no network, no model, no Mongo server.

`tests/fake_mongo.py` is a minimal in-memory stand-in for the one collection the worker
touches. It is not a general Mongo emulator — it implements only the operators actually
issued, and it enforces the property correctness rests on: `find_one_and_update` matches and
updates as one step. A double that did not would let a broken `claim()` pass.

It also refuses to compare a naive datetime against an aware one, because real Mongo stores
UTC and a worker that mixed them would compute the wrong staleness cutoff and silently
requeue healthy jobs.

**Not verified:** the model itself. `admet-ai` has never been installed or run here — that
needs the box.

---

## Files

| | |
|---|---|
| `admet_worker/queue.py` | claim, heartbeat, complete, fail, reap. No model imports |
| `admet_worker/predictor.py` | `stub` and `admet-ai` behind one interface |
| `admet_worker/callback.py` | the PUT back to the platform |
| `admet_worker/worker.py` | the poll loop |
| `admet_worker/__main__.py` | entrypoint; `--once` for a smoke test |

Removed: `amqpadmet.py`, `admet_sender.py`, `admentpred.py`, and the local `admet_ai/`
directory — that last one shadowed the real `admet_ai` package for anything importing from
the service root.
