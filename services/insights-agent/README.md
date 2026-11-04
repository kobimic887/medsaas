# Pyxis Insights agent (automated blog)

Writes posts for the **Insights** section of the WordPress site
(`www.pyxis-discovery.com/insights/`, custom post type `pyxis_insights`). Each run:

1. Searches PubMed for papers from the last 21 days matching `queries.json`.
   Every query requires macrocycles, and a second gate requires an explicit
   macrocycle mention in the title or abstract. General biochemistry alone is
   insufficient. If there is no suitable story, the run creates nothing.
2. Asks the model to select one paper whose macrocycle relevance is directly
   evidenced in the source. It can decline the entire shortlist.
3. Drafts **150–250 words** grounded only in that paper's title and abstract.
   The opening sentence explains why it matters for macrocycles. The body covers
   the finding and a practical implication or limitation, without a generic
   biochemical introduction or promotional closing.
4. Runs the publication guard (`lib/post.mjs` → `reviewDraft`). It rejects an
   irrelevant source, an opening without macrocycle relevance, disallowed tags
   or links, malformed/incomplete HTML, wrong length, and numbers absent from
   the source. Invalid replies are retried (3 attempts); failures create no post.
5. Creates an original **1200×630 PNG** with the dependency-free local renderer
   (`lib/illustration.mjs`). The schematic is clearly captioned as a conceptual
   macrocycle illustration, not a molecular structure, binding pose or result.
   It is uploaded to the WordPress Media Library and used both inline and as
   the featured card image. No figure is copied from a paper, no proprietary
   structure is sent to an image service, and no image tokens are purchased.
6. Appends a citation built from PubMed fields and an AI-assistance/editorial
   review note, then saves an **Insights draft** tagged "Insight". It never
   claims a human has already reviewed the draft. `NOTIFY_CMD`, if configured,
   gets its edit link.

The editorial rules are in [EDITORIAL-GUIDELINES.md](EDITORIAL-GUIDELINES.md).
These are prompt and validation changes; no model fine-tuning is needed.

A PMID is posted at most once. The agent checks both its state file and existing
Insights in every status, so a deleted state file cannot cause duplicates.

Unlike the app, this is not an 84 artifact. It runs on an always-on box
(kobivps) and talks to WordPress over HTTPS.

## Model

| `LLM_PROVIDER` | Uses |
|---|---|
| `claude-cli` (explicit opt-in) | `claude -p` with the host's Claude login (subscription). Tools, settings, MCP and session persistence are off, and it runs in an empty directory. `--bare` is avoided because it disables the subscription login. |
| `openai` (default) | Any OpenAI-compatible endpoint: OmniRoute (`http://127.0.0.1:20128/v1` on kobivps, needs an OmniRoute key), OpenRouter, or a paid API. |

The default is a direct API call to loopback OmniRoute, pinned to
`openrouter/openrouter/free`, using a dedicated client key restricted to that
route. It does not invoke Claude Code or fall back to the Claude subscription.
Free upstream availability and quotas still apply; failures leave WordPress
unchanged. To use a company-owned OpenRouter account, set
`LLM_BASE_URL=https://openrouter.ai/api/v1`, its API key, and
`LLM_MODEL=openrouter/free` (or an explicitly selected paid model).

The CLI shares the subscription's usage limits. If a run hits a quota, it fails
without posting; the journal reports the reset message and the next scheduled
run tries again.

One post costs two short model calls (paper selection and writing, plus at most
two retries).

## Review workflow

`WP_STATUS=draft` (default) leaves every post for a person to review, replace
its conceptual image with a more specific approved visual if desired, and
publish. `pending` puts it in WordPress's "Pending review" list. `publish` is
an explicit owner opt-in and posts without review. Generated text never claims
that human review has already happened. Keep `draft` until the team trusts the
output.

An existing `WP_FEATURED_MEDIA` setting can override the featured card image;
the original conceptual PNG is still included inline. A metadata failure cleans
up the exact new unused upload. If a post request fails ambiguously after upload,
the PNG stays in Media because WordPress may already have committed the post.

To rewrite a specific **unpublished** candidate using its same source:

```bash
bun services/insights-agent/agent.mjs --pmid 42643673 --replace-draft 653
```

This checks the draft's current status and exact PubMed citation before model
calls, bypasses the duplicate guard only for that explicit rewrite, and keeps its
current draft/pending status. Published posts and a different source PMID are
refused. A paper with no macrocycle evidence cannot be fixed by inventing an
angle; select another source for a new candidate instead. Use `--dry-run` with
these options to inspect text without changing WordPress or uploading media.
`--pmid <id>` alone creates a candidate for a chosen eligible paper, while keeping
the normal duplicate guard.

## Setup (kobivps)

1. In WordPress, create a user `insights-agent` with the **Editor** role (not
   Administrator), then under its profile add an application password.
2. On the host:
   ```bash
   mkdir -p ~/.config/pyxis-insights-agent
   cp services/insights-agent/deploy/env.example ~/.config/pyxis-insights-agent/env
   chmod 600 ~/.config/pyxis-insights-agent/env   # the agent refuses a group/world-readable file
   # fill in WP_APP_PASSWORD (and NOTIFY_CMD if wanted)
   bun services/insights-agent/agent.mjs --dry-run  # prints the post, posts nothing
   bun services/insights-agent/agent.mjs            # creates one real draft
   ```
3. Schedule it (Tuesday and Friday 07:30 Amsterdam):
   ```bash
   cp services/insights-agent/deploy/pyxis-insights-agent.{service,timer} ~/.config/systemd/user/
   systemctl --user daemon-reload && systemctl --user enable --now pyxis-insights-agent.timer
   journalctl --user -u pyxis-insights-agent -n 50   # logs
   ```
   The user session must linger (`loginctl enable-linger $USER`) for the timer to
   run without a login.

## Verify

```bash
bun run test:insights-agent   # parsing, guard, citation, providers, WP payload (no network)
# End to end without the live site: the Learning Center Docker WordPress also
# registers the Insights post type and an Editor user.
services/learning-center/test/run-wordpress.sh up
services/learning-center/test/run-wordpress.sh app-password   # put into a 0600 env file with WP_URL=http://127.0.0.1:8791
INSIGHTS_AGENT_ENV=/path/to/test.env bun services/insights-agent/agent.mjs
```
