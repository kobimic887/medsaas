# Glioblastoma Drug Sensitivity Predictor

A Python-based Docker service that predicts drug sensitivity in glioblastoma using SMILES notation, accessible via RESTful web API.

## Features

- **SMILES-based prediction**: Input drug molecules as SMILES strings
- **Molecular descriptors**: Automatic calculation of relevant chemical features
- **Machine learning**: Random Forest model for sensitivity prediction
- **RESTful API**: Easy integration with web applications
- **Batch processing**: Handle multiple predictions efficiently
- **Docker containerized**: Easy deployment and scaling
- **Health monitoring**: Built-in health check endpoints

## Quick Start

### Using Docker

1. **Build the Docker image:**
```bash
docker build -t glioblastoma-predictor .
```

2. **Run the container:**
```bash
docker run -p 5000:5000 glioblastoma-predictor
```

### Using Docker Compose

```bash
docker-compose up -d
```

## API Endpoints

### GET `/`
Get API documentation and available endpoints.

### GET `/health`
Health check endpoint to verify service status.

### POST `/predict`
Predict drug sensitivity for a single SMILES string.

**Request:**
```json
{
  "smiles": "CN1C(=O)C2=C(N=CN2C)N(C1=O)C(=O)N"
}
```

**Response:**
```json
{
  "smiles": "CN1C(=O)C2=C(N=CN2C)N(C1=O)C(=O)N",
  "prediction": {
    "ic50_prediction": 2.345,
    "sensitivity_score": 0.299,
    "sensitivity_category": "Low Sensitivity"
  },
  "status": "success"
}
```

### POST `/batch_predict`
Predict drug sensitivity for multiple SMILES strings.

**Request:**
```json
{
  "smiles_list": [
    "CN1C(=O)C2=C(N=CN2C)N(C1=O)C(=O)N",
    "CC1=C(C=CC=C1)NC(=O)C2=CC=C(C=C2)CN3CCN(CC3)C"
  ]
}
```

## Testing

Run the test script to verify API functionality:

```bash
python test_api.py
```

## Example Usage

```python
import requests

# Single prediction
response = requests.post('http://localhost:5000/predict', 
                        json={'smiles': 'CN1C(=O)C2=C(N=CN2C)N(C1=O)C(=O)N'})
print(response.json())

# Batch prediction
smiles_list = ['SMILES1', 'SMILES2', 'SMILES3']
response = requests.post('http://localhost:5000/batch_predict', 
                        json={'smiles_list': smiles_list})
print(response.json())
```

## Model Information

This service uses a Random Forest regression model trained on molecular descriptors calculated from SMILES strings. The current implementation includes a mock model for demonstration purposes.

### Features Used:
- Molecular weight
- LogP (lipophilicity)
- Hydrogen bond donors/acceptors
- Topological polar surface area
- Rotatable bonds
- Ring counts and aromatic properties
- Molecular connectivity indices
- Kappa shape indices

### Output Interpretation:
- **IC50 Prediction**: Estimated IC50 value (μM)
- **Sensitivity Score**: Normalized score (0-1, higher = more sensitive)
- **Sensitivity Category**: High/Moderate/Low sensitivity classification

## Production Deployment

For production use:

1. **Replace the mock model** with a real trained model
2. **Add authentication** for API security
3. **Implement rate limiting** to prevent abuse
4. **Set up monitoring** and logging
5. **Use a production WSGI server** like Gunicorn

```bash
# Example production deployment
gunicorn --bind 0.0.0.0:5000 --workers 4 app:app
```

## Dependencies

- Flask: Web framework
- RDKit: Chemical informatics
- Scikit-learn: Machine learning
- Pandas/NumPy: Data manipulation
- Joblib: Model serialization

## License

This project is provided as-is for research and educational purposes.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Disclaimer

This is a demonstration service with a mock model. For clinical applications, proper validation with real glioblastoma cell line data and regulatory approval would be required.