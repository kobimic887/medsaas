# Pyxis Insights agent (automated blog)

Writes posts for the **Insights** section of the WordPress site
(`www.pyxis-discovery.com/insights/`, custom post type `pyxis_insights`). Each run:

1. Searches PubMed for papers from the last 21 days that match `queries.json`
   (macrocycles, bRo5/permeability, docking and virtual screening, covalent,
   fragments, structure prediction, scaffold hopping).
2. Asks the model to pick the one paper most useful to Pyxis's audience.
3. Asks the model for a 350–650-word post grounded **only in that paper's
   abstract**, optionally linking up to three Learning Center articles.
4. Runs the publication guard (`lib/post.mjs` → `reviewDraft`). The guard
   rejects disallowed tags or attributes, any link other than the paper and
   Learning Center pages, the wrong length, and **any number not present in the
   abstract**. A rejected draft is retried with the reasons (3 attempts), then
   the run fails without posting.
5. Appends a citation built from PubMed fields (never written by the model) and
   an AI-assistance note, then creates the post through the WordPress REST API
   as a **draft** tagged "Insight". `NOTIFY_CMD` gets the edit link.

A PMID is posted at most once. The agent checks both its state file and existing
Insights in every status, so a deleted state file cannot cause duplicates.

Unlike the app, this is not an 84 artifact. It runs on an always-on box
(kobivps) and talks to WordPress over HTTPS.

## Model

| `LLM_PROVIDER` | Uses |
|---|---|
| `claude-cli` (default) | `claude -p` with the host's Claude login (subscription). Tools, settings, MCP and session persistence are off, and it runs in an empty directory. `--bare` is avoided because it disables the subscription login. |
| `openai` | Any OpenAI-compatible endpoint: OmniRoute (`http://127.0.0.1:20128/v1` on kobivps, needs an OmniRoute key), OpenRouter, or a paid API. |

One post costs two short model calls (paper selection and writing, plus at most
two retries).

## Review workflow

`WP_STATUS=draft` (default) leaves every post for a person to read, add a card
image to (Insights cards show the featured image), and publish. `pending` puts
it in WordPress's "Pending review" list. `publish` posts without review; the
footer then drops the "reviewed by the Pyxis Discovery team" claim. Keep `draft`
until the team trusts the output.

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
