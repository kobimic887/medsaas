# Glioblastoma predictor demo

Flask service for exercising a SMILES-to-prediction API. **The model is a Random
Forest trained on synthetic data at startup. Its outputs are demonstration data,
not validated drug-sensitivity predictions or clinical results.**

RDKit calculates molecular descriptors; the mock model returns
`ic50_prediction`, `sensitivity_score`, and `sensitivity_category`. The field names
do not establish meaningful biological values or units.

## Run locally

From the repository root, with Docker available:

```bash
docker build -t pyxis-glioblastoma services/glioblastoma-predictor
docker run --rm -p 127.0.0.1:5000:5000 pyxis-glioblastoma
```

The service has no built-in authentication. Keep direct access local or behind an
authenticated application proxy.

## API

| Method | Path | Input / result |
|---|---|---|
| GET | `/` | Service description and endpoint summary |
| GET | `/health` | Service status, `model_trained`, and `rdkit_available` |
| POST | `/test_smiles` | `{"smiles":"CCO"}` → validity and molecular properties |
| POST | `/predict` | `{"smiles":"CCO"}` → mock prediction |
| POST | `/batch_predict` | `{"smiles_list":["CCO","CCN"]}` → per-molecule results; maximum 100 entries |

```bash
curl --fail-with-body http://localhost:5000/predict \
  -H 'Content-Type: application/json' \
  -d '{"smiles":"CCO"}'
```

Check both `model_trained` and `rdkit_available` in the health response before
testing predictions. A healthy HTTP response alone does not confirm RDKit is
available.

## Manual smoke check

With the service running and `requests` available:

```bash
python services/glioblastoma-predictor/test_api.py
```

This script prints responses from the documentation, health, single-prediction,
and batch endpoints. It does not assert correctness; inspect the responses.
The API and model implementation are in [app.py](app.py).
