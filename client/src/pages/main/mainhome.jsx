import React, { useEffect, useRef } from "react";
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
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
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
        <p className="text-sm text-slate-300 leading-relaxed">{description}</p>
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
        <p className="text-sm text-slate-400 leading-relaxed">{description}</p>
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
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-300 text-sm mb-6 backdrop-blur-sm">
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span></span>
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
              ChemBench gives organic-research laboratories a branded digital space
              where their customers can explore compounds, run Molstar simulations,
              dock to protein targets, get binding scores — and purchase ligands —
              all in one platform.
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

          {/* hero stats */}
          <Reveal delay={400}>
            <div className="cb-hero-stats">
              <div><span className="cb-stat-number">10K+</span><span className="cb-stat-label">Compounds</span></div>
              <div className="cb-stat-divider" />
              <div><span className="cb-stat-number">50+</span><span className="cb-stat-label">Labs Onboarded</span></div>
              <div className="cb-stat-divider" />
              <div><span className="cb-stat-number">1M+</span><span className="cb-stat-label">Simulations Run</span></div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── HOW IT WORKS ───────────────────────────────────────────────────── */}
      <section className="cb-section">
        <Reveal>
          <h2 className="cb-section-title">How <span className="cb-gradient-text">ChemBench</span> Works</h2>
          <p className="cb-section-subtitle">Four simple steps from lab registration to ligand purchase</p>
        </Reveal>

        <div className="flex flex-wrap gap-6 justify-center mt-12 max-w-6xl mx-auto">
          <StepCard number="01" icon="🏢" title="Lab Registration" delay={0}
            description="Your laboratory creates a branded space on ChemBench. Upload your compound libraries and define the targets you specialise in." />
          <StepCard number="02" icon="🔬" title="Customer Exploration" delay={100}
            description="Potential customers sign in to your lab space, browse your macrocycles, ligands, and molecular scaffolds interactively." />
          <StepCard number="03" icon="🧬" title="Simulate & Score" delay={200}
            description="Customers use built-in tools like Molstar to dock compounds to predefined protein chains and get real-time binding scores." />
          <StepCard number="04" icon="🛒" title="Purchase or Quote" delay={300}
            description="Once satisfied, customers can purchase ligands directly or request a custom quote — closing the loop from discovery to order." />
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
            description="Host and manage off-the-shelf and synthesis-on-demand compound libraries — from 10K macrocycles to 1B enumerated molecules." />
          <FeatureCard icon="🎯" title="Protein Docking" delay={80}
            description="Let customers dock compounds against your predefined target proteins with automated scoring and visualization." />
          <FeatureCard icon="🔮" title="Molstar 3D Viewer" delay={160}
            description="Interactive 3D molecular visualization powered by Molstar — inspect binding poses, surfaces, and electrostatics in real time." />
          <FeatureCard icon="📊" title="Binding Scores & Analytics" delay={240}
            description="Automated binding affinity scoring with detailed analytics dashboards for each simulation run." />
          <FeatureCard icon="💳" title="Integrated Purchasing" delay={320}
            description="Stripe-powered checkout and quote request system built right into the platform — no external tools needed." />
          <FeatureCard icon="🔒" title="Lab-Branded Spaces" delay={400}
            description="Each lab gets its own branded portal with custom branding, compound catalogs, and customer management." />
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
            <p className="text-slate-400 leading-relaxed mb-6">
              Whether you specialise in macrocyclic research, covalent inhibitors, or
              molecular glues — ChemBench lets you showcase your entire chemical
              space to potential customers. They interact with your molecules using
              professional-grade tools, and when they find what they need, the
              purchase happens right here.
            </p>
            <ul className="space-y-3 text-slate-300">
              {["Drag-and-drop compound upload (SDF, SMILES, PDB)",
                "Customisable target protein library",
                "Real-time customer activity dashboard",
                "Revenue analytics & order management"
              ].map((t, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-emerald-400 mt-0.5">✓</span> {t}
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
                    <div className="cb-score-pill cb-score-good">Score: 9.2</div>
                    <div className="cb-score-pill cb-score-mid">ΔG: −8.4</div>
                  </div>
                  <div className="text-xs text-slate-500 font-mono">Docking complete • 3 conformers</div>
                </div>
              </div>
            </div>
          </Reveal>
          <Reveal delay={150} className="flex-1">
            <span className="cb-badge cb-badge-blue">For Customers</span>
            <h2 className="text-3xl lg:text-4xl font-bold text-white mb-4" style={{ fontFamily: "'Outfit', sans-serif" }}>
              Explore, Simulate,<br />Then Purchase
            </h2>
            <p className="text-slate-400 leading-relaxed mb-6">
              Sign in to your partner lab's ChemBench space. Browse their compound
              catalogue, tweak molecules with built-in editors, run docking
              simulations against real protein targets, and — when you've found the
              perfect ligand — buy it or request a custom quote, all without leaving
              the platform.
            </p>
            <ul className="space-y-3 text-slate-300">
              {["Browse & filter thousands of compounds interactively",
                "3D visualization and binding-pose inspection",
                "Automated affinity scoring against lab-defined targets",
                "One-click purchase or custom quote request"
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
            Ready to open your <span className="cb-gradient-text">lab's playground</span>?
          </h2>
        </Reveal>
        <Reveal delay={100}>
          <p className="text-slate-400 text-center max-w-xl mx-auto mb-8">
            Join the growing network of organic-chemistry labs that use ChemBench to
            showcase compounds, run simulations, and convert researchers into paying
            customers.
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
