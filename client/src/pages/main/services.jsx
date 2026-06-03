import React from "react";
import { Typography, Button } from "@material-tailwind/react";
import { servicesImages } from "@/data/servicesImages";

export default function Services() {
  return (
    <div className="about-us-page">
      {/* Hero Section with background */}
      <section
        className="py-5 text-white d-flex align-items-center justify-content-center"
        style={{
          background:
            "linear-gradient(135deg, #0d1b2a 0%, #1b4965 50%, #62b6cb 100%)",
          minHeight: 260,
        }}
      >
        <div className="container text-center">
          <h1 className="display-3 fw-bold mb-3">Virtual Screening & Synthesis on Demand</h1>
          <p className="lead mx-auto" style={{ maxWidth: 700 }}>
            ChemBench supports computational modeling, virtual docking and bioavailability optimization using an array of commercial and proprietary computational tools.
          </p>
        </div>
      </section>

      {/* Structure Based Selections */}
      <section className="container py-5">
        <div className="row align-items-center mb-5">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img
              src={servicesImages.structureBased}
              alt="Structure Based Selections"
              className="img-fluid rounded shadow"
              style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
            />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Structure Based Selections</h2>
            <p className="lead">
              With the development and free availability of AlphaFold, an interest in ultra large chemical libraries has spiked. We created a unique database of
              cell-permeable macrocycles. Our library consists of only drug-like macrocyclic compounds, validated for high synthesis success rate. We also offer structure-based virtual screening services.
            </p>
            <a href="/main/contact-us" className="btn btn-outline-primary mt-2">
              Request Structure-Based Screening
            </a>
          </div>
        </div>

        {/* Query Based Selections */}
        <div className="row align-items-center mb-5 flex-row-reverse">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img
              src={servicesImages.queryBased}
              alt="Query Based Selections"
              className="img-fluid rounded shadow"
              style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
            />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Query Based Selections</h2>
            <p className="lead">
              The rapidly growing size of tangible chemical space can create technical challenges in handling and navigating structurally-rich datasets. To facilitate this, we offer ready-to-go products and services for analog and molecule selection, including scaffold-based, substructure, or pharmacophore-based queries within a larger chemical space.
            </p>
            <a href="/main/contact-us" className="btn btn-outline-primary mt-2">
              Request Query-Based Selection
            </a>
          </div>
        </div>

        {/* Property Based Filtering */}
        <div className="row align-items-center mb-5">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img
              src={servicesImages.propertyBased}
              alt="Property Based Filtering"
              className="img-fluid rounded shadow"
              style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
            />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Property Based Filtering</h2>
            <p className="lead">
              ChemBench has years of experience in designing cell-permeable and CNS-like compounds. Our cell-permeable macrocycles are based on proprietary PAMPA data and all products are designed with cell-permeability in mind.
            </p>
            <a href="/main/contact-us" className="btn btn-outline-primary mt-2">
              Request Property-Based Filtering
            </a>
          </div>
        </div>

        {/* Synthesis on Demand */}
        <div className="row align-items-center mb-5 flex-row-reverse">
          <div className="col-lg-6 mb-4 mb-lg-0">
            <img
              src={servicesImages.synthesisOnDemand}
              alt="Synthesis on Demand"
              className="img-fluid rounded shadow"
              style={{ maxHeight: 400, objectFit: "cover", width: "100%" }}
            />
          </div>
          <div className="col-lg-6">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Synthesis on Demand</h2>
            <p className="lead">
              Our unique platform of high throughput experimentation allows us to instantly and cost-efficiently produce molecules for your research.
            </p>
            <a href="/main/contact-us" className="btn btn-outline-primary mt-2">
              Request Synthesis on Demand
            </a>
          </div>
        </div>

        {/* Contact/CTA Section */}
        <div className="row">
          <div className="col text-center">
            <h2 className="fw-bold mb-3" style={{ fontSize: '3rem' }}>Looking for advice or a screening partner?</h2>
            <a href="/main/contact-us" className="btn btn-success ms-2" role="button">
              Contact ChemBench
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
