import React from "react";

export default function AboutUs() {
  return (
    <div className="about-us-page">
      {/* Hero Section with background */}
      <section
        className="py-5 text-white d-flex align-items-center justify-content-center"
        style={{
          background:
            "linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.5)), url('/img/pyxis-hero.jpg') center/cover no-repeat",
          minHeight: 350,
        }}
      >
        <div className="container text-center">
          <h1 className="display-3 fw-bold mb-3">About Pyxis Discovery</h1>
          <p className="lead mx-auto" style={{ maxWidth: 700 }}>
            Chemistry-driven innovation for macrocyclic drug discovery
          </p>
        </div>
      </section>

      {/* Company Overview */}
      <section className="container py-5">
        <div className="row align-items-center mb-5">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img
              src="/img/pyxis-team.jpeg"
              alt="Pyxis Discovery Team"
              className="img-fluid rounded shadow"
              style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
            />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: "3rem" }}>
              Who We Are
            </h2>
            <p className="lead">
              Pyxis Discovery is a chemistry-driven company specializing in the
              design and synthesis of macrocyclic compound libraries for drug
              discovery. Our mission is to accelerate the development of new
              medicines by providing unique, high-quality chemical space and
              innovative solutions for pharmaceutical research.
            </p>
            <ul className="list-unstyled">
              <li>• Scaffold-based macrocycle libraries</li>
              <li>• AI-ready, drug-like chemical space</li>
              <li>• Solutions for pharma and biotech</li>
            </ul>
          </div>
        </div>

        {/* Our Mission & Values */}
        <div className="row mb-5">
          <div className="col-md-6 mb-4 mb-md-0">
            <div className="bg-light rounded p-4 h-100 shadow-sm">
              <h3 className="fw-bold mb-3">Our Mission</h3>
              <p>
                To enable the discovery of future medicines by unlocking the
                potential of macrocyclic chemistry. We empower our partners with
                innovative libraries and expertise to accelerate drug discovery.
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
            <img
              src="/img/pyxis-lab.jpeg"
              alt="Pyxis Discovery Lab"
              className="img-fluid rounded shadow"
              style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
            />
          </div>
          <div className="col-lg-6 order-lg-1">
            <h2 className="fw-bold mb-3" style={{ fontSize: "3rem" }}>
              Our Team
            </h2>
            <p>
              Pyxis Discovery was founded by a group of experienced scientists
              with backgrounds in medicinal chemistry, computational chemistry,
              and chemical biology. Our team combines deep scientific expertise
              with a passion for innovation and collaboration.
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
              We embrace scaffold-based chemical space exploration, focusing on
              drug-like, synthetically tractable macrocycles. Our libraries are
              designed to be compatible with modern drug discovery workflows,
              including AI-driven design, high-throughput screening, and
              structure-based drug design.
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
              Interested in learning more about Pyxis Discovery or collaborating
              with us?
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