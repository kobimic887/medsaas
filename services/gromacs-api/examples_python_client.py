import requests
import time
import sys

class GromacsAPI:
    def __init__(self, base_url="http://localhost:8000"):
        self.base_url = base_url
    
    def upload_file(self, filepath, subdir=""):
        """Upload a file to the API"""
        with open(filepath, "rb") as f:
            files = {"file": f}
            params = {"subdir": subdir} if subdir else {}
            response = requests.post(
                f"{self.base_url}/files/upload",
                files=files,
                params=params
            )
            return response.json()
    
    def execute_command(self, command, args, working_dir=".", wait=True):
        """Execute a GROMACS command"""
        data = {
            "command": command,
            "args": args,
            "working_dir": working_dir
        }
        
        if wait:
            response = requests.post(
                f"{self.base_url}/gromacs/execute/sync",
                json=data
            )
            return response.json()
        else:
            response = requests.post(
                f"{self.base_url}/gromacs/execute",
                json=data
            )
            return response.json()
    
    def get_job_status(self, job_id):
        """Get job status"""
        response = requests.get(f"{self.base_url}/jobs/{job_id}")
        return response.json()
    
    def wait_for_job(self, job_id, poll_interval=2):
        """Wait for job to complete"""
        while True:
            status = self.get_job_status(job_id)
            print(f"Job {job_id}: {status['status']}")
            
            if status["status"] in ["completed", "failed", "cancelled"]:
                return status
            
            time.sleep(poll_interval)
    
    def download_file(self, filepath, output_path):
        """Download a file from the API"""
        response = requests.get(f"{self.base_url}/files/download/{filepath}")
        with open(output_path, "wb") as f:
            f.write(response.content)
        return output_path
    
    def run_workflow(self, workflow, **params):
        """Run a workflow endpoint"""
        response = requests.post(
            f"{self.base_url}/workflows/{workflow}",
            params=params
        )
        return response.json()

# Example usage
if __name__ == "__main__":
    api = GromacsAPI()
    
    # Upload PDB file
    print("Uploading PDB file...")
    upload_result = api.upload_file("protein.pdb")
    print(f"Uploaded: {upload_result}")
    
    # Run pdb2gmx workflow
    print("\nRunning pdb2gmx...")
    job = api.run_workflow(
        "pdb2gmx",
        pdb_file="protein.pdb",
        force_field="oplsaa",
        water="spce",
        output_prefix="processed"
    )
    
    job_id = job["job_id"]
    print(f"Job ID: {job_id}")
    
    # Wait for completion
    result = api.wait_for_job(job_id)
    
    if result["status"] == "completed":
        print("\nJob completed successfully!")
        
        # Download results
        print("Downloading results...")
        api.download_file("processed.gro", "processed.gro")
        api.download_file("processed.top", "processed.top")
        print("Done!")
    else:
        print(f"\nJob failed: {result.get('result', {}).get('output', 'Unknown error')}")