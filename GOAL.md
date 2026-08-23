# The goal

Open this only for roadmap / unclear priority / “what should we build.”
Not for a named-file bugfix or a narrow API slice. Start mode and product
invariants live in `AGENTS.md` and `~/.codex/AGENTS.md`.

**De-SaaS is branding only.** This file is not permission to retire signup,
plans, Stripe, roles, companies, or credits.

Stated by the owner, repeatedly, on 2026-07-29 — in their own words, kept verbatim because
paraphrasing it is how the scope drifted in the first place:

> prepare the scripts and stuff for the BOX to be fast to deploy so we can quickly switch
> the url in the frontend, but then when i started digging into the frontend i remembered
> that i have multiple — the one running here and the "improved" one on this computer,
> which was also saasified, so i was like well in that case let's take the new saas one,
> improve it more and make it pyxis only again (desaasified) and prepare it for new box
> url too, and now all of this stuff is happening, i am tired i just want best experience
> for the users

---

## What that means, in four points

1. **Arrival day is a URL switch, not a rearchitecture.** The scripts exist so the box can be
   deployed fast and the frontend just repoints at it. Anything that turns arrival day into a
   multi-step migration is working against the goal.

2. **There are two frontends and the improved one wins.** On live `84`, public
   `app.pyxis-discovery.com` is this repo on **`:5174`** (soft flip 2026-08-23). Legacy
   `:5173` stays installed for **rollback only**.

3. **De-SaaS it back to Pyxis-only,** and point it at the future box URL. One product, one
   company. ✅ Applied — see [`docs/PYXIS-ONLY.md`](docs/PYXIS-ONLY.md).

   ⚠ **"Desaasified" means BRANDING. It does not mean removing sign-up or the ability to
   buy.** Clarified by the owner on 2026-07-30, after the 2026-07-29 pass read it the other
   way and deleted the sign-up page, the paid-plans page and open registration. Both pages
   are **restored**, and public signup is on by default. One company's identity, yes. A
   product nobody can join or pay for, no.

4. **Best experience for the users.** This is the actual objective. The other three serve it.

## How to work on this

**Don't grow the scope.** An audit that lists everything imperfect reads as exploding scope
even when most items are not regressions. Separate "on the critical path" from "could be
better" and say which is which. Fix what is in front of you, state what is left, stop.

**Don't remove things users recognise.** The line, in the owner's words, on a proposal to drop
the "Proceed to Demo" button:

> the demo like that is exactly the sort of thing i dont want you to change, that's the line

Fix *how* a thing works; keep the thing. Additive and invisible changes are fine — a security
fix behind an unchanged button, a performance win, a contrast fix. Moving or deleting a
familiar control is not.

**Don't stop at reasoning — go and check.** ⚠ This rule used to read *"Test rather than
reason."* That was wrong, and the owner called it out on 2026-07-30. Testing does not replace
reasoning; it constrains it. Reasoning is what tells you *what* to test and what the result
means, and a measurement read carelessly is just a confident mistake with evidence attached.

Both halves fail on their own:

- **Reasoning alone missed four real bugs.** Clicking through the dashboard against real data
  found a blank white page from a CORS refusal that 500'd every static asset, another
  company's branding in every footer, unreadable dark-on-dark text, and — hidden behind that
  unreadable text — an endpoint handing every colleague's email address to a publicly
  reachable demo account. A build that succeeds is not a page that works.
- **Testing alone lies too.** Grepping the client for Bootstrap classes returned hits in two
  files, which reads as "Bootstrap is in use". Every hit was a *Tailwind* class —
  `xl:row-start-1`, `sm:flex-row`, `xl:col-start-2` — matched by a sloppy pattern. The command
  ran fine. Only reading the output properly caught it.

So: form the hypothesis, then measure it, then read the measurement like it might be lying.

**Give a recommendation, not a survey.** The owner is tired of decisions. Ask only when the
answer changes what gets built; otherwise choose, say what you chose, and move.

---

**Where things stand:** after DNS → `84`, [`docs/POST-PROMOTION-HANDOFF.md`](docs/POST-PROMOTION-HANDOFF.md)
outranks older “`83` is production” / NEXT-SESSION pickup notes. Do not open runbooks
unless this task is prod, deploy, continuation, or box work.
