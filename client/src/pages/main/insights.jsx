import React from "react";

export default function Insights() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Insights</h1> 
      {/* ChemBench Insights Feed */}
      <div className="mt-8 space-y-6">
        <div className="border rounded-lg p-4 bg-white shadow">
          <a
            href="#"
            className="text-xl font-semibold text-blue-700 hover:underline"
          >
            ChemBench platform goes live
          </a>
          <p className="text-gray-600 mt-2">
            News &mdash; Announcement of the new ChemBench platform launch — a digital playground for chemistry labs.
          </p>
        </div>
        <div className="border rounded-lg p-4 bg-white shadow">
          <a
            href="#"
            className="text-xl font-semibold text-blue-700 hover:underline"
          >
            ChemBench at RICT 2023 — 57th International Conference on Medicinal Chemistry
          </a>
          <p className="text-gray-600 mt-2">
            Event &mdash; Automated liquid handling system for high-throughput
            screening and new product lines announced at the 57th International
            Conference on Medicinal Chemistry in Lille.
          </p>
        </div>
        <div className="border rounded-lg p-4 bg-white shadow">
          <a
            href="https://pubs.acs.org/doi/10.1021/acs.jmedchem.1c02090"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xl font-semibold text-blue-700 hover:underline"
          >
            Conformational Effects on the Passive Membrane Permeability of
            Synthetic Macrocycles
          </a>
          <p className="text-gray-600 mt-2">
            Publication &mdash; Research into macrocyclic membrane permeability
            and breakthroughs in macrocyclic chemistry.
          </p>
        </div>
      </div>
    </div>
  );
}
