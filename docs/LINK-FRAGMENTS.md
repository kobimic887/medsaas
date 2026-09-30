# Link Fragments

Link Fragments searches the owned 3D macrocyclic linker library supplied for the
website. Linkers are molecular skeletons, not catalog products. A result does not
create a stock offer, enter a cart or establish synthesis availability.

## Input and use

1. Open **Link Fragments** in the dashboard.
2. Upload a V2000 SDF containing exactly two connected molecular records, both
   marked `3D`, in the same coordinate frame. Maximum 800,000 bytes and 200 atoms
   per fragment. Preserve explicit atoms when numbering attachment sites.
3. Select one heavy attachment atom per fragment using the dropdowns or 3D view.
   The SDF examples do not encode the spheres from the email: selection must be
   explicit. The supplied `R-groups_from7WH5lig.sdf` uses **atom 1 in each record**.
4. Choose maximum attachment RMSD (0.1–1 Å; default 0.75) and search.
5. Inspect the product/query overlay and download the assembled product SDF.
   Changing the file, atoms or fit limit clears previous results.

Attachment atoms must be carbon or nitrogen with an **implicit hydrogen** available
for replacement. This first implementation also requires carbon/nitrogen connection
centers on the linker. Other elements are refused rather than given unvalidated geometry.
Removing an explicit hydrogen is not supported. Unsupported SDF versions, query
bonds, atom aliases and radicals are refused. A selectable atom is not necessarily
a chemically valid attachment site; validation can reject it after selection.

## Method and limits

The method is **Pyxis rigid two-fragment matching**. It preserves uploaded fragment
coordinates. Each neutral, singly bonded He label identifies a linker exit vector;
the new fragment atom replaces that label using an element-specific bond length.
Eligible pairs of labels on different neighboring atoms are tested in both fragment
assignments. Proper rotations and a 10-degree torsion scan align the linker without
reflection. Selected labels are removed; unused labels become hydrogen caps. Charges
and stereochemistry are preserved, and RDKit validates the joined chemical graph.

Reported RMSD describes the fit between the two attachment anchors, in angstroms.
It is not a binding, similarity, energy or synthesis score. Products undergo approximate
bond geometry and severe clash screening. There is no force-field minimization,
receptor/excluded-volume model, activity prediction or MOE score equivalence. The
broader scaffold replacement and multi-fragment workflows in the supplied PDF are
outside this two-fragment implementation.

The index contains source conformations and compressed original SDF records. Distance
prefiltering selects at most **250 candidate attachment pairs** nearest the query
spacing. All library conformations are indexed, but each request is a bounded,
partial search. The response and UI expose available/scanned counts and truncation;
zero matches is not proof that no linker exists. Equivalent product graphs are
shown once using the best fit found among scanned candidates.

## Runtime boundary

The source archive and derived index stay on the scientific data host. The service
binds loopback and is reached through private transport. The application uses
`LINK_FRAGMENTS_BASE`; absent or failed configuration reports unavailable, with no
supplier fallback. API routes `/api/link-fragments/{status,inspect,search}` require
an active authenticated user. This initial bounded workflow does not charge credits.

Staging shares application accounts and records with production. Link Fragments
does not persist searches or purchase anything; uploads go to owned compute.
See [service instructions](../services/link-fragments/README.md) and
[staging deployment](../deploy/staging/README.md).

## Verification

`bun run test:link-fragments` exercises the supplied-example chemical graph and
stereochemistry, unchanged query coordinates, multi-label capping, invalid chemistry,
compressed-index import, real HTTP search, API validation and authenticated UI requests.
For release, also exercise upload, atom selection, rendered query/product overlay and
SDF download in the browser. A fixture match alone does not qualify a full scientific
search or MOE replacement.
