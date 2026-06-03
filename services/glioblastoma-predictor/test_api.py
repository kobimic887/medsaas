#!/usr/bin/env python3
"""
Test script for the Glioblastoma Drug Sensitivity Predictor API
"""

import requests
import json

# API base URL
BASE_URL = "http://localhost:5000"

def test_health_check():
    """Test health check endpoint"""
    print("Testing health check...")
    response = requests.get(f"{BASE_URL}/health")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    print("-" * 50)

def test_single_prediction():
    """Test single SMILES prediction"""
    print("Testing single prediction...")
    
    # Example SMILES for Temozolomide (glioblastoma drug)
    smiles = "CN1C(=O)C2=C(N=CN2C)N(C1=O)C(=O)N"
    
    data = {"smiles": smiles}
    response = requests.post(f"{BASE_URL}/predict", json=data)
    
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    print("-" * 50)

def test_batch_prediction():
    """Test batch SMILES prediction"""
    print("Testing batch prediction...")
    
    # Example SMILES strings
    smiles_list = [
        "CN1C(=O)C2=C(N=CN2C)N(C1=O)C(=O)N",  # Temozolomide
        "CC1=C(C=CC=C1)NC(=O)C2=CC=C(C=C2)CN3CCN(CC3)C",  # Example compound
        "C1=CC=C(C=C1)C(=O)O"  # Benzoic acid (simple)
    ]
    
    data = {"smiles_list": smiles_list}
    response = requests.post(f"{BASE_URL}/batch_predict", json=data)
    
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    print("-" * 50)

def test_api_documentation():
    """Test API documentation endpoint"""
    print("Testing API documentation...")
    response = requests.get(f"{BASE_URL}/")
    print(f"Status: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    print("-" * 50)

if __name__ == "__main__":
    print("Glioblastoma Drug Sensitivity Predictor API Test")
    print("=" * 60)
    
    try:
        test_api_documentation()
        test_health_check()
        test_single_prediction()
        test_batch_prediction()
        
        print("All tests completed!")
        
    except requests.exceptions.ConnectionError:
        print("ERROR: Could not connect to API. Make sure the service is running on localhost:5000")
    except Exception as e:
        print(f"ERROR: {str(e)}")