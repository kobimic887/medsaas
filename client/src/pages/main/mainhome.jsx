import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

/* ───────────────────────── tiny intersection-observer hook ─────────────────── */
function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add("cb-visible"); io.unobserve(el); } },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

function Reveal({ children, className = "", delay = 0 }) {
  const ref = useReveal();
  return (
    <div ref={ref} className={`cb-reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/* ───────────────────────────── SVG molecule icon ──────────────────────────── */
const MoleculeIcon = () => (
  <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="19" r="2.5" /><circle cx="19" cy="19" r="2.5" />
    <line x1="12" y1="7.5" x2="5" y2="16.5" /><line x1="12" y1="7.5" x2="19" y2="16.5" />
    <line x1="7.5" y1="19" x2="16.5" y2="19" />
  </svg>
);

/* ───────────────────────────── step card ───────────────────────────────────── */
function StepCard({ number, title, description, icon, delay }) {
  return (
    <Reveal delay={delay} className="flex-1 min-w-[260px]">
      <div className="cb-glass-card group h-full">
        <div className="cb-step-number">{number}</div>
        <div className="text-3xl mb-4">{icon}</div>
        <h3 className="text-xl font-bold text-white mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>{title}</h3>
        <p className="text-sm text-gray-300 leading-relaxed">{description}</p>
      </div>
    </Reveal>
  );
}

/* ───────────────────────────── feature card ────────────────────────────────── */
function FeatureCard({ title, description, icon, delay }) {
  return (
    <Reveal delay={delay}>
      <div className="cb-feature-card group">
        <div className="text-4xl mb-4 cb-feature-icon">{icon}</div>
        <h3 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "'Outfit', sans-serif" }}>{title}</h3>
        <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
      </div>
    </Reveal>
  );
}

/* ═══════════════════════════════ MAIN PAGE ═════════════════════════════════ */
export function MainHome() {
  return (
    <div className="cb-landing">

      {/* ─── HERO ───────────────────────────────────────────────────────────── */}
      <section className="cb-hero">
        {/* animated background orbs */}
        <div className="cb-orb cb-orb-1" />
        <div className="cb-orb cb-orb-2" />
        <div className="cb-orb cb-orb-3" />
        {/* grid overlay */}
        <div className="cb-grid-bg" />

        <div className="cb-hero-content">
          <Reveal>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-brand-500/30 bg-brand-500/10 text-brand-300 text-sm mb-6 backdrop-blur-sm">
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500"></span></span>
              Now in Open Beta
            </div>
          </Reveal>

          <Reveal delay={100}>
            <h1 className="cb-hero-title">
              The Ultimate <span className="cb-gradient-text">Playground</span><br />
              for Chemistry Labs
            </h1>
          </Reveal>

          <Reveal delay={200}>
            <p className="cb-hero-subtitle">
              Pyxis Discovery gives research teams one workspace to search compound
              catalogs, prepare molecular inputs, run configured docking workflows,
              and inspect stored receptors and poses in 3D.
            </p>
          </Reveal>

          <Reveal delay={300}>
            <div className="flex flex-wrap gap-4 justify-center">
              <Link to="/auth/sign-up" className="cb-btn-primary">
                Register Your Lab — Free
              </Link>
              <Link to="/auth/sign-in" className="cb-btn-ghost">
                Sign In →
              </Link>
            </div>
          </Reveal>

          {/* Product capabilities, deliberately qualitative until measured
              customer/usage numbers can be sourced from production data. */}
          <Reveal delay={400}>
            <div className="cb-hero-stats">
              <div><span className="cb-stat-number">Search</span><span className="cb-stat-label">Compound catalogs</span></div>
              <div className="cb-stat-divider" />
              <div><span className="cb-stat-number">Dock</span><span className="cb-stat-label">Tracked simulation results</span></div>
              <div className="cb-stat-divider" />
              <div><span className="cb-stat-number">Inspect</span><span className="cb-stat-label">Receptors and poses in 3D</span></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── HOW IT WORKS ───────────────────────────────────────────────────── */}
      <section className="cb-section">
        <Reveal>
          <h2 className="cb-section-title">How <span className="cb-gradient-text">Pyxis Discovery</span> Works</h2>
          <p className="cb-section-subtitle">From workspace setup to a reviewable docking result</p>
        </Reveal>

        <div className="flex flex-wrap gap-6 justify-center mt-12 max-w-6xl mx-auto">
          <StepCard number="01" icon="🏢" title="Create a Workspace" delay={0}
            description="Register a company workspace, then manage its branding, team roles, and usage policy from the admin area." />
          <StepCard number="02" icon="🔬" title="Choose Molecular Inputs" delay={100}
            description="Search the configured compound catalog, sketch a structure, or provide the supported receptor and ligand inputs directly." />
          <StepCard number="03" icon="🧬" title="Run a Docking Workflow" delay={200}
            description="Submit a configured Vina or DiffDock job and keep its progress and result associated with your account." />
          <StepCard number="04" icon="🔎" title="Review the Result" delay={300}
            description="Open the authenticated receptor and pose files in Molstar, compare poses, and save the SDF when needed." />
        </div>
      </section>

      {/* ─── FEATURES ───────────────────────────────────────────────────────── */}
      <section className="cb-section cb-section-alt">
        <Reveal>
          <h2 className="cb-section-title">Built for <span className="cb-gradient-text">Modern</span> Drug Discovery</h2>
          <p className="cb-section-subtitle">Everything your lab and your customers need, in one place</p>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12 max-w-6xl mx-auto px-4">
          <FeatureCard icon="🧪" title="Compound Libraries" delay={0}
            description="Search and filter the configured catalog, review structures and package pricing, and keep selected compounds in a cart." />
          <FeatureCard icon="🎯" title="Docking Workbench" delay={80}
            description="Prepare Vina and DiffDock requests with validation, progress feedback, and account-scoped stored results." />
          <FeatureCard icon="🔮" title="Molstar 3D Viewer" delay={160}
            description="Interactive 3D molecular visualization powered by Molstar — inspect binding poses, surfaces, and electrostatics in real time." />
          <FeatureCard icon="📊" title="Result History" delay={240}
            description="Return to stored simulation runs, reopen their viewer handoff, and follow queued job state from the dashboard." />
          <FeatureCard icon="📚" title="Research Utilities" delay={320}
            description="Use literature search, molecular similarity, protein-folding, and molecular-editing routes from one dashboard." />
          <FeatureCard icon="🔒" title="Company Controls" delay={400}
            description="Manage workspace branding, member roles, credit policy, and tenant-scoped activity with authenticated controls." />
        </div>
      </section>

      {/* ─── FOR LABS ───────────────────────────────────────────────────────── */}
      <section className="cb-section">
        <div className="max-w-6xl mx-auto px-4 flex flex-col lg:flex-row items-center gap-12">
          <Reveal className="flex-1">
            <div className="cb-showcase-card">
              <div className="cb-showcase-inner">
                <div className="cb-molecule-grid">
                  {[...Array(9)].map((_, i) => (
                    <div key={i} className="cb-molecule-cell" style={{ animationDelay: `${i * 0.2}s` }}>
                      <MoleculeIcon />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={150} className="flex-1">
            <span className="cb-badge">For Laboratories</span>
            <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4" style={{ fontFamily: "'Outfit', sans-serif" }}>
              Your Compounds,<br />Their Discovery
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
              Whether you specialise in macrocyclic research, covalent inhibitors, or
              molecular glues, Pyxis Discovery keeps catalog exploration, molecular
              tools, docking records, and company controls together in one workspace.
            </p>
            <ul className="space-y-3 text-gray-300">
              {["Company branding and role-based member management",
                "Catalog search, package selection, and server-priced checkout",
                "Tenant-scoped activity and simulation history",
                "Configurable usage policy and credit balances"
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-green-400 mt-0.5">✓</span> {t}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ─── FOR CUSTOMERS ──────────────────────────────────────────────────── */}
      <section className="cb-section cb-section-alt">
        <div className="max-w-6xl mx-auto px-4 flex flex-col lg:flex-row-reverse items-center gap-12">
          <Reveal className="flex-1">
            <div className="cb-showcase-card cb-showcase-blue">
              <div className="cb-showcase-inner">
                <div className="flex flex-col items-center justify-center h-full gap-4">
                  <div className="text-6xl animate-pulse">🧬</div>
                  <div className="flex gap-2">
                    <div className="cb-score-pill cb-score-good">Receptor loaded</div>
                    <div className="cb-score-pill cb-score-mid">Pose 1 selected</div>
                  </div>
                  <div className="text-xs text-gray-500 font-mono">Illustrative viewer state • 3 poses available</div>
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={150} className="flex-1">
            <span className="cb-badge cb-badge-blue">For Customers</span>
            <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4" style={{ fontFamily: "'Outfit', sans-serif" }}>
              Explore, Simulate,<br />Then Purchase
            </h2>
            <p className="text-gray-400 leading-relaxed mb-6">
              Sign in to browse the configured compound catalog, sketch or paste a
              molecular structure, submit an available docking workflow, and review
              its stored receptor and poses without losing the run context.
            </p>
            <ul className="space-y-3 text-gray-300">
              {["Catalog search with structure and price details",
                "Ketcher molecular editing and direct SMILES input",
                "Configured Vina and DiffDock submission paths",
                "Authenticated 3D pose review and SDF download"
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-blue-400 mt-0.5">✓</span> {t}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ─── CTA ────────────────────────────────────────────────────────────── */}
      <section className="cb-cta-section">
        <div className="cb-orb cb-orb-4" />
        <Reveal>
          <h2 className="text-3xl lg:text-5xl font-bold text-white mb-4 text-center" style={{ fontFamily: "'Outfit', sans-serif" }}>
            Ready to try the <span className="cb-gradient-text">research workbench</span>?
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p className="text-gray-400 text-center max-w-xl mx-auto mb-8">
            Create a workspace to explore the available tools, or contact the team to
            discuss your catalog and compute-service requirements.
          </p>
        </Reveal>
        <Reveal delay={200}>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link to="/auth/sign-up" className="cb-btn-primary cb-btn-lg">
              Get Started — It's Free
            </Link>
            <Link to="/main/contact-us" className="cb-btn-ghost cb-btn-lg">
              Contact Sales
            </Link>
          </div>
        </Reveal>
      </section>

    </div>
  );
}

export default MainHome;
