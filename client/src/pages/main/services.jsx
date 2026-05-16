import React from "react";
import { Typography, Button } from "@material-tailwind/react";
import { pyxisServicesImages } from "@/data/pyxisServicesImages";

export default function Services() {
  return (
    <div className="about-us-page">
      {/* Hero Section with background */}
      <section
        className="py-5 text-white d-flex align-items-center justify-content-center"
        style={{
          background:
            "linear-gradient(rgba(0,0,0,0.5),rgba(0,0,0,0.5)), url('/img/pyx_header_small@3x-scaled.jpg') center/cover no-repeat",
          minHeight: 260,
        }}
      >
        <div className="container text-center">
          <h1 className="display-3 fw-bold mb-3">Virtual Screening & Synthesis on Demand</h1>
          <p className="lead mx-auto" style={{ maxWidth: 700 }}>
            Pyxis has a proven track record of supporting computational modeling, virtual docking and bioavailability optimization projects using an array of commercial and proprietary computational tools.
          </p>
        </div>
      </section>

      {/* Structure Based Selections */}
      <section className="container py-5">
        <div className="row align-items-center mb-5">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img
              src={pyxisServicesImages.structureBased}
              alt="Structure Based Selections"
              className="img-fluid rounded shadow"
              style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
            />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Structure Based Selections</h2>
            <p className="lead">
              With the development and free availability of AlphaFold, an interest in ultra large chemical libraries has spiked. Responding to demand, we created a unique database of{" "}
              <a href="https://www.pyxis-discovery.com/wp-content/uploads/2025/02/Macrocycles-Final-1M-Compounds.zip" className="text-blue-600 underline">
                1 million
              </a>{" "}
              and 1 billion (
              <a href="https://www.pyxis-discovery.com/contact/" className="text-blue-600 underline">
                available on request
              </a>
              ) cell-permeable macrocycles. Our library consists of only drug-like macrocyclic compounds, validated for high synthesis success rate using our proprietary platform. We also offer structure-based virtual screening services using the MOE software package.
            </p>
            <a href="https://www.pyxis-discovery.com/contact/" target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary mt-2">
              Request Structure-Based Screening
            </a>
          </div>
        </div>

        {/* Query Based Selections */}
        <div className="row align-items-center mb-5 flex-row-reverse">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img
              src={pyxisServicesImages.queryBased}
              alt="Query Based Selections"
              className="img-fluid rounded shadow"
              style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
            />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Query Based Selections</h2>
            <p className="lead">
              The rapidly growing size of tangible chemical space can create technical challenges in handling and navigating structurally-rich datasets. To facilitate this, we offer ready-to-go products and services for analog and molecule selection.{" "}
              <a href="https://www.pyxis-discovery.com/wp-content/uploads/2025/01/Macrocycles-Final-10k-Compounds.zip" className="text-blue-600 underline">
                Browse 10,000 chemotypes
              </a>
              , explore{" "}
              <a href="https://www.pyxis-discovery.com/wp-content/uploads/2025/02/Macrocycles-Final-1M-Compounds.zip" className="text-blue-600 underline">
                1 million macrocycles
              </a>
              , or{" "}
              <a href="https://www.pyxis-discovery.com/contact/" className="text-blue-600 underline">
                contact us
              </a>{" "}
              for scaffold-based, substructure, or pharmacophore-based queries within a larger (up to 1 billion) chemical space.
            </p>
            <a href="https://www.pyxis-discovery.com/contact/" target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary mt-2">
              Request Query-Based Selection
            </a>
          </div>
        </div>

        {/* Property Based Filtering */}
        <div className="row align-items-center mb-5">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img
              src={pyxisServicesImages.propertyBased}
              alt="Property Based Filtering"
              className="img-fluid rounded shadow"
              style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
            />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Property Based Filtering</h2>
            <p className="lead">
              Pyxis has years of experience in designing cell-permeable and CNS-like compounds, as demonstrated in our{" "}
              <a href="https://pubs.acs.org/doi/10.1021/acs.jmedchem.1c02090" className="text-blue-600 underline">
                publication
              </a>
              . Our cell-permeable macrocycles are based on proprietary PAMPA data and all products are designed with cell-permeability in mind. Explore our databases of{" "}
              <a href="https://www.pyxis-discovery.com/wp-content/uploads/2025/01/Macrocycles-Final-10k-Compounds.zip" className="text-blue-600 underline">
                10,000
              </a>
              ,{" "}
              <a href="https://www.pyxis-discovery.com/wp-content/uploads/2025/02/Macrocycles-Final-1M-Compounds.zip" className="text-blue-600 underline">
                1 million
              </a>
              , and 1 billion (
              <a href="https://www.pyxis-discovery.com/contact/" className="text-blue-600 underline">
                available on request
              </a>
              ) compounds.
            </p>
            <a href="https://www.pyxis-discovery.com/contact/" target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary mt-2">
              Request Property-Based Filtering
            </a>
          </div>
        </div>

        {/* Synthesis on Demand */}
        <div className="row align-items-center mb-5 flex-row-reverse">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img
              src={pyxisServicesImages.synthesisOnDemand}
              alt="Synthesis on Demand"
              className="img-fluid rounded shadow"
              style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
            />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Synthesis on Demand</h2>
            <p className="lead">
              Our unique platform of high throughput experimentation allows us to instantly and cost-efficiently produce molecules for your research. Consult our databases of{" "}
              <a href="https://www.pyxis-discovery.com/wp-content/uploads/2025/02/Macrocycles-Final-1M-Compounds.zip" className="text-blue-600 underline">
                1 million
              </a>
              , and 1 billion (
              <a href="https://www.pyxis-discovery.com/contact/" className="text-blue-600 underline">
                available on request
              </a>
              ) molecules.
            </p>
            <a href="https://www.pyxis-discovery.com/contact/" target="_blank" rel="noopener noreferrer" className="btn btn-outline-primary mt-2">
              Request Synthesis on Demand
            </a>
          </div>
        </div>

        {/* Contact/CTA Section */}
        <div className="row">
          <div className="col text-center">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Looking for advice or a screening partner?</h2>
            <a href="https://www.pyxis-discovery.com/contact/" target="_blank" rel="noopener noreferrer" className="btn btn-success ms-2" role="button">
              Contact Pyxis Discovery
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
