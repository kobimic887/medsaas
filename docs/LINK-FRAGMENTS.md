# Link Fragments

Link Fragments searches the owned 3D macrocyclic linker library supplied for the
website. Linkers are molecular skeletons, not catalog products. A result does not
create a stock offer, enter a cart or establish synthesis availability.

## Input and use

1. Open **Link Fragments** in the dashboard.
2. Upload a V2000 SDF containing exactly two connected molecular records, both
   marked `3D`, in the same coordinate frame. Maximum 800,000 bytes and 200 atoms
   per fragment. Atom numbers are the one-based positions in each uploaded record,
   explicit hydrogens included, and the UI always shows these original numbers.
3. The page inspects every atom before search. Eligible attachment atoms are marked
   in the 3D view; ineligible atoms stay listed but disabled, with the reason
   (hydrogen, unsupported element, no replaceable hydrogen, radical, isotope-labelled
   hydrogen that needs an explicit choice, and so on).
4. Select one attachment atom per fragment in the selectors or the 3D view. When the
   atom carries explicit hydrogens, choose the hydrogen to replace (clicking a
   hydrogen selects both). The supplied `R-groups_from7WH5lig.sdf` reference uses
   **atom 1 in each record** (implicit hydrogens); fragment 2 atom 6 with its
   explicit hydrogen 7 is also valid.
5. Choose maximum attachment RMSD (0.1–1 Å; default 0.75), the number of distinct
   products to retain (1–50; default 20) and start the search.
6. The search runs as a background job. Progress shows examined/total candidate
   pairs, conformers and valid placements; partial results update while it runs and
   **Cancel** stops it. Returning to the page resumes the newest active job.
7. Select a product to overlay it on the query, inspect the attachment mapping in
   original numbering, optionally refine it, and download the product or refined SDF.

## Attachment rules

Each attachment is one new single bond that replaces one hydrogen on the selected
atom. With an implicit hydrogen available the implicit one is used; otherwise the
first ordinary explicit hydrogen is recommended, or the user chooses one. When an
explicit hydrogen is replaced, the new bond must stay within
min(35°, half the smallest angle between that hydrogen and any other neighbour − 1°)
of the removed hydrogen direction. This keeps the new configuration unambiguous
(the bond cannot swap to a sibling hydrogen's position). Deuterium, tritium and
isotope-labelled hydrogens (`M  ISO` or a nonzero atom-block mass difference) are
never chosen automatically; charged hydrogens are refused.

An explicit-hydrogen site is searched **only in the chosen hydrogen's direction**,
by design. At an explicit CH2 or CH3 (or NH2) centre each hydrogen gives a different
exit vector and, for CH2, a different configuration, so a complete scan covers the
chosen hydrogen replacement only: it is not evidence about the other hydrogens on
that atom. Search each other hydrogen as its own job when those placements matter.
Implicit hydrogens are not directional: a tetrahedral C with one implicit H keeps
the new bond in that hydrogen's hemisphere, while implicit CH2/CH3 and N–H centres
are screened by bond angles alone.

Supported attachment centres are C and N, plus neutral, non-aromatic,
two-coordinate O–H and S–H (bent, O 95–135°, S 85–120°), on both the query and the
linker side. Supported new bonds are C–C, C–N, N–N, C–O, C–S, N–O and N–S.
Phosphorus and O–O, O–S and S–S links are refused rather than given unvalidated
geometry. N–O and N–S products are checked for valence and geometry only; their
chemical stability is not assessed. In the current library every He label sits on
nitrogen (all 3,121,092 labels), so O/S query centres can only form N–O or N–S bonds.
Unsupported SDF versions, query bonds, atom aliases and radicals are refused.

The product keeps every surviving uploaded atom first, in original order, with its
exact coordinates, formal charge, isotope and stereo flags; the replaced hydrogen is
removed and the mapping is returned. Isotopes are written once, as absolute
`M  ISO` values (atom-block mass difference 0). V2000 atom parity is renumbered for
the product following the CTfile rule RDKit uses (neighbours by atom number, any
hydrogen highest): the replaced hydrogen's place is taken by a heavy linker atom and
unused He labels become hydrogen caps, so parity always describes the same 3D
arrangement. The chiral flag is 1 only when the linker and both query records set
it; otherwise 0, and stereo is read from the 3D coordinates.

`fixedAtoms` and `PYXIS_FIXED_ATOMS` list every surviving uploaded atom, product
atoms 1..`fragmentAtomCount` (heavy atoms and uploaded explicit hydrogens): exactly
what refinement holds fixed; the engine result also reports `fixedHeavyAtoms`, the heavy subset. Product SDFs
carry SD data items: `PYXIS_METHOD`, `PYXIS_ANCHOR_RMSD`, `PYXIS_SOURCE_ATOM_MAP`
(`fragment.atom=productAtom`, `-` for a removed hydrogen), `PYXIS_ATTACHMENTS`,
`PYXIS_FIXED_ATOMS`, `PYXIS_LINKER_ID`, `PYXIS_CONFORMER_ID`, `PYXIS_LINKER_ATOMS`
and `PYXIS_FIT_RMSD`.

## Matching method

The method is **Pyxis rigid two-fragment matching**. Each neutral, singly bonded He
label identifies a linker exit vector; the new fragment atom replaces that label at
an element-specific bond length. Eligible label pairs on different neighbouring atoms
are tested in both fragment assignments. Proper rotations and a 10-degree torsion
scan align the linker without reflection. Selected labels are removed; unused labels
become hydrogen caps. RDKit validates the joined chemical graph.

Reported RMSD describes the fit between the two attachment anchors, in angstroms.
It is not a binding, similarity, energy or synthesis score. Products undergo bond
length, attachment-angle, planarity and severe clash screening. An N single-bonded
to a C bearing C=O or C=S is screened as a planar amide centre, including when that
acyl C is the partner across the new bond (an aldehyde or formamide C–H joined to a
linker N, or a query N joined to a linker acyl C).

## Complete search

A search examines **every** indexed label pair inside an anchor-distance window
that provably contains every pair the engine could accept: the index stores nominal
1.5 Å anchor distances, and the window adds `2 × maxRmsd` plus the largest
element-specific bond-length difference for each attachment. Pairs are read in
conformer order in bounded chunks by worker threads on the scientific host; each
record is parsed once for all of its pairs. There is no distance ranking or pair
cap; duplicate distances and duplicate conformers are all examined and counted.
Measured on the scientific host, the supplied reference query's full scan examined
2,519,224 pairs in about 8.8 minutes with 2 workers.

Only a scan that examined all window pairs is labelled **complete**. Queued,
running, canceled and failed scans are partial, and zero matches from a partial
scan is not proof that no linker exists. Results retain the best `limit` distinct
products (deduplicated by RDKit stereo SMILES), ranked by RMSD, then larger minimum
non-bonded radius ratio, then conformer. `validPlacements` counts every accepted
placement. `conformerMatches` (per product) and `distinctProducts` count only
placements whose stereo SMILES was computed: a placement whose RMSD is strictly worse
than the retained K-th product is counted as valid without a SMILES, and at most
200,000 distinct SMILES are tracked. When either happens the job reports
`conformerMatchesExact: false` and both numbers are lower bounds; otherwise they are
exact.

Jobs belong to the authenticated user within their company; other users receive
not-found. One job runs at a time with a small queue; each user may have one queued
or running job. Jobs live in memory on the scientific host for six hours after they
finish, so a service restart loses them. A job exceeding its wall-time limit fails
and keeps its partial results.

## Refinement

Refinement is optional and runs per selected product with Python RDKit on the
scientific host. It adds any implicit hydrogens (appended after existing atoms),
keeps **every surviving uploaded fragment atom fixed** (heavy atoms and uploaded
explicit hydrogens) and minimizes the linker and added hydrogens with MMFF94
(or UFF). *Auto* uses MMFF94 when every atom is parameterized and otherwise falls back
to UFF, reporting why; an explicit force field that lacks parameters is refused and
lists the unsupported atoms. The report gives the force field, RDKit version,
convergence, an iteration upper bound (RDKit's Python API counts in blocks of 50),
initial and final force-field energies in kcal/mol (without restraints), fixed-atom
deviation, moved-atom RMSD, and stereo labels before and after.

A **receptor** is optional: upload a ligand-free PDB in the same coordinate frame
(≤ 5 MB). Waters and hydrogens are dropped; other HET groups are kept and listed.
The receptor is refused when its heavy atoms lie within 1.2 Å of the fixed fragments
(bound ligand still present or wrong frame) or when nothing lies within 8 Å of the
product. Nearby receptor atoms become fixed excluded-volume points with flat-bottom
repulsive restraints; the restraint energy is reported separately. Clashes use a
van der Waals overlap ≥ 0.6 Å (Bondi radii) and are reported before and after.

Refinement is a local force-field geometry cleanup. It is **not** MOE refinement or
scoring and does not estimate binding affinity, selectivity or synthesis feasibility.
The broader scaffold replacement and multi-fragment workflows in the supplied MOE
PDF are outside this two-fragment implementation.

## Runtime boundary

The source archive, derived index, matching workers and refinement run on the
scientific data host. The service binds loopback and is reached through private
transport. The application uses `LINK_FRAGMENTS_BASE`; absent or failed configuration
reports unavailable, with no supplier fallback. API routes
`/api/link-fragments/{status,inspect,jobs,…}` require an active authenticated user;
the server derives the job owner from the session and never trusts a client-supplied
owner. This workflow does not charge credits.

Staging shares application accounts and records with production. Link Fragments
does not persist searches in the application database or purchase anything; uploads
go to owned compute. See [service instructions](../services/link-fragments/README.md)
and [staging deployment](../deploy/staging/README.md).

## Verification

`bun run test:link-fragments` covers the supplied example (graph, stereochemistry,
unchanged query coordinates), explicit-hydrogen replacement, O/S rules, the safe
distance window, fast-versus-reference fitting equivalence, the job lifecycle
(complete, canceled, failed, owner isolation, queue limits), the application route
and the UI job/selection helpers. Refinement tests need Python RDKit and skip visibly
elsewhere; run them on the scientific host. For release, also exercise upload,
attachment selection, job progress and cancel, refinement, preview and SDF download
in the browser. A fixture match alone does not qualify a scientific result or MOE
replacement.
