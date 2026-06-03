protein_bytes=`curl -s https://files.rcsb.org/download/8G43.pdb | grep -E '^ATOM' | sed -z 's/\n/\\\n/g'`; \
ligand_bytes=`curl -s https://files.rcsb.org/ligands/download/ZU6_ideal.sdf | sed -z 's/\n/\\\n/g'`; \
echo "{
     \"ligand\": \"${ligand_bytes}\",
     \"ligand_file_type\": \"sdf\",
     \"protein\": \"${protein_bytes}\",
     \"num_poses\": 1,
     \"time_divisions\": 20,
     \"steps\": 18,
     \"save_trajectory\": false,
     \"is_staged\": false
}" > diffdock.json
 
curl --header "Content-Type: application/json" \
    --request POST \
    --data @diffdock.json \
    --output output.json \
http://localhost:8000/molecular-docking/diffdock/generate