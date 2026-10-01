#!/usr/bin/env python3
"""Constrained force-field refinement of one Pyxis linked product.

stdin: JSON {sdf, fixedAtoms (1-based), fragmentAtomCount, forceField: auto|MMFF94|UFF,
receptorPdb?, maxIterations?}; stdout: one JSON RefinementResult. `--status` probes RDKit.

Uploaded fragment atoms (product atoms 1..fragmentAtomCount) are fixed points; linker atoms
and hydrogens added by RDKit move. Added hydrogens are appended, so uploaded numbering is kept.
An optional ligand-free receptor in the same frame is rigid excluded volume only: its heavy
atoms become fixed extra points with flat-bottom repulsive distance restraints. Energies are
in-vacuo force-field energies of the product, never binding affinities, and this is not MOE.
"""
import json
import math
import os
import sys

MAX_SDF_BYTES = 1_000_000
MAX_RECEPTOR_BYTES = 5 * 1024 * 1024
MAX_RECEPTOR_ATOMS = 100_000
MAX_ATOMS = 999
ITERATION_BLOCK = 50
OVERLAP_DISTANCE = 1.2  # receptor heavy atom this close to a fixed fragment atom: ligand left in / wrong frame
FRAME_DISTANCE = 8.0  # no receptor heavy atom this close to the product: not the same frame
CLASH_OVERLAP = 0.6  # ChimeraX default VDW-overlap clash cutoff
POINT_CUTOFF = 8.0
POINT_CAP = 3000
RESTRAINT_REACH = 4.0  # restrain pairs initially within minimum + reach; motion is local
HEAVY_ALLOWANCE = 0.5  # restraint minimum = rA + rB - allowance (just inside the clash cutoff)
HYDROGEN_ALLOWANCE = 0.9  # keeps H...O/N hydrogen-bond distances unpenalized
RESTRAINT_FORCE = 100.0  # kcal/mol/A^2
WATERS = {'HOH', 'WAT', 'DOD', 'H2O', 'TIP', 'TIP3', 'SOL'}
# Bondi 1964 van der Waals radii (A); B from Mantina 2009. Others use DEFAULT_RADIUS with a warning.
RADII = {'H': 1.2, 'C': 1.7, 'N': 1.55, 'O': 1.52, 'F': 1.47, 'P': 1.8, 'S': 1.8, 'Cl': 1.75,
         'Br': 1.85, 'I': 1.98, 'Se': 1.9, 'Si': 2.1, 'B': 1.92, 'Na': 2.27, 'K': 2.75,
         'Mg': 1.73, 'Zn': 1.39, 'Cu': 1.4, 'Ni': 1.63, 'Li': 1.82}
DEFAULT_RADIUS = 2.0
MMFF_ELEMENTS = {'H', 'C', 'N', 'O', 'F', 'Si', 'P', 'S', 'Cl', 'Br', 'I', 'Li', 'Na', 'K',
                 'Mg', 'Ca', 'Fe', 'Zn', 'Cu'}
TWO_LETTER = {'CL', 'BR', 'NA', 'MG', 'ZN', 'FE', 'CA', 'MN', 'CU', 'NI', 'CO', 'SE', 'LI',
              'CD', 'HG', 'SR', 'BA', 'CS', 'RB', 'AL', 'SI', 'PT', 'AU', 'AG', 'PB', 'SN'}
LIMITATIONS = [
    'Local minimization of the fitted pose only; no conformational search or sampling.',
    'Energies are in-vacuo force-field energies of the product (constant dielectric); '
    'they are not binding affinities or free energies.',
    'Not equivalent to MOE refinement or any MOE protocol; no synthesis feasibility assessment.',
    'RDKit does not expose the exact iteration count; iterations are counted in blocks of '
    '%d (upper bound).' % ITERATION_BLOCK,
]
RECEPTOR_LIMITATIONS = [
    'The receptor is rigid excluded volume from heavy atoms only (flat-bottom repulsive '
    'restraints); no receptor electrostatics, hydrogens, solvation or flexibility.',
]


class Refusal(Exception):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details

    def json(self):
        error = {'code': self.code, 'message': self.message}
        if self.details is not None:
            error['details'] = self.details
        return {'ok': False, 'errors': [error]}


def invalid(message):
    return Refusal('INVALID_REFINEMENT_INPUT', message)


def rounded(value, digits=6):
    return None if value is None else round(float(value), digits)


def status():
    import rdkit
    from rdkit.Chem import rdForceFieldHelpers  # noqa: F401
    import numpy  # noqa: F401
    return {'available': True, 'rdkitVersion': rdkit.__version__, 'forceFields': ['MMFF94', 'UFF']}


def first_molblock(sdf):
    text = sdf.replace('\r', '')
    end = text.find('\nM  END')
    if end < 0:
        raise invalid('Product SDF has no M  END line.')
    block = text[:end] + '\nM  END\n'
    lines = block.split('\n')
    if len(lines) < 4 or 'V2000' not in lines[3]:
        raise invalid('Only V2000 product records are supported.')
    return block


def read_request(request):
    if not isinstance(request, dict):
        raise invalid('Request must be a JSON object.')
    sdf = request.get('sdf')
    if not isinstance(sdf, str) or not sdf.strip() or len(sdf.encode('utf-8')) > MAX_SDF_BYTES:
        raise invalid('Supply a product SDF under 1 MB.')
    count = request.get('fragmentAtomCount')
    fixed = request.get('fixedAtoms')
    if not isinstance(count, int) or isinstance(count, bool) or count < 1:
        raise invalid('fragmentAtomCount must be a positive integer.')
    if (not isinstance(fixed, list) or not fixed or len(fixed) > MAX_ATOMS
            or any(not isinstance(a, int) or isinstance(a, bool) for a in fixed)):
        raise invalid('fixedAtoms must be a non-empty list of 1-based atom numbers.')
    force_field = request.get('forceField') or 'auto'
    if force_field not in ('auto', 'MMFF94', 'UFF'):
        raise invalid('forceField must be auto, MMFF94 or UFF.')
    iterations = request.get('maxIterations', 2000)
    if not isinstance(iterations, int) or isinstance(iterations, bool) or not 10 <= iterations <= 10000:
        raise invalid('maxIterations must be an integer from 10 to 10000.')
    receptor = request.get('receptorPdb')
    if receptor is not None and not isinstance(receptor, str):
        raise invalid('receptorPdb must be PDB text.')
    if receptor is not None and len(receptor.encode('utf-8')) > MAX_RECEPTOR_BYTES:
        raise Refusal('RECEPTOR_TOO_LARGE', 'Receptor PDB must be 5 MB or smaller.')
    return sdf, count, fixed, force_field, iterations, receptor or None


def element_from_name(name, record):
    raw = name.upper()
    if record == 'HETATM' and raw[:1].isalpha() and raw[:2] in TWO_LETTER:
        return raw[:2].capitalize()
    letters = ''.join(c for c in raw.strip() if c.isalpha())
    return letters[:1].capitalize() if letters else ''


def parse_pdb(text):
    """Strict fixed-column ATOM/HETATM reader. First model only, first alternate location only."""
    atoms, hets, warnings = [], {}, []
    read = waters = hydrogens = alternates = 0
    models = 0
    alt_chosen = {}
    for number, line in enumerate(text.replace('\r', '').split('\n'), 1):
        record = line[:6]
        if record.startswith('MODEL'):
            models += 1
            if models > 1:
                break
            continue
        if record.startswith('ENDMDL') and models:
            break
        if record not in ('ATOM  ', 'HETATM'):
            continue
        read += 1
        if read > MAX_RECEPTOR_ATOMS:
            raise Refusal('RECEPTOR_TOO_LARGE', 'Receptor PDB has more than 100000 atoms.')
        try:
            xyz = (float(line[30:38]), float(line[38:46]), float(line[46:54]))
        except ValueError:
            raise Refusal('RECEPTOR_INVALID', 'PDB line %d has unreadable coordinates.' % number)
        if not all(math.isfinite(v) for v in xyz):
            raise Refusal('RECEPTOR_INVALID', 'PDB line %d has non-finite coordinates.' % number)
        name, alt, residue = line[12:16], line[16:17], line[17:20].strip()
        chain, sequence = line[21:22].strip(), line[22:27].strip()
        element = line[76:78].strip().capitalize() if len(line) >= 78 else ''
        if not element.isalpha():
            element = element_from_name(name, record.strip())
        if not element:
            raise Refusal('RECEPTOR_INVALID', 'PDB line %d has no recognizable element.' % number)
        key = (chain, sequence, residue)
        if alt.strip():
            chosen = alt_chosen.setdefault(key, alt)
            if alt != chosen:
                alternates += 1
                continue
        if residue.upper() in WATERS:
            waters += 1
            continue
        if element in ('H', 'D', 'T'):
            hydrogens += 1
            continue
        if record == 'HETATM':
            het = hets.setdefault(key, {'residue': residue, 'chain': chain, 'number': sequence, 'atoms': 0})
            het['atoms'] += 1
        atoms.append({'element': element, 'xyz': xyz,
                      'label': '%s:%s%s:%s' % (chain or '-', residue, sequence, name.strip())})
    if not read:
        raise Refusal('RECEPTOR_INVALID', 'Receptor PDB contains no ATOM or HETATM records.')
    if not atoms:
        raise Refusal('RECEPTOR_EMPTY', 'Receptor PDB has no heavy atoms after removing hydrogens and waters.')
    if models > 1:
        warnings.append('Only the first MODEL was used.')
    if alternates:
        warnings.append('%d alternate-location atom(s) ignored; the first alternate of each residue was used.' % alternates)
    het_groups = list(hets.values())
    if het_groups:
        warnings.append('HET groups were kept as receptor atoms: %s. Remove bound ligands before refinement.'
                        % ', '.join('%s %s%s' % (h['residue'], h['chain'], h['number']) for h in het_groups[:20]))
    unknown = sorted({a['element'] for a in atoms if a['element'] not in RADII})
    if unknown:
        warnings.append('No tabulated radius for %s; %.1f A was used.' % (', '.join(unknown), DEFAULT_RADIUS))
    return {'atoms': atoms, 'atomsRead': read, 'watersRemoved': waters, 'hydrogensRemoved': hydrogens,
            'hetGroups': het_groups, 'warnings': warnings}


def unsupported_atoms(mol, force_field):
    from rdkit.Chem import rdForceFieldHelpers as helpers
    from rdkit.ForceField import rdForceField  # noqa: F401
    atoms = []
    if force_field == 'MMFF94':
        atoms = [a.GetIdx() for a in mol.GetAtoms() if a.GetSymbol() not in MMFF_ELEMENTS]
        reason = 'MMFF94 has no atom types for these elements.'
        if not atoms:
            props = helpers.MMFFGetMoleculeProperties(mol)
            if props is not None:
                atoms = sorted({i for b in mol.GetBonds() for i in (b.GetBeginAtomIdx(), b.GetEndAtomIdx())
                                if props.GetMMFFBondStretchParams(mol, b.GetBeginAtomIdx(), b.GetEndAtomIdx()) is None})
                reason = 'MMFF94 lacks bond or angle parameters around these atoms.'
            else:
                reason = 'MMFF94 atom typing failed (unsupported valence, charge or bonding environment).'
    else:
        atoms = sorted({i for b in mol.GetBonds() for i in (b.GetBeginAtomIdx(), b.GetEndAtomIdx())
                        if helpers.GetUFFBondStretchParams(mol, b.GetBeginAtomIdx(), b.GetEndAtomIdx()) is None})
        reason = 'UFF lacks parameters for these atoms (atom typing, bond, angle or torsion terms).'
    return {'forceField': force_field, 'atoms': [i + 1 for i in atoms],
            'elements': sorted({mol.GetAtomWithIdx(i).GetSymbol() for i in atoms}), 'reason': reason}


def choose_force_field(mol, requested):
    from rdkit.Chem import rdForceFieldHelpers as helpers
    mmff = helpers.MMFFHasAllMoleculeParams(mol)
    uff = helpers.UFFHasAllMoleculeParams(mol)
    if requested == 'MMFF94' and not mmff or requested == 'UFF' and not uff:
        missing = unsupported_atoms(mol, requested)
        raise Refusal('REFINEMENT_UNSUPPORTED', '%s has no parameters for this product; choose another force field.'
                      % requested, {'unsupported': [missing]})
    if requested != 'auto':
        return requested, None, []
    if mmff:
        return 'MMFF94', None, []
    missing = unsupported_atoms(mol, 'MMFF94')
    if uff:
        elements = ', '.join(missing['elements']) or 'this bonding environment'
        return 'UFF', 'MMFF94 has no parameters for %s; UFF was used.' % elements, [missing]
    raise Refusal('REFINEMENT_UNSUPPORTED', 'Neither MMFF94 nor UFF has parameters for this product.',
                  {'unsupported': [missing, unsupported_atoms(mol, 'UFF')]})


def build_force_field(mol, name):
    from rdkit.Chem import rdForceFieldHelpers as helpers
    from rdkit.ForceField import rdForceField  # noqa: F401 - registers the Python force-field classes
    if name == 'MMFF94':
        props = helpers.MMFFGetMoleculeProperties(mol, mmffVariant='MMFF94')
        field = helpers.MMFFGetMoleculeForceField(mol, props, nonBondedThresh=100.0,
                                                  ignoreInterfragInteractions=False)
    else:
        field = helpers.UFFGetMoleculeForceField(mol, vdwThresh=10.0, ignoreInterfragInteractions=False)
    if field is None:
        raise Refusal('REFINEMENT_UNSUPPORTED', '%s force field could not be set up for this product.' % name)
    field.Initialize()
    return field


def stereo(mol, coordinates):
    from rdkit import Chem
    copy = Chem.Mol(mol)
    conformer = copy.GetConformer()
    for i, xyz in enumerate(coordinates):
        conformer.SetAtomPosition(i, xyz.tolist())
    Chem.AssignStereochemistryFrom3D(copy)
    try:
        from rdkit.Chem import rdCIPLabeler
        rdCIPLabeler.AssignCIPLabels(copy)
    except Exception:  # legacy labels from AssignStereochemistryFrom3D remain
        pass
    atoms = [{'atom': a.GetIdx() + 1, 'label': a.GetProp('_CIPCode')}
             for a in copy.GetAtoms() if a.HasProp('_CIPCode')]
    bonds = [{'atoms': [b.GetBeginAtomIdx() + 1, b.GetEndAtomIdx() + 1], 'label': b.GetProp('_CIPCode')}
             for b in copy.GetBonds() if b.HasProp('_CIPCode')]
    return {'atoms': atoms, 'bonds': bonds,
            'smiles': Chem.MolToSmiles(Chem.RemoveHs(copy), isomericSmiles=True)}


def pairwise(a, b, block=4096):
    """Distance matrix a x b computed in row blocks to bound memory for large receptors."""
    import numpy as np
    out = np.empty((len(a), len(b)))
    for start in range(0, len(b), block):
        chunk = b[start:start + block]
        out[:, start:start + len(chunk)] = np.linalg.norm(a[:, None, :] - chunk[None, :, :], axis=2)
    return out


def radius(element):
    return RADII.get(element, DEFAULT_RADIUS)


def clash_report(coords, heavy, elements, receptor, receptor_xyz, receptor_radii, fixed):
    import numpy as np
    distances = pairwise(coords[heavy], receptor_xyz)
    product_radii = np.array([radius(elements[i]) for i in heavy])
    overlap = product_radii[:, None] + receptor_radii[None, :] - distances
    rows, cols = np.nonzero(overlap >= CLASH_OVERLAP)
    order = np.argsort(-overlap[rows, cols])
    listed = [{'productAtom': int(heavy[rows[k]]) + 1, 'receptorAtom': receptor[cols[k]]['label'],
               'distance': rounded(distances[rows[k], cols[k]], 3),
               'overlap': rounded(overlap[rows[k], cols[k]], 3), 'fixed': int(heavy[rows[k]]) in fixed}
              for k in order[:20]]
    return {'count': int(len(rows)), 'fixed': int(sum(1 for r in rows if int(heavy[r]) in fixed)),
            'minHeavyDistance': rounded(distances.min(), 3), 'listed': listed}


def refine(request):
    import numpy as np
    import rdkit
    from rdkit import Chem

    sdf, fragment_count, fixed_numbers, requested, max_iterations, receptor_text = read_request(request)
    block = first_molblock(sdf)
    mol = Chem.MolFromMolBlock(block, sanitize=True, removeHs=False)
    if mol is None or mol.GetNumConformers() != 1:
        raise invalid('Product SDF could not be read and sanitized by RDKit.')
    count = mol.GetNumAtoms()
    if not 2 <= count <= MAX_ATOMS or fragment_count >= count:
        raise invalid('fragmentAtomCount must leave at least one linker atom to refine.')
    if any(not 1 <= a <= fragment_count for a in fixed_numbers):
        raise invalid('fixedAtoms must lie within the uploaded fragment atoms 1..fragmentAtomCount.')
    receptor = parse_pdb(receptor_text) if receptor_text else None

    hydrogenated = Chem.AddHs(mol, addCoords=True)
    total = hydrogenated.GetNumAtoms()
    if total > MAX_ATOMS:
        raise invalid('Product exceeds 999 atoms after adding implicit hydrogens.')
    if any(hydrogenated.GetAtomWithIdx(i).GetAtomicNum() != mol.GetAtomWithIdx(i).GetAtomicNum()
           for i in range(count)):
        raise Refusal('REFINEMENT_FAILED', 'Hydrogen addition changed atom numbering.')
    # Every surviving uploaded atom stays put: heavy atoms by contract, uploaded explicit H too.
    fixed = set(range(fragment_count)) | {a - 1 for a in fixed_numbers}
    fixed_heavy = sorted(i for i in fixed if hydrogenated.GetAtomWithIdx(i).GetAtomicNum() > 1)
    movable = [i for i in range(total) if i not in fixed]
    elements = [a.GetSymbol() for a in hydrogenated.GetAtoms()]
    heavy = [i for i in range(total) if hydrogenated.GetAtomWithIdx(i).GetAtomicNum() > 1]
    start = np.array(hydrogenated.GetConformer().GetPositions())

    name, fallback, unsupported = choose_force_field(hydrogenated, requested)
    plain = build_force_field(hydrogenated, name)
    field = build_force_field(hydrogenated, name)
    for i in sorted(fixed):
        field.AddFixedPoint(i)

    receptor_report = None
    if receptor:
        receptor_xyz = np.array([a['xyz'] for a in receptor['atoms']])
        receptor_radii = np.array([radius(a['element']) for a in receptor['atoms']])
        near_fixed = pairwise(start[fixed_heavy], receptor_xyz)
        if near_fixed.min() < OVERLAP_DISTANCE:
            rows, cols = np.nonzero(near_fixed < OVERLAP_DISTANCE)
            raise Refusal('RECEPTOR_OVERLAP', 'Receptor atoms occupy the uploaded fragment positions. Remove the '
                          'bound ligand and supply a ligand-free receptor in the same frame.',
                          {'overlappingAtoms': int(len(rows)), 'minDistance': rounded(near_fixed.min(), 3),
                           'examples': [{'productAtom': fixed_heavy[r] + 1, 'receptorAtom': receptor['atoms'][c]['label'],
                                         'distance': rounded(near_fixed[r, c], 3)}
                                        for r, c in list(zip(rows, cols))[:10]]})
        to_product = pairwise(start, receptor_xyz).min(axis=0)
        heavy_min = pairwise(start[heavy], receptor_xyz).min()
        if heavy_min > FRAME_DISTANCE:
            raise Refusal('RECEPTOR_FRAME', 'No receptor heavy atom lies within %.0f A of the product; the receptor '
                          'is not in the same coordinate frame as the uploaded fragments.' % FRAME_DISTANCE,
                          {'minHeavyDistance': rounded(heavy_min, 3)})
        selected = np.nonzero(to_product <= POINT_CUTOFF)[0]
        warnings = list(receptor['warnings'])
        if len(selected) > POINT_CAP:
            selected = selected[np.argsort(to_product[selected])[:POINT_CAP]]
            warnings.append('Excluded volume used the %d receptor atoms nearest the product.' % POINT_CAP)
        # Only receptor atoms that restrain some movable atom become points: every extra point
        # enlarges the BFGS problem even though fixed points never move.
        pairs = []
        if len(selected) and movable:
            distances = pairwise(start[movable], receptor_xyz[selected])
            for r, i in enumerate(movable):
                own = radius(elements[i])
                allowance = HEAVY_ALLOWANCE if elements[i] != 'H' else HYDROGEN_ALLOWANCE
                minimum = own + receptor_radii[selected] - allowance
                for c in np.nonzero(distances[r] < minimum + RESTRAINT_REACH)[0]:
                    pairs.append((i, int(selected[c]), float(minimum[c])))
        points = {}
        for j in sorted({j for _, j, _ in pairs}):
            points[j] = field.AddExtraPoint(*map(float, receptor_xyz[j]), True) - 1  # returns the new point count
        field.Initialize()
        if len(field.Positions()) != 3 * (total + len(points)):
            raise Refusal('REFINEMENT_FAILED', 'Force-field extra points were not registered as expected.')
        add = field.MMFFAddDistanceConstraint if name == 'MMFF94' else field.UFFAddDistanceConstraint
        for i, j, minimum in pairs:
            add(i, points[j], False, minimum, 1.0e6, RESTRAINT_FORCE)
        restraints = len(pairs)
        before = clash_report(start, heavy, elements, receptor['atoms'], receptor_xyz, receptor_radii, fixed)
        receptor_report = {'xyz': receptor_xyz, 'radii': receptor_radii, 'before': before, 'warnings': warnings,
                           'atomsUsed': len(points), 'atomsNear': int(len(selected)), 'restraints': restraints}

    initial_energy = plain.CalcEnergy(start.flatten().tolist())
    initial_total = field.CalcEnergy()
    iterations, code = 0, 1
    while iterations < max_iterations:
        step = min(ITERATION_BLOCK, max_iterations - iterations)
        code = field.Minimize(maxIts=step)
        iterations += step
        if code == 0:
            break
    positions = np.array(field.Positions()).reshape(-1, 3)
    final = positions[:total]
    final_energy = plain.CalcEnergy(final.flatten().tolist())
    restraint_energy = field.CalcEnergy() - final_energy if receptor else None
    conformer = hydrogenated.GetConformer()
    for i, xyz in enumerate(final):
        conformer.SetAtomPosition(i, xyz.tolist())

    displacement = np.linalg.norm(final - start, axis=1)
    moved = displacement[movable] if movable else np.zeros(1)
    stereo_before = stereo(hydrogenated, start)
    stereo_after = stereo(hydrogenated, final)
    preserved = stereo_before == stereo_after
    method = ('Constrained %s minimization (RDKit %s): uploaded fragment atoms fixed; linker atoms and added '
              'hydrogens refined.' % (name, rdkit.__version__))
    limitations = list(LIMITATIONS)
    if receptor:
        method += ' Receptor heavy atoms act as rigid excluded volume.'
        limitations += RECEPTOR_LIMITATIONS
        after = clash_report(final, heavy, elements, receptor['atoms'], receptor_report['xyz'],
                             receptor_report['radii'], fixed)
        warnings = receptor_report['warnings']
        if after['fixed']:
            warnings.append('%d remaining clash(es) involve fixed uploaded fragment atoms; refinement cannot '
                            'move them.' % after['fixed'])
        receptor_report = {
            'atomsRead': receptor['atomsRead'], 'heavyAtoms': len(receptor['atoms']),
            'atomsUsed': receptor_report['atomsUsed'], 'atomsNear': receptor_report['atomsNear'], 'restraints': receptor_report['restraints'],
            'watersRemoved': receptor['watersRemoved'], 'hydrogensRemoved': receptor['hydrogensRemoved'],
            'hetGroups': receptor['hetGroups'],
            'clashesBefore': receptor_report['before']['count'], 'clashesAfter': after['count'],
            'fixedAtomClashesAfter': after['fixed'],
            'minHeavyDistanceBefore': receptor_report['before']['minHeavyDistance'],
            'minHeavyDistanceAfter': after['minHeavyDistance'],
            'clashes': {'before': receptor_report['before']['listed'], 'after': after['listed']},
            'clashDefinition': 'VDW overlap >= %.1f A (rA + rB - d; Bondi radii) between product heavy atoms and '
                               'receptor heavy atoms; receptor hydrogens and waters ignored.' % CLASH_OVERLAP,
            'restraint': 'Flat-bottom harmonic repulsion (%.0f kcal/mol/A^2) keeping movable atoms at least '
                         'rA + rB - %.1f A (hydrogens: - %.1f A) from receptor heavy atoms that start within '
                         'that minimum + %.0f A.' % (RESTRAINT_FORCE, HEAVY_ALLOWANCE, HYDROGEN_ALLOWANCE, RESTRAINT_REACH),
            'warnings': warnings,
        }
    if not preserved:
        limitations.append('Stereochemistry perceived from 3D changed during refinement; inspect the result.')

    block = Chem.MolToMolBlock(hydrogenated, kekulize=True)
    data = {'PYXIS_REFINEMENT_FORCE_FIELD': name, 'PYXIS_REFINEMENT_CONVERGED': 'true' if code == 0 else 'false',
            'PYXIS_REFINEMENT_ENERGY_KCAL_MOL': '%.4f' % final_energy,
            'PYXIS_REFINEMENT_ADDED_HYDROGENS': str(total - count), 'PYXIS_REFINEMENT_METHOD': method}
    output = block + ''.join('> <%s>\n%s\n\n' % item for item in data.items()) + '$$$$\n'
    return {
        'ok': True, 'forceField': name, 'requestedForceField': requested, 'fallbackReason': fallback,
        'rdkitVersion': rdkit.__version__, 'converged': code == 0, 'iterations': iterations,
        'iterationBlock': ITERATION_BLOCK, 'maxIterations': max_iterations, 'energyUnits': 'kcal/mol',
        'initialEnergy': rounded(initial_energy, 4), 'finalEnergy': rounded(final_energy, 4),
        'restraintEnergy': rounded(restraint_energy, 4),
        'restraintEnergyInitial': rounded(initial_total - initial_energy, 4) if receptor else None,
        'unsupported': unsupported,
        'fixedAtoms': {'count': len(fixed), 'heavy': len(fixed_heavy), 'hydrogens': len(fixed) - len(fixed_heavy),
                       'maxDeviation': rounded(displacement[sorted(fixed)].max(), 8),
                       'note': 'All surviving uploaded fragment atoms, including explicit hydrogens, are fixed.'},
        'moved': {'atoms': len(movable), 'rmsd': rounded(math.sqrt(float((moved ** 2).mean())), 4),
                  'maxDisplacement': rounded(moved.max(), 4)},
        'addedHydrogens': total - count,
        'stereo': {'preserved': preserved, 'before': stereo_before, 'after': stereo_after},
        'receptor': receptor_report, 'sdf': output, 'method': method, 'limitations': limitations,
    }


def main():
    channel = os.fdopen(os.dup(1), 'w')
    os.dup2(2, 1)  # native RDKit chatter must never corrupt the JSON channel
    try:
        os.nice(5)
    except OSError:
        pass
    try:
        from rdkit import RDLogger
        RDLogger.DisableLog('rdApp.warning')
        RDLogger.DisableLog('rdApp.info')
        if '--status' in sys.argv[1:]:
            result = status()
        else:
            try:
                request = json.loads(sys.stdin.read())
            except ValueError:
                raise invalid('Request must be JSON.')
            result = refine(request)
    except Refusal as refusal:
        result = refusal.json()
    except ImportError as missing:
        print('refine.py import failure: %s' % missing, file=sys.stderr)
        result = {'ok': False, 'available': False,
                  'errors': [{'code': 'REFINEMENT_UNAVAILABLE', 'message': 'Python RDKit is not available.'}]}
    except Exception:
        import traceback
        traceback.print_exc()
        result = {'ok': False, 'errors': [{'code': 'REFINEMENT_FAILED', 'message': 'Refinement failed unexpectedly.'}]}
    try:
        text = json.dumps(result, allow_nan=False)
    except ValueError:  # a non-finite energy or coordinate is a failed refinement, not a result
        text = json.dumps({'ok': False, 'errors': [{'code': 'REFINEMENT_FAILED',
                                                    'message': 'Refinement produced non-finite values.'}]})
    channel.write(text)
    channel.flush()


if __name__ == '__main__':
    main()
