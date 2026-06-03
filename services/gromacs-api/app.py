from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import subprocess
import os
import uuid
import json
import shutil
import psutil
import signal
from datetime import datetime
from pathlib import Path
import asyncio

app = FastAPI(
    title="GROMACS API",
    description="All-in-one REST API for GROMACS molecular dynamics simulations",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
WORK_DIR = os.getenv("WORK_DIR", "/data")
JOBS_FILE = os.path.join(WORK_DIR, ".jobs.json")
TEMPLATES_DIR = os.path.join(WORK_DIR, ".templates")
MAX_UPLOAD_SIZE = int(os.getenv("MAX_UPLOAD_SIZE", 100 * 1024 * 1024))  # 100MB
JOB_TIMEOUT = int(os.getenv("JOB_TIMEOUT", 3600))  # 1 hour

# Ensure directories exist
os.makedirs(WORK_DIR, exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)

# Job storage
running_processes: Dict[str, subprocess.Popen] = {}

def load_jobs():
    if os.path.exists(JOBS_FILE):
        try:
            with open(JOBS_FILE, 'r') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_jobs(jobs):
    with open(JOBS_FILE, 'w') as f:
        json.dump(jobs, f, indent=2)

jobs_db = load_jobs()

# Pydantic models
class GromacsCommand(BaseModel):
    command: str = Field(..., description="GROMACS command (e.g., pdb2gmx, solvate)")
    args: List[str] = Field(..., description="Command arguments")
    working_dir: Optional[str] = Field(".", description="Working directory relative to /data")
    job_name: Optional[str] = Field(None, description="Optional job name")
    stdin_input: Optional[str] = Field(None, description="Input to send to stdin")

class WorkspaceCreate(BaseModel):
    name: str = Field(..., description="Workspace name")
    description: Optional[str] = None

class TemplateCreate(BaseModel):
    name: str = Field(..., description="Template filename")
    content: str = Field(..., description="Template content")

# Helper functions
def run_gromacs_sync(command: str, args: List[str], working_dir: str = ".", stdin_input: Optional[str] = None) -> Dict[str, Any]:
    """Execute a GROMACS command synchronously"""
    full_cmd = ["gmx", command] + args
    work_path = os.path.join(WORK_DIR, working_dir)
    
    try:
        result = subprocess.run(
            full_cmd,
            cwd=work_path,
            capture_output=True,
            text=True,
            timeout=JOB_TIMEOUT,
            input=stdin_input
        )
        
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "stdout": "",
            "stderr": f"Command timeout after {JOB_TIMEOUT} seconds",
            "returncode": -1
        }
    except Exception as e:
        return {
            "success": False,
            "stdout": "",
            "stderr": str(e),
            "returncode": -1
        }

async def run_job_background(job_id: str, command: str, args: List[str], working_dir: str, stdin_input: Optional[str] = None):
    """Background task for running GROMACS jobs"""
    jobs_db[job_id]["status"] = "running"
    jobs_db[job_id]["started_at"] = datetime.utcnow().isoformat()
    save_jobs(jobs_db)
    
    full_cmd = ["gmx", command] + args
    work_path = os.path.join(WORK_DIR, working_dir)
    log_file = os.path.join(WORK_DIR, f".job_{job_id}.log")
    
    try:
        with open(log_file, 'w') as log:
            process = subprocess.Popen(
                full_cmd,
                cwd=work_path,
                stdout=log,
                stderr=subprocess.STDOUT,
                text=True,
                stdin=subprocess.PIPE if stdin_input else None
            )
            
            running_processes[job_id] = process
            
            if stdin_input:
                process.stdin.write(stdin_input)
                process.stdin.close()
            
            returncode = process.wait(timeout=JOB_TIMEOUT)
            
            with open(log_file, 'r') as log:
                output = log.read()
            
            jobs_db[job_id]["status"] = "completed" if returncode == 0 else "failed"
            jobs_db[job_id]["completed_at"] = datetime.utcnow().isoformat()
            jobs_db[job_id]["result"] = {
                "success": returncode == 0,
                "output": output,
                "returncode": returncode
            }
            
    except subprocess.TimeoutExpired:
        process.kill()
        jobs_db[job_id]["status"] = "failed"
        jobs_db[job_id]["completed_at"] = datetime.utcnow().isoformat()
        jobs_db[job_id]["result"] = {
            "success": False,
            "output": "Job timeout",
            "returncode": -1
        }
    except Exception as e:
        jobs_db[job_id]["status"] = "failed"
        jobs_db[job_id]["completed_at"] = datetime.utcnow().isoformat()
        jobs_db[job_id]["result"] = {
            "success": False,
            "output": str(e),
            "returncode": -1
        }
    finally:
        if job_id in running_processes:
            del running_processes[job_id]
        save_jobs(jobs_db)

# API Endpoints

@app.get("/")
def root():
    return {
        "name": "GROMACS API",
        "version": "1.0.0",
        "description": "All-in-one REST API for GROMACS molecular dynamics",
        "docs": "/docs",
        "health": "/health"
    }

@app.get("/health")
def health_check():
    try:
        result = subprocess.run(["gmx", "--version"], capture_output=True, timeout=5)
        gromacs_ok = result.returncode == 0
    except:
        gromacs_ok = False
    
    return {
        "status": "healthy" if gromacs_ok else "unhealthy",
        "gromacs": "available" if gromacs_ok else "unavailable",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/info")
def system_info():
    try:
        result = subprocess.run(["gmx", "--version"], capture_output=True, text=True, timeout=5)
        version_info = result.stdout
    except:
        version_info = "Unable to get GROMACS version"
    
    return {
        "api_version": "1.0.0",
        "gromacs_version": version_info,
        "work_directory": WORK_DIR,
        "max_upload_size_mb": MAX_UPLOAD_SIZE / (1024 * 1024),
        "job_timeout_seconds": JOB_TIMEOUT
    }

@app.get("/metrics")
def system_metrics():
    cpu_percent = psutil.cpu_percent(interval=1)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage(WORK_DIR)
    
    return {
        "cpu_percent": cpu_percent,
        "memory_percent": memory.percent,
        "memory_available_gb": memory.available / (1024**3),
        "disk_percent": disk.percent,
        "disk_free_gb": disk.free / (1024**3),
        "active_jobs": len([j for j in jobs_db.values() if j.get("status") == "running"])
    }

# File Management

@app.post("/files/upload")
async def upload_file(file: UploadFile, subdir: str = ""):
    """Upload a file to the work directory"""
    try:
        target_dir = os.path.join(WORK_DIR, subdir)
        os.makedirs(target_dir, exist_ok=True)
        
        file_path = os.path.join(target_dir, file.filename)
        
        content = await file.read()
        
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(status_code=413, detail="File too large")
        
        with open(file_path, "wb") as f:
            f.write(content)
        
        return {
            "success": True,
            "filename": file.filename,
            "path": os.path.join(subdir, file.filename) if subdir else file.filename,
            "size": len(content)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/files/list")
def list_files(subdir: str = ""):
    """List files in directory"""
    try:
        target_dir = os.path.join(WORK_DIR, subdir)
        
        if not os.path.exists(target_dir):
            return {"files": [], "directory": subdir}
        
        files = []
        for item in os.listdir(target_dir):
            if item.startswith('.'):  # Skip hidden files
                continue
            item_path = os.path.join(target_dir, item)
            files.append({
                "name": item,
                "type": "directory" if os.path.isdir(item_path) else "file",
                "size": os.path.getsize(item_path) if os.path.isfile(item_path) else None,
                "modified": datetime.fromtimestamp(os.path.getmtime(item_path)).isoformat()
            })
        
        return {"files": files, "directory": subdir}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/files/download/{file_path:path}")
def download_file(file_path: str):
    """Download a file"""
    full_path = os.path.join(WORK_DIR, file_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=400, detail="Path is not a file")
    
    return FileResponse(full_path, filename=os.path.basename(file_path))

@app.get("/files/view/{file_path:path}")
def view_file(file_path: str, lines: int = Query(100, description="Number of lines to return")):
    """View file content (for text files)"""
    full_path = os.path.join(WORK_DIR, file_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    try:
        with open(full_path, 'r') as f:
            content_lines = f.readlines()
            if lines > 0:
                content_lines = content_lines[:lines]
            content = ''.join(content_lines)
        
        return {
            "path": file_path,
            "content": content,
            "lines_shown": len(content_lines),
            "truncated": lines > 0 and lines < len(content_lines)
        }
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="File is not a text file")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/files/delete/{file_path:path}")
def delete_file(file_path: str):
    """Delete a file or directory"""
    full_path = os.path.join(WORK_DIR, file_path)
    
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    try:
        if os.path.isfile(full_path):
            os.remove(full_path)
        elif os.path.isdir(full_path):
            shutil.rmtree(full_path)
        
        return {"success": True, "message": f"Deleted {file_path}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# GROMACS Execution

@app.post("/gromacs/execute")
async def execute_gromacs(cmd: GromacsCommand, background_tasks: BackgroundTasks):
    """Execute GROMACS command asynchronously"""
    job_id = str(uuid.uuid4())
    job_name = cmd.job_name or f"{cmd.command}_{job_id[:8]}"
    
    jobs_db[job_id] = {
        "job_id": job_id,
        "job_name": job_name,
        "command": cmd.command,
        "args": cmd.args,
        "working_dir": cmd.working_dir,
        "status": "queued",
        "created_at": datetime.utcnow().isoformat()
    }
    save_jobs(jobs_db)
    
    background_tasks.add_task(
        run_job_background,
        job_id,
        cmd.command,
        cmd.args,
        cmd.working_dir,
        cmd.stdin_input
    )
    
    return {
        "job_id": job_id,
        "job_name": job_name,
        "status": "queued",
        "message": "Job submitted successfully"
    }

@app.post("/gromacs/execute/sync")
async def execute_gromacs_sync(cmd: GromacsCommand):
    """Execute GROMACS command synchronously"""
    result = run_gromacs_sync(cmd.command, cmd.args, cmd.working_dir, cmd.stdin_input)
    
    return {
        "command": cmd.command,
        "args": cmd.args,
        "success": result["success"],
        "stdout": result["stdout"],
        "stderr": result["stderr"],
        "returncode": result["returncode"]
    }

@app.get("/gromacs/version")
def gromacs_version():
    """Get GROMACS version"""
    result = run_gromacs_sync("--version", [])
    return {
        "success": result["success"],
        "version": result["stdout"]
    }

@app.get("/gromacs/commands")
def list_gromacs_commands():
    """List available GROMACS commands"""
    result = run_gromacs_sync("help", ["commands"])
    return {
        "success": result["success"],
        "commands": result["stdout"]
    }

@app.get("/gromacs/help/{command}")
def gromacs_help(command: str):
    """Get help for specific GROMACS command"""
    result = run_gromacs_sync(command, ["-h"])
    return {
        "command": command,
        "success": result["success"],
        "help": result["stdout"]
    }

# Job Management

@app.get("/jobs")
def list_jobs(status: Optional[str] = None, limit: int = 100):
    """List jobs with optional filtering"""
    jobs_list = list(jobs_db.values())
    
    if status:
        jobs_list = [j for j in jobs_list if j.get("status") == status]
    
    jobs_list = sorted(jobs_list, key=lambda x: x.get("created_at", ""), reverse=True)
    
    return {"jobs": jobs_list[:limit], "total": len(jobs_list)}

@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    """Get job details"""
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    return jobs_db[job_id]

@app.delete("/jobs/{job_id}")
def delete_job(job_id: str):
    """Delete job from history"""
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    # Clean up log file
    log_file = os.path.join(WORK_DIR, f".job_{job_id}.log")
    if os.path.exists(log_file):
        os.remove(log_file)
    
    del jobs_db[job_id]
    save_jobs(jobs_db)
    
    return {"success": True, "message": f"Job {job_id} deleted"}

@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str):
    """Cancel a running job"""
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    if jobs_db[job_id]["status"] != "running":
        raise HTTPException(status_code=400, detail="Job is not running")
    
    if job_id in running_processes:
        process = running_processes[job_id]
        process.terminate()
        try:
            process.wait(timeout=5)
        except:
            process.kill()
        
        jobs_db[job_id]["status"] = "cancelled"
        jobs_db[job_id]["completed_at"] = datetime.utcnow().isoformat()
        save_jobs(jobs_db)
        
        return {"success": True, "message": "Job cancelled"}
    
    raise HTTPException(status_code=500, detail="Process not found")

@app.get("/jobs/{job_id}/logs")
def get_job_logs(job_id: str):
    """Get job logs"""
    if job_id not in jobs_db:
        raise HTTPException(status_code=404, detail="Job not found")
    
    log_file = os.path.join(WORK_DIR, f".job_{job_id}.log")
    
    if not os.path.exists(log_file):
        return {"job_id": job_id, "logs": "No logs available"}
    
    with open(log_file, 'r') as f:
        logs = f.read()
    
    return {"job_id": job_id, "logs": logs}

# Workflow Endpoints

@app.post("/workflows/pdb2gmx")
async def workflow_pdb2gmx(
    background_tasks: BackgroundTasks,
    pdb_file: str,
    force_field: str = "oplsaa",
    water: str = "spce",
    output_prefix: str = "processed",
    working_dir: str = ".",
    ignh: bool = True
):
    """Generate topology from PDB"""
    args = [
        "-f", pdb_file,
        "-o", f"{output_prefix}.gro",
        "-p", f"{output_prefix}.top",
        "-i", f"{output_prefix}.itp",
        "-ff", force_field,
        "-water", water
    ]
    
    if ignh:
        args.append("-ignh")
    
    cmd = GromacsCommand(
        command="pdb2gmx",
        args=args,
        working_dir=working_dir,
        job_name=f"pdb2gmx_{output_prefix}"
    )
    
    return await execute_gromacs(cmd, background_tasks)

@app.post("/workflows/editconf")
async def workflow_editconf(
    background_tasks: BackgroundTasks,
    input_file: str,
    output_file: str,
    box_type: str = "cubic",
    distance: float = 1.0,
    center: bool = True,
    working_dir: str = "."
):
    """Define simulation box"""
    args = [
        "-f", input_file,
        "-o", output_file,
        "-bt", box_type,
        "-d", str(distance)
    ]
    
    if center:
        args.append("-center")
        args.extend(["0", "0", "0"])
    
    cmd = GromacsCommand(
        command="editconf",
        args=args,
        working_dir=working_dir,
        job_name=f"editconf_{output_file}"
    )
    
    return await execute_gromacs(cmd, background_tasks)

@app.post("/workflows/solvate")
async def workflow_solvate(
    background_tasks: BackgroundTasks,
    structure_file: str,
    topology_file: str,
    output_file: str,
    working_dir: str = "."
):
    """Add solvent to system"""
    args = [
        "-cp", structure_file,
        "-cs", "spc216.gro",
        "-p", topology_file,
        "-o", output_file
    ]
    
    cmd = GromacsCommand(
        command="solvate",
        args=args,
        working_dir=working_dir,
        job_name=f"solvate_{output_file}"
    )
    
    return await execute_gromacs(cmd, background_tasks)

@app.post("/workflows/genion")
async def workflow_genion(
    background_tasks: BackgroundTasks,
    structure_file: str,
    topology_file: str,
    tpr_file: str,
    output_file: str,
    pname: str = "NA",
    nname: str = "CL",
    neutral: bool = True,
    working_dir: str = "."
):
    """Add ions for neutralization"""
    args = [
        "-s", tpr_file,
        "-o", output_file,
        "-p", topology_file,
        "-pname", pname,
        "-nname", nname
    ]
    
    if neutral:
        args.append("-neutral")
    
    # Select SOL group (usually 13 or similar)
    stdin_input = "SOL\n"
    
    cmd = GromacsCommand(
        command="genion",
        args=args,
        working_dir=working_dir,
        job_name=f"genion_{output_file}",
        stdin_input=stdin_input
    )
    
    return await execute_gromacs(cmd, background_tasks)

@app.post("/workflows/grompp")
async def workflow_grompp(
    background_tasks: BackgroundTasks,
    mdp_file: str,
    structure_file: str,
    topology_file: str,
    output_file: str,
    index_file: Optional[str] = None,
    maxwarn: int = 0,
    working_dir: str = "."
):
    """Preprocess MD parameters"""
    args = [
        "-f", mdp_file,
        "-c", structure_file,
        "-p", topology_file,
        "-o", output_file,
        "-maxwarn", str(maxwarn)
    ]
    
    if index_file:
        args.extend(["-n", index_file])
    
    cmd = GromacsCommand(
        command="grompp",
        args=args,
        working_dir=working_dir,
        job_name=f"grompp_{output_file}"
    )
    
    return await execute_gromacs(cmd, background_tasks)

@app.post("/workflows/mdrun")
async def workflow_mdrun(
    background_tasks: BackgroundTasks,
    tpr_file: str,
    output_prefix: str,
    nsteps: Optional[int] = None,
    working_dir: str = "."
):
    """Run molecular dynamics simulation"""
    args = [
        "-s", tpr_file,
        "-deffnm", output_prefix
    ]
    
    if nsteps:
        args.extend(["-nsteps", str(nsteps)])
    
    cmd = GromacsCommand(
        command="mdrun",
        args=args,
        working_dir=working_dir,
        job_name=f"mdrun_{output_prefix}"
    )
    
    return await execute_gromacs(cmd, background_tasks)

@app.post("/workflows/energy")
async def workflow_energy(
    background_tasks: BackgroundTasks,
    edr_file: str,
    output_file: str,
    terms: str = "Potential\nKinetic-En\nTotal-Energy\n",
    working_dir: str = "."
):
    """Extract energy components"""
    args = [
        "-f", edr_file,
        "-o", output_file
    ]
    
    cmd = GromacsCommand(
        command="energy",
        args=args,
        working_dir=working_dir,
        job_name=f"energy_{output_file}",
        stdin_input=terms
    )
    
    return await execute_gromacs(cmd, background_tasks)

@app.post("/workflows/trjconv")
async def workflow_trjconv(
    background_tasks: BackgroundTasks,
    structure_file: str,
    trajectory_file: str,
    output_file: str,
    pbc: str = "mol",
    center: bool = True,
    ur: str = "compact",
    selection: str = "System\nSystem\n",
    working_dir: str = "."
):
    """Convert and process trajectories"""
    args = [
        "-s", structure_file,
        "-f", trajectory_file,
        "-o", output_file,
        "-pbc", pbc,
        "-ur", ur
    ]
    
    if center:
        args.append("-center")
    
    cmd = GromacsCommand(
        command="trjconv",
        args=args,
        working_dir=working_dir,
        job_name=f"trjconv_{output_file}",
        stdin_input=selection
    )
    
    return await execute_gromacs(cmd, background_tasks)

# Templates

@app.get("/templates/list")
def list_templates():
    """List available MDP templates"""
    templates = []
    for item in os.listdir(TEMPLATES_DIR):
        if item.endswith('.mdp'):
            templates.append({
                "name": item,
                "path": os.path.join(TEMPLATES_DIR, item)
            })
    return {"templates": templates}

@app.get("/templates/{name}")
def get_template(name: str):
    """Get template content"""
    template_path = os.path.join(TEMPLATES_DIR, name)
    
    if not os.path.exists(template_path):
        raise HTTPException(status_code=404, detail="Template not found")
    
    with open(template_path, 'r') as f:
        content = f.read()
    
    return {"name": name, "content": content}

@app.post("/templates/create")
async def create_template(template: TemplateCreate):
    """Create a custom template"""
    template_path = os.path.join(TEMPLATES_DIR, template.name)
    
    with open(template_path, 'w') as f:
        f.write(template.content)
    
    return {"success": True, "name": template.name, "path": template_path}

# Workspaces

@app.post("/workspaces/create")
async def create_workspace(workspace: WorkspaceCreate):
    """Create a new project workspace"""
    workspace_path = os.path.join(WORK_DIR, workspace.name)
    
    if os.path.exists(workspace_path):
        raise HTTPException(status_code=400, detail="Workspace already exists")
    
    os.makedirs(workspace_path, exist_ok=True)
    
    # Create metadata file
    metadata = {
        "name": workspace.name,
        "description": workspace.description,
        "created_at": datetime.utcnow().isoformat()
    }
    
    with open(os.path.join(workspace_path, ".metadata.json"), 'w') as f:
        json.dump(metadata, f, indent=2)
    
    return {"success": True, "workspace": workspace.name, "path": workspace_path}

@app.get("/workspaces/list")
def list_workspaces():
    """List all workspaces"""
    workspaces = []
    for item in os.listdir(WORK_DIR):
        item_path = os.path.join(WORK_DIR, item)
        if os.path.isdir(item_path) and not item.startswith('.'):
            metadata_file = os.path.join(item_path, ".metadata.json")
            if os.path.exists(metadata_file):
                with open(metadata_file, 'r') as f:
                    metadata = json.load(f)
                workspaces.append(metadata)
            else:
                workspaces.append({"name": item, "created_at": None})
    
    return {"workspaces": workspaces}

@app.delete("/workspaces/{name}")
def delete_workspace(name: str):
    """Delete workspace and contents"""
    workspace_path = os.path.join(WORK_DIR, name)
    
    if not os.path.exists(workspace_path):
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    shutil.rmtree(workspace_path)
    
    return {"success": True, "message": f"Workspace {name} deleted"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)