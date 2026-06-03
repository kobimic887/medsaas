import React, { useEffect } from "react";
import { Typography, Card, CardHeader, CardBody, Button } from "@material-tailwind/react";
import { pyxisImages } from "@/data/pyxisImages";

export function MainHome() {
  // Redirect this route to the public website
  useEffect(() => {
    // Use replace to avoid adding an extra history entry
    window.location.replace("https://www.pyxis-discovery.com/");
  }, []);

  return (
    <div className="about-us-page">
      {/* Fallback content shown briefly while redirecting */}
      <section className="py-16 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold mb-2">Redirecting…</h1>
          <p className="text-blue-gray-600">Taking you to pyxis-discovery.com</p>
        </div>
      </section>
      {/* The content below will usually not render because of the immediate redirect,
          but is preserved for reference and potential future reinstatement. */}
      {/* Hero Section */}
      <section
        className="py-5 text-white d-flex align-items-center justify-content-center"
        style={{
          background:
            `linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.5)), url('${pyxisImages.hero}') center/cover no-repeat`,
          minHeight: 340,
        }}
      >
        <div className="container text-center">
          <h1 className="display-3 fw-bold mb-3">Accelerate and advance your medicine R&D process with our Compound Libraries</h1>
          <p className="lead mx-auto mb-6" style={{ maxWidth: 700 }}>
            Create future medicines by unlocking the potential of macrocyclic chemistry
          </p>
        </div>
      </section>

      {/* Scaffold-based Chemical Space Section */}
      <section className="container py-5">
        <h2 className="fw-bold mb-4" style={{ fontSize: '3rem' }}>Pyxis embraces the concept of scaffold-based chemical space exploration</h2>
        <p className="lead text-blue-gray-700 mb-2">
          This library design approach offers several advantages over alternative methods of chemical space enrichment as it is easy to combine with existing machine learning and statistical modelling algorithms and chemistry process automation. All Pyxis scaffolds are drug-like and synthetically tractable, featuring Fsp3-rich linkers and ring-systems found in known drugs or natural products. The peripheral building blocks can be attached to the core scaffold in a step-by-step fashion using well-validated protocols of parallel chemistry.
        </p>
      </section>

      {/* Macrocyclic ChemSpace Section */}
      <section className="bg-blue-gray-50 py-5">
        <div className="container row align-items-center mb-5 mx-auto">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img src={pyxisImages.macrocyclicChemspace} alt="Macrocyclic ChemSpace" className="img-fluid rounded shadow" style={{ maxHeight: 400, objectFit: "cover", width: "100%" }} />
          </div>
          <div className="col-lg-6">
            <ul className="list-unstyled text-blue-gray-700 text-base mb-2">
              <li>10,000 Off-the-shelf molecules (1mg, ready-to-ship, 10μmol format)</li>
              <li>1,000,000 Synthesis-on-demand molecules (3-day turnaround)</li>
              <li>1,000,000,000 Fully enumerated, synthetically feasible macrocycles</li>
            </ul>
            <p className="text-blue-gray-600 mb-2">
              All scaffolds are drug-like, synthetically tractable, and compatible with machine learning and automation.
            </p>
            <a href="/pdbs/Macrocycles-Final-10k-Compounds.zip" download className="mt-2 btn btn-outline-primary">
              Download 10,000 Macrocyclic ChemSpace (SDF)
            </a>
          </div>
        </div>
      </section>

      {/* Macrocycles for CNS Section */}
      <section className="py-5">
        <div className="container row align-items-center mb-5 flex-row-reverse mx-auto">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img src={pyxisImages.cnsMacrocycles} alt="CNS Macrocycles" className="img-fluid rounded shadow" style={{ maxHeight: 400, objectFit: "cover", width: "100%" }} />
          </div>
          <div className="col-lg-6">
            <p className="lead text-blue-gray-700 mb-2">
              Uniquely designed macrocycles for CNS drug discovery, offering excellent solubility, cellular permeability, and diverse shapes for modulating CNS targets.
            </p>
            <ul className="list-unstyled text-blue-gray-700 text-base mb-2">
              <li>2,870 in-stock macrocycles (0.5μmol in DMSO, 90% purity)</li>
              <li>Pre-plated, ready for screening</li>
            </ul>
            <a href="/pdbs/Macrocycles-Final-Compounds-0.5umol.zip" download className="mt-2 btn btn-outline-primary">
              Download CNS Macrocycles (SDF)
            </a>
          </div>
        </div>
      </section>

      {/* Macrocycles as Molecular Glues Section */}
      <section className="bg-blue-gray-50 py-5">
        <div className="container row align-items-center mb-5 mx-auto">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img src={pyxisImages.molecularGlues} alt="Molecular Glues" className="img-fluid rounded shadow" style={{ maxHeight: 400, objectFit: "cover", width: "100%" }} />
          </div>
          <div className="col-lg-6">
            <p className="lead text-blue-gray-700 mb-2">
              Diversity-oriented macrocyclic library for unbiased molecular glue screening, targeting protein-protein interactions and non-traditional binding sites.
            </p>
            <ul className="list-unstyled text-blue-gray-700 text-base mb-2">
              <li>1,277 in-stock macrocycles (0.5μmol in DMSO, 90% purity)</li>
              <li>Pre-plated, ready for screening</li>
            </ul>
            <a href="/pdbs/protac-in-vitro-1277.zip" download className="mt-2 btn btn-outline-primary">
              Download Molecular Glues Library (SDF)
            </a>
          </div>
        </div>
      </section>

      {/* Macrocycles for Covalent Drug Discovery Section */}
      <section className="py-5">
        <div className="container row align-items-center mb-5 flex-row-reverse mx-auto">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img src={pyxisImages.covalentMacrocycles} alt="Covalent Macrocycles" className="img-fluid rounded shadow" style={{ maxHeight: 400, objectFit: "cover", width: "100%" }} />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Macrocycles for Covalent Drug Discovery</h2>
            <p className="lead text-blue-gray-700 mb-2">
              Cysteine-oriented electrophilic macrocycles for covalent drug discovery, enabling SAR exploration and targeting challenging proteins.
            </p>
            <ul className="list-unstyled text-blue-gray-700 text-base mb-2">
              <li>13,948 on-demand macrocycles (2μmol dry, 90% purity, 4-week turnaround)</li>
            </ul>
            <a href="/pdbs/macrocyclic-covalent-library-13948.zip" download className="mt-2 btn btn-outline-primary">
              Download Covalent Macrocycles Library (SDF)
            </a>
          </div>
        </div>
      </section>

      {/* Contact/CTA Section */}
      <section className="bg-blue-gray-50 py-5">
        <div className="container text-center">
          <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Looking for advice or a screening partner?</h2>
          <a href="https://www.pyxis-discovery.com/contact/" target="_blank" rel="noreferrer" className="btn btn-success ms-2" role="button">
            Contact Pyxis Discovery
          </a>
        </div>
      </section>
    </div>
  );
}

export default MainHome;
