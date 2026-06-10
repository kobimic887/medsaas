#!/bin/sh
# Usage: diff_dock.sh <protein> <ligand> <work_dir>
# $1/$2 are validated upstream but intentionally NOT interpolated into any
# command here — the demo flow hardcodes 8G43/ZU6. All files live under the
# per-request work dir so concurrent requests can't clobber each other.
set -eu
work_dir="${3:-.}"

protein_bytes=`curl -s https://files.rcsb.org/download/8G43.pdb | grep -E '^ATOM' | sed -z 's/\n/\\\n/g'`
ligand_bytes=`curl -s https://files.rcsb.org/ligands/download/ZU6_ideal.sdf | sed -z 's/\n/\\\n/g'`
echo "{
     \"ligand\": \"${ligand_bytes}\",
     \"ligand_file_type\": \"sdf\",
     \"protein\": \"${protein_bytes}\",
     \"num_poses\": 1,
     \"time_divisions\": 20,
     \"steps\": 18,
     \"save_trajectory\": false,
     \"is_staged\": false
}" > "${work_dir}/diffdock.json"

curl --header "Content-Type: application/json" \
    --request POST \
    --data @"${work_dir}/diffdock.json" \
    --output "${work_dir}/output.json" \
http://localhost:8000/molecular-docking/diffdock/generate
