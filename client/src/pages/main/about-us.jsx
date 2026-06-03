import React from "react";

export default function AboutUs() {
  return (
    <div className="about-us-page">
      {/* Hero Section with background */}
      <section
        className="py-5 text-white d-flex align-items-center justify-content-center"
        style={{
          background:
            "linear-gradient(135deg, #0d1b2a 0%, #1b4965 50%, #62b6cb 100%)",
          minHeight: 350,
        }}
      >
        <div className="container text-center">
          <h1 className="display-3 fw-bold mb-3">About ChemBench</h1>
          <p className="lead mx-auto" style={{ maxWidth: 700 }}>
            A platform for chemistry laboratories to showcase compounds and connect with customers
          </p>
        </div>
      </section>

      {/* Company Overview */}
      <section className="container py-5">
        <div className="row align-items-center mb-5">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <div
              role="img"
              aria-label="ChemBench Team"
              className="img-fluid rounded shadow"
              style={{
                height: 400,
                width: "100%",
                background:
                  "linear-gradient(135deg, #0d1b2a 0%, #1b4965 50%, #62b6cb 100%)",
              }}
            />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: "3rem" }}>
              Who We Are
            </h2>
            <p className="lead">
              ChemBench is a platform that empowers chemistry laboratories to
              create branded digital spaces where their customers can explore
              compound libraries, run molecular simulations, and purchase
              ligands — all in one place.
            </p>
            <ul className="list-unstyled">
              <li>• Branded lab portals for compound showcasing</li>
              <li>• Integrated Molstar 3D viewer and docking tools</li>
              <li>• Streamlined purchasing and quote workflows</li>
            </ul>
          </div>
        </div>

        {/* Our Mission & Values */}
        <div className="row mb-5">
          <div className="col-md-6 mb-4 mb-md-0">
            <div className="bg-light rounded p-4 h-100 shadow-sm">
              <h3 className="fw-bold mb-3">Our Mission</h3>
              <p>
                To accelerate drug discovery by connecting chemistry labs with
                their customers through an interactive, digital-first platform.
                We empower labs with professional tools and help researchers find
                the compounds they need faster.
              </p>
            </div>
          </div>
          <div className="col-md-6">
            <div className="bg-light rounded p-4 h-100 shadow-sm">
              <h3 className="fw-bold mb-3">Our Values</h3>
              <ul className="mb-0">
                <li>Innovation in chemistry and technology</li>
                <li>Collaboration and partnership</li>
                <li>Scientific excellence</li>
                <li>Integrity and transparency</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Our Team */}
        <div className="row align-items-center mb-5">
          <div className="col-lg-6 order-lg-2 mb-4 mb-lg-0">
            <div
              role="img"
              aria-label="ChemBench Lab"
              className="img-fluid rounded shadow"
              style={{
                height: 400,
                width: "100%",
                background:
                  "linear-gradient(135deg, #0d1b2a 0%, #1b4965 50%, #62b6cb 100%)",
              }}
            />
          </div>
          <div className="col-lg-6 order-lg-1">
            <h2 className="fw-bold mb-3" style={{ fontSize: "3rem" }}>
              Our Team
            </h2>
            <p>
              ChemBench was founded by a team of experienced scientists and
              engineers with backgrounds in medicinal chemistry, computational
              chemistry, and software development. We combine deep scientific
              expertise with a passion for building great digital products.
            </p>
          </div>
        </div>

        {/* Our Approach */}
        <div className="row mb-5">
          <div className="col">
            <h2 className="fw-bold mb-3" style={{ fontSize: "3rem" }}>
              Our Approach
            </h2>
            <p>
              We provide chemistry labs with a turnkey platform to showcase their
              compound libraries — from macrocycles to covalent inhibitors —
              complete with interactive simulation tools, protein docking, and
              integrated purchasing, so labs can focus on chemistry while we
              handle the digital experience.
            </p>
          </div>
        </div>

        {/* Contact Section */}
        <div className="row">
          <div className="col text-center">
            <h2 className="fw-bold mb-3" style={{ fontSize: "3rem" }}>
              Contact Us
            </h2>
            <p>
              Interested in learning more about ChemBench or listing your lab?
              <a
                href="/main/contact-us"
                className="btn btn-success ms-2"
                role="button"
              >
                Contact Us
              </a>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}