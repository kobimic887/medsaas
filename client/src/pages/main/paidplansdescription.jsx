import { CheckIcon } from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import { useAuth } from "@/context/auth";
import { TOKEN_PLANS } from "@/utils/tokenPlans";

export function PaidPlansDescription() {
  const { isLoggedIn } = useAuth();
  const signedIn = isLoggedIn();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-12 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mx-auto mb-12 max-w-3xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-brand-600 dark:text-brand-300">
            Simulation credits
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Choose a credit pack</h1>
          <p className="mt-5 text-lg leading-8 text-slate-600 dark:text-slate-300">
            Start with four trial credits, then purchase one-time packs when your research needs more compute. There is no recurring self-serve subscription.
          </p>
        </header>

        <section aria-label="Available token plans" className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {TOKEN_PLANS.map((plan) => (
            <article
              key={plan.name}
              className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900"
            >
              <div>
                <h2 className="text-xl font-semibold">{plan.name}</h2>
                <p className="mt-2 min-h-12 text-sm leading-6 text-slate-600 dark:text-slate-300">{plan.subtitle}</p>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-4xl font-bold">{plan.price ? `$${plan.price}` : 'Free'}</span>
                  {plan.price ? <span className="text-sm text-slate-500 dark:text-slate-400">one-time</span> : null}
                </div>
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">{plan.description}</p>
              </div>

              <ul className="my-7 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <CheckIcon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-brand-600 dark:text-brand-300" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                to={signedIn ? '/dashboard/paid-plans' : '/auth/sign-up'}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white no-underline transition hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:bg-brand-500 dark:hover:bg-brand-400"
              >
                {signedIn
                  ? plan.name === 'Trial' ? 'Open Plans & Credits' : `Buy ${plan.name}`
                  : plan.name === 'Trial' ? 'Create account to try' : 'Create account to purchase'}
              </Link>
            </article>
          ))}
        </section>

        <section className="mt-12 rounded-2xl border border-brand-100 bg-brand-50 px-6 py-8 text-center dark:border-brand-900 dark:bg-brand-950/40">
          <h2 className="text-xl font-semibold">Need a team or custom deployment?</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
            Contact us for multi-user access, custom workflows, infrastructure integration, or higher-volume requirements.
          </p>
          <Link
            to="/main/contact-us"
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg border border-brand-600 px-4 py-2.5 text-sm font-semibold text-brand-700 no-underline transition hover:bg-brand-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:border-brand-400 dark:text-brand-200 dark:hover:bg-brand-900/50"
          >
            Contact the team
          </Link>
        </section>
      </div>
    </main>
  );
}

export default PaidPlansDescription;
