# SeinTinelle — Détection & Prédiction du Cancer du Sein par IA

## Overview
SeinTinelle is a web application combining **three AI models** across two complementary modules to assist in breast cancer detection and risk assessment:

- **Detection module**: two independent image-analysis models (mammography + ultrasound)
- **Prediction module**: a multimodal risk-prediction pipeline combining imaging and clinical data

Developed as part of the E3E project at ESIEE Paris (2025/2026).

> ⚠️ **Disclaimer**: This is a student research prototype. It is **not a certified medical device** and does not provide medical diagnosis. Always consult a healthcare professional.

## Tech Stack
- **Backend**: Flask, Flask-CORS
- **Deep Learning**: TensorFlow/Keras, PyTorch, Hugging Face Transformers, XGBoost
- **Frontend**: HTML, CSS, JavaScript, Chart.js
- **Third-party models**: mammo-crop & mammoscreen (Apache 2.0), AsymMirai (MIT License)

## Modules

### 1. Mammography Detection — MammoScreen
Uses the pretrained **MammoScreen** ensemble (3 CNNs, `tf_efficientnetv2_s` backbone) from Hugging Face, with **mammo-crop** for automatic image cropping.
- Input: DICOM or PNG mammography images (CC + MLO views)
- Reported performance (model authors, 3-split average): **AUC ≈ 0.945**; sensitivity 98.1% at 65.4% specificity, 94.3% sensitivity at 78.7% specificity
- Source: [ianpan/mammoscreen](https://huggingface.co/ianpan/mammoscreen), [ianpan/mammo-crop](https://huggingface.co/ianpan/mammo-crop) — Apache 2.0 License

### 2. Ultrasound Detection — DenseNet-121
Custom-trained model for breast ultrasound image classification (Benign / Malignant).
- **Dataset**: BreastMNIST (MedMNIST v2), derived from breast ultrasound images
- **Architecture**: DenseNet-121 (transfer learning from ImageNet), fine-tuning last 100 layers
- **Training**: Focal Loss (α=0.75, γ=2.0) + Label Smoothing, offline oversampling ×3, Test-Time Augmentation ×7, Grad-CAM explainability
- **Image size**: 224×224 px · **Split**: 70% train / 15% val / 15% test

**Results (test set, with TTA):**
| Metric | Value |
|---|---|
| Accuracy | 83.33% |
| AUC-ROC | 0.8801 |
| Precision | 82.84% |
| Recall | 97.37% |
| F1-Score | 89.52% |
| Optimal threshold | 0.50 |

### 3. Multimodal Risk Prediction — AsymMirai + Clinical Data
A late-fusion pipeline combining imaging and clinical risk factors:
- **Vision**: [AsymMirai](https://github.com/jdonnelly36/AsymMirai) (PyTorch) analyzes 4 mammographic views (L-CC, R-CC, L-MLO, R-MLO) to extract a 5-year risk score and asymmetry heatmaps. Developed by Jon Donnelly (Duke University), an explainable extension of MIT/Mass General Hospital's original **Mirai** model, trained on the EMBED dataset.
- **Fusion**: combines the imaging output with 4 clinical variables (age, BMI, family history, BI-RADS density) via an XGBoost model (heuristic fallback if untrained)
- License: MIT (see `Mirai/LICENSE`)

## Project Structure
