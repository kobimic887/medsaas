import React from "react";

export default function Insights() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-4">Insights</h1> 
      {/* Pyxis Discovery Insights Feed */}
      <div className="mt-8 space-y-6">
        <div className="border rounded-lg p-4 bg-white shadow">
          <a
            href="https://www.pyxis-discovery.com/insights/new-pyxis-website-going-live/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xl font-semibold text-blue-700 hover:underline"
          >
            New Pyxis website going live
          </a>
          <p className="text-gray-600 mt-2">
            News &mdash; Announcement of the new Pyxis Discovery website launch.
          </p>
        </div>
        <div className="border rounded-lg p-4 bg-white shadow">
          <a
            href="https://www.pyxis-discovery.com/insights/rict-2023-57th-international-conference-on-medicinal-chemistry-in-lille-8/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xl font-semibold text-blue-700 hover:underline"
          >
            Pyxis Discovery announces new product lines (RICT 2023 Conference)
          </a>
          <p className="text-gray-600 mt-2">
            Event &mdash; Automated liquid handling system for high-throughput
            screening and new product lines announced at the 57th International
            Conference on Medicinal Chemistry in Lille.
          </p>
        </div>
        <div className="border rounded-lg p-4 bg-white shadow">
          <a
            href="https://www.pyxis-discovery.com/insights/conformational-effects-on-the-passive-membrane-permeability-of-synthetic-macrocycles-8/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xl font-semibold text-blue-700 hover:underline"
          >
            Conformational Effects on the Passive Membrane Permeability of
            Synthetic Macrocycles
          </a>
          <p className="text-gray-600 mt-2">
            News &mdash; A close-up of a cylindrical glass vial filled with a blue
            glowing liquid, highlighting scientific discovery and breakthroughs in
            macrocyclic chemistry.
          </p>
        </div>
      </div>
    </div>
  );
}
