from flask import Flask, request, jsonify
from flask_cors import CORS
import pandas as pd
import numpy as np
try:
    from rdkit import Chem
    from rdkit.Chem import Descriptors, rdMolDescriptors
    RDKIT_AVAILABLE = True
    print("RDKit imported successfully")
except ImportError as e:
    print(f"RDKit import failed: {e}")
    RDKIT_AVAILABLE = False

import joblib
import logging
from sklearn.ensemble import RandomForestRegressor
from sklearn.preprocessing import StandardScaler
import warnings
import ssl
import os
warnings.filterwarnings('ignore')

app = Flask(__name__)

# Enable CORS for all routes and origins
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

logging.basicConfig(level=logging.INFO)

class DrugSensitivityPredictor:
    def __init__(self):
        self.model = None
        self.scaler = None
        self.feature_names = None
        self.is_trained = False
        
    def smiles_to_features(self, smiles):
        """Convert SMILES string to molecular descriptors"""
        if not RDKIT_AVAILABLE:
            logging.error("RDKit is not available")
            return None

        try:
            # Clean the SMILES string
            smiles = smiles.strip()
            logging.info(f"Processing SMILES: '{smiles}'")

            mol = Chem.MolFromSmiles(smiles)
            if mol is None:
                logging.error(f"Invalid SMILES string: {smiles}")
                return None

            logging.info(f"Molecule created successfully for: {smiles}")

            # Calculate molecular descriptors (without FractionCsp3)
            try:
                features = {
                    'MolWt': Descriptors.MolWt(mol),
                    'LogP': Descriptors.MolLogP(mol),
                    'NumHDonors': Descriptors.NumHDonors(mol),
                    'NumHAcceptors': Descriptors.NumHAcceptors(mol),
                    'TPSA': Descriptors.TPSA(mol),
                    'NumRotatableBonds': Descriptors.NumRotatableBonds(mol),
                    'NumAromaticRings': Descriptors.NumAromaticRings(mol),
                    'NumSaturatedRings': Descriptors.NumSaturatedRings(mol),
                    'NumAliphaticRings': Descriptors.NumAliphaticRings(mol),
                    'RingCount': Descriptors.RingCount(mol),
                    'NumHeteroatoms': Descriptors.NumHeteroatoms(mol),
                    'BertzCT': Descriptors.BertzCT(mol),
                    'Chi0v': Descriptors.Chi0v(mol),
                    'Chi1v': Descriptors.Chi1v(mol),
                    'Chi2v': Descriptors.Chi2v(mol),
                    'Chi3v': Descriptors.Chi3v(mol),
                    'Chi4v': Descriptors.Chi4v(mol),
                    'Kappa1': Descriptors.Kappa1(mol),
                    'Kappa2': Descriptors.Kappa2(mol),
                    'Kappa3': Descriptors.Kappa3(mol)
                }

                logging.info(f"Features calculated: {list(features.keys())}")
                return np.array(list(features.values())).reshape(1, -1)

            except Exception as e:
                logging.error(f"Error calculating descriptors: {str(e)}")
                return None

        except Exception as e:
            logging.error(f"Error processing SMILES {smiles}: {str(e)}")
            return None

    def train_mock_model(self):
        """Train a mock model with synthetic data for demonstration"""
        # Generate synthetic training data
        np.random.seed(42)
        n_samples = 1000

        # Mock molecular descriptors (20 features)
        X = np.random.randn(n_samples, 20)  # 20 features as defined above
        # Mock sensitivity scores (IC50 values, lower = more sensitive)
        y = np.random.lognormal(mean=1, sigma=1, size=n_samples)

        # Train scaler and model
        self.scaler = StandardScaler()
        X_scaled = self.scaler.fit_transform(X)

        self.model = RandomForestRegressor(n_estimators=100, random_state=42)
        self.model.fit(X_scaled, y)

        self.feature_names = [
            'MolWt', 'LogP', 'NumHDonors', 'NumHAcceptors', 'TPSA',
            'NumRotatableBonds', 'NumAromaticRings', 'NumSaturatedRings',
            'NumAliphaticRings', 'RingCount', 'NumHeteroatoms',
            'BertzCT', 'Chi0v', 'Chi1v', 'Chi2v', 'Chi3v', 'Chi4v',
            'Kappa1', 'Kappa2', 'Kappa3'
        ]

        self.is_trained = True
        logging.info("Mock model trained successfully")

    def predict_sensitivity(self, smiles):
        """Predict drug sensitivity for given SMILES"""
        if not self.is_trained:
            return None, "Model not trained"

        if not RDKIT_AVAILABLE:
            return None, "RDKit library not available"

        features = self.smiles_to_features(smiles)
        if features is None:
            return None, f"Invalid SMILES string: {smiles}. Please check the SMILES format."

        if features.shape[1] != 20:
            logging.error(f"Feature vector shape mismatch: got {features.shape[1]} features, expected 20")
            return None, "Internal error: feature vector shape mismatch."

        try:
            features_scaled = self.scaler.transform(features)
            prediction = self.model.predict(features_scaled)[0]

            # Convert to sensitivity score (lower IC50 = higher sensitivity)
            sensitivity_score = 1 / (1 + prediction)

            return {
                'ic50_prediction': float(prediction),
                'sensitivity_score': float(sensitivity_score),
                'sensitivity_category': self._categorize_sensitivity(sensitivity_score)
            }, None

        except Exception as e:
            logging.error(f"Prediction error: {str(e)}")
            return None, f"Prediction error: {str(e)}"

    def _categorize_sensitivity(self, score):
        """Categorize sensitivity based on score"""
        if score > 0.7:
            return "High Sensitivity"
        elif score > 0.4:
            return "Moderate Sensitivity"
        else:
            return "Low Sensitivity"

# Initialize predictor
predictor = DrugSensitivityPredictor()
predictor.train_mock_model()

@app.route('/', methods=['GET'])
def home():
    """API documentation endpoint"""
    return jsonify({
        "service": "Glioblastoma Drug Sensitivity Predictor",
        "version": "1.0.0",
        "description": "Predict drug sensitivity in glioblastoma using SMILES notation",
        "rdkit_available": RDKIT_AVAILABLE,
        "endpoints": {
            "/predict": {
                "method": "POST",
                "description": "Predict drug sensitivity for a given SMILES string",
                "parameters": {
                    "smiles": "SMILES notation of the drug molecule"
                }
            },
            "/batch_predict": {
                "method": "POST", 
                "description": "Predict drug sensitivity for multiple SMILES",
                "parameters": {
                    "smiles_list": "List of SMILES strings"
                }
            },
            "/health": {
                "method": "GET",
                "description": "Health check endpoint"
            },
            "/test_smiles": {
                "method": "POST",
                "description": "Test if a SMILES string is valid",
                "parameters": {
                    "smiles": "SMILES notation to validate"
                }
            }
        },
        "sample_smiles": [
            "CCO",
            "CC(=O)O",
            "c1ccccc1",
            "CN1C=NC2=C1C(=O)N(C(=O)N2C)C"
        ]
    })

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "model_trained": predictor.is_trained,
        "rdkit_available": RDKIT_AVAILABLE,
        "timestamp": pd.Timestamp.now().isoformat()
    })

@app.route('/test_smiles', methods=['POST'])
def test_smiles():
    """Test if a SMILES string is valid"""
    try:
        data = request.get_json()

        if not data or 'smiles' not in data:
            return jsonify({
                "error": "Missing 'smiles' parameter in request body"
            }), 400

        smiles = data['smiles']

        if not RDKIT_AVAILABLE:
            return jsonify({
                "error": "RDKit library not available",
                "smiles": smiles,
                "valid": False
            }), 500

        try:
            mol = Chem.MolFromSmiles(smiles)
            if mol is None:
                return jsonify({
                    "smiles": smiles,
                    "valid": False,
                    "error": "Invalid SMILES format"
                })
            else:
                return jsonify({
                    "smiles": smiles,
                    "valid": True,
                    "molecular_formula": Chem.rdMolDescriptors.CalcMolFormula(mol),
                    "molecular_weight": Descriptors.MolWt(mol)
                })
        except Exception as e:
            return jsonify({
                "smiles": smiles,
                "valid": False,
                "error": str(e)
            })

    except Exception as e:
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

@app.route('/predict', methods=['POST'])
def predict():
    """Predict drug sensitivity for a single SMILES string"""
    try:
        data = request.get_json()

        if not data or 'smiles' not in data:
            return jsonify({
                "error": "Missing 'smiles' parameter in request body"
            }), 400

        smiles = data['smiles']

        if not isinstance(smiles, str) or not smiles.strip():
            return jsonify({
                "error": "SMILES must be a non-empty string"
            }), 400

        prediction, error = predictor.predict_sensitivity(smiles)

        if error:
            return jsonify({"error": error}), 400

        return jsonify({
            "smiles": smiles,
            "prediction": prediction,
            "status": "success"
        })

    except Exception as e:
        logging.error(f"Prediction error: {str(e)}")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

@app.route('/batch_predict', methods=['POST'])
def batch_predict():
    """Predict drug sensitivity for multiple SMILES strings"""
    try:
        data = request.get_json()

        if not data or 'smiles_list' not in data:
            return jsonify({
                "error": "Missing 'smiles_list' parameter in request body"
            }), 400

        smiles_list = data['smiles_list']

        if not isinstance(smiles_list, list):
            return jsonify({
                "error": "smiles_list must be a list"
            }), 400

        if len(smiles_list) > 100:  # Limit batch size
            return jsonify({
                "error": "Batch size limited to 100 SMILES"
            }), 400

        results = []

        for i, smiles in enumerate(smiles_list):
            if not isinstance(smiles, str) or not smiles.strip():
                results.append({
                    "smiles": smiles,
                    "error": "Invalid SMILES string",
                    "index": i
                })
                continue

            prediction, error = predictor.predict_sensitivity(smiles)

            if error:
                results.append({
                    "smiles": smiles,
                    "error": error,
                    "index": i
                })
            else:
                results.append({
                    "smiles": smiles,
                    "prediction": prediction,
                    "index": i,
                    "status": "success"
                })

        return jsonify({
            "results": results,
            "total_processed": len(smiles_list)
        })

    except Exception as e:
        logging.error(f"Batch prediction error: {str(e)}")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

if __name__ == '__main__':
    # SSL Certificate file paths - update these to match your certificate files
    cert_file = 'chemtest_tech_fullchain.crt'
    key_file = 'chemtest_tech_private.key'
    
    # Alternative certificate file names (in case you use different names)
    alt_cert_file = 'chemtest_tech.crt'
    alt_key_file = 'chemtest_tech_private.key'
    
    # Check for the full chain certificate first
    if os.path.exists(cert_file) and os.path.exists(key_file):
        print(f"Found SSL certificates: {cert_file} and {key_file}")
        try:
            # Create SSL context
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert_file, key_file)
            
            print("Starting Flask app with HTTPS on port 5000...")
            print("Server will be accessible at:")
            print("- https://chemtest.tech:5000")
            print("- https://152.42.134.22:5000")
            
            app.run(
                host='0.0.0.0', 
                port=5000, 
                debug=False, 
                ssl_context=context
            )
        except Exception as e:
            print(f"Error starting HTTPS server: {e}")
            print("Falling back to HTTP...")
            app.run(host='0.0.0.0', port=5000, debug=False)
            
    # Check for alternative certificate files
    elif os.path.exists(alt_cert_file) and os.path.exists(alt_key_file):
        print(f"Found SSL certificates: {alt_cert_file} and {alt_key_file}")
        print("Warning: Using certificate without CA bundle. You should create a full chain certificate.")
        try:
            # Create SSL context
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(alt_cert_file, alt_key_file)
            
            print("Starting Flask app with HTTPS on port 5000...")
            print("Server will be accessible at:")
            print("- https://chemtest.tech:5000")
            print("- https://152.42.134.22:5000")
            
            app.run(
                host='0.0.0.0', 
                port=5000, 
                debug=False, 
                ssl_context=context
            )
        except Exception as e:
            print(f"Error starting HTTPS server: {e}")
            print("Falling back to HTTP...")
            app.run(host='0.0.0.0', port=5000, debug=False)
    else:
        # Fallback to HTTP (for development)
        print("SSL certificates not found. Looking for:")
        print(f"- {cert_file} and {key_file}")
        print(f"- OR {alt_cert_file} and {alt_key_file}")
        print("Running on HTTP instead...")
        app.run(host='0.0.0.0', port=5000, debug=False)
