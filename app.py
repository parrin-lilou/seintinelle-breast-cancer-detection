# =====================================================================
#  SeinTinelle — app.py  (Backend Flask)
# =====================================================================

from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import io, time, os, sys, traceback, json
from PIL import Image

crop_model  = None
main_model  = None
models_ok   = False

RISK_THRESHOLD = 0.013
DENSITY_CLASSES = ["A", "B", "C", "D"]

# --- Config du modèle échographie (BreastMNIST / DenseNet-121) ---
echo_model      = None
echo_model_ok   = False

IMG_SIZE_ECHO = 224
MEAN_ECHO = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD_ECHO  = np.array([0.229, 0.224, 0.225], dtype=np.float32)
N_TTA_ECHO = 7
BEST_THRESH_ECHO = 0.735

# --- Config du modèle de prédiction multimodale (AsymMirai + clinique) ---
MIRAI_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Mirai")
sys.path.append(MIRAI_DIR)
sys.path.append(os.path.join(MIRAI_DIR, "asymmetry_model"))

asym_model      = None
asym_model_ok   = False

BIRADS_DENSITY_MAP = {"A": 0.0, "B": 1.0, "C": 2.0, "D": 3.0}
# 3 niveaux de risque :
#   score < RISK_SEUIL_MODERE      -> "faible"
#   RISK_SEUIL_MODERE <= score < RISK_SEUIL_ELEVE -> "modere"
#   score >= RISK_SEUIL_ELEVE      -> "eleve"
RISK_SEUIL_MODERE = 0.10   # 10%
RISK_SEUIL_ELEVE  = 0.35   # 35%
W_IMAGERIE = 0.50
W_CLINIQUE = 0.50

# Stats d'entraînement officielles de Mirai (img_mean / img_std sur PNG16, échelle 0-65535)
MIRAI_MEAN = 7047.99 / 65535.0
MIRAI_STD  = 12005.5 / 65535.0


def load_module_from_dir(dir_path, package_name):
    import importlib.util, sys, os

    for key in list(sys.modules.keys()):
        if key == package_name or key.startswith(package_name + "."):
            del sys.modules[key]

    spec = importlib.util.spec_from_file_location(
        package_name,
        os.path.join(dir_path, "__init__.py") if os.path.exists(os.path.join(dir_path, "__init__.py"))
        else os.path.join(dir_path, "modeling.py"),
        submodule_search_locations=[dir_path],
    )
    pkg = importlib.util.module_from_spec(spec)
    pkg.__path__ = [dir_path]
    pkg.__package__ = package_name
    sys.modules[package_name] = pkg

    for submod in ["configuration", "modeling"]:
        fpath = os.path.join(dir_path, f"{submod}.py")
        if not os.path.exists(fpath):
            continue
        sub_spec = importlib.util.spec_from_file_location(
            f"{package_name}.{submod}", fpath
        )
        sub_mod = importlib.util.module_from_spec(sub_spec)
        sub_mod.__package__ = package_name
        sys.modules[f"{package_name}.{submod}"] = sub_mod
        sub_spec.loader.exec_module(sub_mod)
        setattr(pkg, submod, sub_mod)

    return pkg


def load_models():
    global crop_model, main_model, models_ok
    try:
        import torch, os
        from huggingface_hub import snapshot_download
        from safetensors.torch import load_file

        print("⏳ Chargement de mammo-crop …")
        crop_dir = snapshot_download("ianpan/mammo-crop")
        crop_pkg = load_module_from_dir(crop_dir, "mammo_crop")
        MammoCropModel  = crop_pkg.modeling.MammoCropModel
        MammoCropConfig = crop_pkg.configuration.MammoCropConfig
        cfg = MammoCropConfig.from_pretrained(crop_dir)
        crop_model = MammoCropModel(cfg)
        state = load_file(os.path.join(crop_dir, "model.safetensors"))
        crop_model.load_state_dict(state, strict=False)
        crop_model.eval()
        print("✅ mammo-crop chargé.")

        print("⏳ Chargement de mammoscreen (~244 MB, patience) …")
        screen_dir = snapshot_download("ianpan/mammoscreen")
        screen_pkg = load_module_from_dir(screen_dir, "mammo_screen")

        import inspect
        config_mod = screen_pkg.configuration
        MammoScreenConfig = None
        for name, obj in inspect.getmembers(config_mod, inspect.isclass):
            if hasattr(obj, 'from_pretrained'):
                MammoScreenConfig = obj
                print(f"  → Config détectée : {name}")
                break

        MammoEnsemble = screen_pkg.modeling.MammoEnsemble
        cfg2 = MammoScreenConfig.from_pretrained(screen_dir) if MammoScreenConfig else None
        main_model = MammoEnsemble(cfg2) if cfg2 else MammoEnsemble()
        state2 = load_file(os.path.join(screen_dir, "model.safetensors"))
        main_model.load_state_dict(state2, strict=False)
        main_model.eval()
        print("✅ mammoscreen chargé.")
        models_ok = True

    except Exception as e:
        print(f"⚠️  Erreur chargement modèles : {e}")
        traceback.print_exc()
        models_ok = False


def load_echo_model():
    """Charge le modèle de détection échographie (DenseNet-121 / BreastMNIST, Keras)."""
    global echo_model, echo_model_ok
    try:
        import tensorflow as tf

        print("⏳ Chargement du modèle échographie (DenseNet-121) …")
        echo_model = tf.keras.models.load_model(
            "breast_cancer_densenet121_final.keras", compile=False
        )
        echo_model_ok = True
        print("✅ Modèle échographie chargé.")
    except Exception as e:
        print(f"⚠️  Erreur chargement modèle échographie : {e}")
        traceback.print_exc()
        echo_model_ok = False


def load_asym_model():
    """Charge le modèle AsymMirai (PyTorch) pour la prédiction multimodale."""
    global asym_model, asym_model_ok
    try:
        import torch

        weights_path = os.path.join(MIRAI_DIR, "snapshots", "trained_asymmirai.pt")
        print(f"⏳ Chargement d'AsymMirai depuis {weights_path} …")
        if not os.path.exists(weights_path):
            print(f"❌ Fichier introuvable : {weights_path}")
            asym_model_ok = False
            return
        asym_model = torch.load(weights_path, map_location="cpu", weights_only=False)
        asym_model.eval()
        asym_model_ok = True
        print("✅ Modèle AsymMirai chargé.")
    except Exception as e:
        print(f"⚠️  Erreur chargement AsymMirai : {e}")
        traceback.print_exc()
        asym_model_ok = False


load_models()
load_echo_model()
load_asym_model()

app = Flask(__name__)
CORS(app)


def read_image(file_bytes, filename=""):
    """Lit un fichier image et retourne un np.ndarray uint8 (H, W) en niveaux de gris."""
    fname = filename.lower()
    if fname.endswith(".dcm"):
        try:
            import pydicom
            from pydicom.pixels import apply_voi_lut
            ds  = pydicom.dcmread(io.BytesIO(file_bytes))
            arr = apply_voi_lut(ds.pixel_array, ds)
            if hasattr(ds, 'PhotometricInterpretation') and ds.PhotometricInterpretation == "MONOCHROME1":
                arr = arr.max() - arr
            arr = arr - arr.min()
            arr = arr / (arr.max() + 1e-8)
            arr = (arr * 255).astype(np.uint8)
            return arr  # (H, W) grayscale
        except ImportError:
            raise RuntimeError("pydicom non installé.")
    else:
        img = Image.open(io.BytesIO(file_bytes)).convert("L")  # grayscale
        return np.array(img)  # (H, W) uint8


def run_pipeline(images_np):
    """
    images_np : liste de np.ndarray (H, W) uint8
    Le modèle attend : liste de dicts {"cc": arr, "mlo": arr}
    ou un seul dict {"cc": arr}
    """
    import torch

    # ── Étape 1 : mammo-crop ─────────────────────────────────────
    # mammo-crop attend un tensor (1, 1, H, W)
    import torchvision.transforms.functional as TF

    cropped = []
    for i, arr in enumerate(images_np):
        try:
            pil_gray = Image.fromarray(arr)
            t = TF.to_tensor(pil_gray).unsqueeze(0)  # (1, 1, H, W)
            with torch.no_grad():
                result = crop_model(t)
            if isinstance(result, dict) and "image" in result:
                out = result["image"]
                if hasattr(out, "cpu"):
                    out_arr = out.squeeze().cpu().numpy()
                    if out_arr.max() <= 1.0:
                        out_arr = (out_arr * 255).clip(0, 255)
                    cropped.append(out_arr.astype(np.uint8))
                else:
                    cropped.append(arr)
            else:
                cropped.append(arr)
        except Exception as e:
            print(f"  ⚠️ mammo-crop ignoré pour image {i+1} : {e}")
            cropped.append(arr)

    # ── Étape 2 : mammoscreen ────────────────────────────────────
    # Le modèle attend une liste de dicts avec np.ndarray (H, W) uint8
    # Clés conventionnelles : "cc" pour vue face, "mlo" pour vue oblique
    VIEW_KEYS = ["cc", "mlo"]

    if len(cropped) == 1:
        # 1 seule image → un dict avec la clé "cc"
        sample = {"cc": cropped[0]}
    else:
        # 2 images → un dict avec "cc" et "mlo"
        sample = {VIEW_KEYS[i]: img for i, img in enumerate(cropped)}

    print(f"  → input mammoscreen : {list(sample.keys())} — shapes : {[v.shape for v in sample.values()]}")

    with torch.no_grad():
        output = main_model(sample, device="cpu")

    print(f"  → output mammoscreen : { {k: v for k, v in output.items()} }")

    # Clé "cancer" → score de risque (0–1)
    risk_raw    = output.get("cancer", None)
    density_raw = output.get("density", None)

    risk_score = float(risk_raw.cpu().mean()) if risk_raw is not None else 0.0

    if density_raw is not None:
        idx = int(density_raw.argmax(1).cpu().item() if density_raw.dim() > 1
                  else density_raw.argmax().cpu().item())
        density_label = DENSITY_CLASSES[min(idx, 3)]
    else:
        density_label = None

    return round(risk_score, 6), density_label


# =====================================================================
#  Prédiction multimodale (AsymMirai + données cliniques)
# =====================================================================

def encode_clinical_features(age, imc, antecedents_familiaux, densite_birads):
    age_norm    = np.clip((age - 30) / (80 - 30), 0.0, 1.0)
    imc_norm    = np.clip((imc - 15) / (45 - 15), 0.0, 1.0)
    atcd_enc    = 1.0 if antecedents_familiaux else 0.0
    densite_enc = BIRADS_DENSITY_MAP.get(str(densite_birads).upper(), 1.0) / 3.0
    return np.array([age_norm, imc_norm, atcd_enc, densite_enc], dtype=np.float32)


def remove_burned_in_labels(arr_uint8):
    from scipy import ndimage
    mask = arr_uint8 > 10
    labeled, num = ndimage.label(mask)
    if num == 0:
        h, w = arr_uint8.shape
        return arr_uint8, (0, h, 0, w)
    sizes = ndimage.sum(mask, labeled, range(1, num + 1))
    largest_label = np.argmax(sizes) + 1
    breast_mask = labeled == largest_label
    cleaned = arr_uint8.copy()
    cleaned[~breast_mask] = 0
    rows = np.any(breast_mask, axis=1)
    cols = np.any(breast_mask, axis=0)
    row_min, row_max = np.where(rows)[0][[0, -1]]
    col_min, col_max = np.where(cols)[0][[0, -1]]
    bbox = (int(row_min), int(row_max) + 1, int(col_min), int(col_max) + 1)
    return cleaned, bbox


def auto_orient_breast(arr_uint8):
    w = arr_uint8.shape[1]
    left_mass  = arr_uint8[:, :w // 2].astype(np.float32).sum()
    right_mass = arr_uint8[:, w // 2:].astype(np.float32).sum()
    flipped = left_mass > right_mass
    if flipped:
        arr_uint8 = np.fliplr(arr_uint8)
    return arr_uint8, flipped


def preprocess_rsna(img):
    """Reproduit le préprocessing officiel AsymMirai (résolution + normalisation natives)."""
    import torchvision.transforms as transforms

    img_gray = img.convert("L")
    arr = np.array(img_gray, dtype=np.float32)

    p1, p99 = np.percentile(arr, 1), np.percentile(arr, 99)
    arr_mask = np.clip((arr - p1) / (p99 - p1 + 1e-6), 0.0, 1.0)
    arr_mask_uint8 = (arr_mask * 255).astype(np.uint8)

    _, bbox = remove_burned_in_labels(arr_mask_uint8)
    r0, r1, c0, c1 = bbox

    arr_uint8_raw = np.clip(arr, 0, 255).astype(np.uint8)
    crop = arr_uint8_raw[r0:r1, c0:c1]
    crop, flipped = auto_orient_breast(crop)
    img_rgb = Image.fromarray(crop).convert("RGB")

    t = transforms.Compose([
        transforms.Resize((2048, 1664)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[MIRAI_MEAN] * 3, std=[MIRAI_STD] * 3),
    ])
    return t(img_rgb).unsqueeze(0), flipped, bbox


def get_asymmirai_risk_vector(model, img_lcc, img_rcc, img_lmlo, img_rmlo):
    import torch

    t_lcc,  flip_lcc,  bbox_lcc  = preprocess_rsna(img_lcc)
    t_rcc,  flip_rcc,  bbox_rcc  = preprocess_rsna(img_rcc)
    t_lmlo, flip_lmlo, bbox_lmlo = preprocess_rsna(img_lmlo)
    t_rmlo, flip_rmlo, bbox_rmlo = preprocess_rsna(img_rmlo)

    with torch.no_grad():
        result = model(t_lcc, t_rcc, t_lmlo, t_rmlo)

    if result is None or not isinstance(result, (tuple, list)) or len(result) < 2:
        raise ValueError(f"Sortie AsymMirai inattendue : {type(result)}")

    output, _other = result
    probs = output.detach().cpu().numpy().reshape(-1)
    risk_score = float(probs[1]) if len(probs) >= 2 else float(probs[0])
    return risk_score


def _baseline_risk_5y(age):
    return float(np.clip(0.003 + (age - 20) * 0.00045, 0.003, 0.035))


def _heuristic_clinical_score(age, imc, antecedents_familiaux, densite_birads):
    densite = str(densite_birads).upper()
    rr_densite = {"A": 0.7, "B": 1.0, "C": 1.4, "D": 2.1}.get(densite, 1.0)
    rr_atcd    = 1.8 if antecedents_familiaux else 1.0
    rr_imc     = 1.0 + 0.3 * np.clip((imc - 15) / (45 - 15), 0.0, 1.0)

    raw_score = _baseline_risk_5y(age) * rr_densite * rr_atcd * rr_imc
    return float(np.clip((raw_score - 0.0021) / (0.1474 - 0.0021), 0.0, 1.0))


def classify_risk_level(score):
    """Classe un score (0-1) en 3 niveaux de risque, selon les seuils globaux."""
    if score < RISK_SEUIL_MODERE:
        return "faible"
    elif score < RISK_SEUIL_ELEVE:
        return "modere"
    else:
        return "eleve"


def fuse_multimodal_risk(risk_score_img, age, imc, antecedents_familiaux, densite_birads, has_clinical=True):
    """
    Fusion pondérée image (50%) + clinique (50%).
    Si has_clinical=False (aucune donnée clinique réellement renseignée),
    le score final repose uniquement sur l'image — on n'invente pas de profil clinique moyen.
    """
    if not has_clinical:
        score_final = float(risk_score_img)
        score_cli = None
    else:
        score_cli = _heuristic_clinical_score(age, imc, antecedents_familiaux, densite_birads)
        score_final = W_IMAGERIE * risk_score_img + W_CLINIQUE * score_cli

    niveau = classify_risk_level(score_final)

    return {
        "score_final":    round(score_final, 4),
        "score_imagerie": round(float(risk_score_img), 4),
        "score_clinique": round(score_cli, 4) if score_cli is not None else None,
        "niveau_risque":  niveau,
    }


def project_risk_timeline(risk_5y, n_years=5, exponent=0.4):
    """
    Décompose un score de risque "à 5 ans" en courbe de risque cumulé année par année.
    Modèle en loi de puissance : risque(t) = risk_5y * (t / n_years) ** exponent
    exponent < 1 → courbe concave (le risque démarre relativement haut, puis ralentit),
    cohérent avec un risque cumulé épidémiologique typique.
    """
    timeline = []
    for t in range(1, n_years + 1):
        r = risk_5y * (t / n_years) ** exponent
        timeline.append({"year": t, "risk": round(float(r), 4)})
    return timeline


# =====================================================================
#  Détection échographie (BreastMNIST / DenseNet-121)
# =====================================================================

def normalize_imagenet_echo(img):
    """Normalise une image uint8 [0,255] vers float32 normalisé ImageNet."""
    return (img.astype(np.float32) / 255.0 - MEAN_ECHO) / STD_ECHO


def run_echo_pipeline(img_pil):
    """
    img_pil : image PIL (n'importe quel mode/taille)
    Retourne (proba_moyenne_TTA, proba_originale)
    """
    from tensorflow.keras.preprocessing.image import ImageDataGenerator

    tta_gen = ImageDataGenerator(
        horizontal_flip=True, rotation_range=10,
        zoom_range=0.05, width_shift_range=0.05,
        height_shift_range=0.05, fill_mode='reflect'
    )

    img_rgb   = img_pil.convert("RGB").resize((IMG_SIZE_ECHO, IMG_SIZE_ECHO), Image.LANCZOS)
    img_uint8 = np.array(img_rgb, dtype=np.uint8)
    img_norm  = normalize_imagenet_echo(img_uint8)[np.newaxis].astype(np.float32)

    probas = [float(echo_model.predict(img_norm, verbose=0)[0][0])]
    for _ in range(N_TTA_ECHO - 1):
        aug = tta_gen.flow(img_uint8[np.newaxis].astype(np.float32), batch_size=1).__next__()[0]
        aug = np.clip(aug, 0, 255).astype(np.uint8)
        aug_norm = normalize_imagenet_echo(aug)[np.newaxis].astype(np.float32)
        probas.append(float(echo_model.predict(aug_norm, verbose=0)[0][0]))

    proba_mean = float(np.mean(probas))
    proba_orig = probas[0]
    return proba_mean, proba_orig


@app.route("/detect_echo", methods=["POST"])
def detect_echo():
    t0 = time.time()

    if not echo_model_ok:
        return jsonify({"error": "Modèle échographie non chargé."}), 503

    if "image" not in request.files:
        return jsonify({"error": "Aucune image reçue."}), 400

    f = request.files["image"]
    try:
        img_pil = Image.open(io.BytesIO(f.read()))
    except Exception as e:
        return jsonify({"error": f"Erreur lecture image : {e}"}), 400

    try:
        proba_mean, proba_orig = run_echo_pipeline(img_pil)
    except Exception as e:
        tb = traceback.format_exc()
        print("=" * 60)
        print("ERREUR PIPELINE ÉCHOGRAPHIE :")
        print(tb)
        print("=" * 60)
        return jsonify({"error": f"{str(e)}\n\n{tb}"}), 500

    duration = round(time.time() - t0, 2)

    return jsonify({
        "risk_score":  round(proba_mean, 6),
        "risk_pct":    round(proba_mean * 100, 3),
        "risk_orig":   round(proba_orig, 6),
        "alert":       proba_mean >= BEST_THRESH_ECHO,
        "threshold":   BEST_THRESH_ECHO,
        "duration_s":  duration,
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":         "ok",
        "models_loaded":  models_ok,
        "crop_model":     crop_model is not None,
        "main_model":     main_model is not None,
        "threshold":      RISK_THRESHOLD,
        "echo_model_loaded": echo_model_ok,
        "echo_threshold":    BEST_THRESH_ECHO,
        "asym_model_loaded": asym_model_ok,
    })


@app.route("/detect", methods=["POST"])
def detect():
    t0 = time.time()

    if not models_ok:
        return jsonify({"error": "Modèles non chargés."}), 503

    images_np = []
    for field in ["image_1", "image_2"]:
        if field in request.files:
            f = request.files[field]
            try:
                arr = read_image(f.read(), f.filename)
                images_np.append(arr)
                print(f"  {field} chargée : shape={arr.shape}, dtype={arr.dtype}")
            except Exception as e:
                return jsonify({"error": f"Erreur lecture {field} : {e}"}), 400

    if not images_np:
        return jsonify({"error": "Aucune image reçue."}), 400

    try:
        risk_score, density = run_pipeline(images_np)
    except Exception as e:
        tb = traceback.format_exc()
        print("=" * 60)
        print("ERREUR PIPELINE :")
        print(tb)
        print("=" * 60)
        return jsonify({"error": f"{str(e)}\n\n{tb}"}), 500

    duration = round(time.time() - t0, 2)

    return jsonify({
        "risk_score": risk_score,
        "risk_pct":   round(risk_score * 100, 3),
        "alert":      risk_score >= RISK_THRESHOLD,
        "density":    density,
        "n_images":   len(images_np),
        "threshold":  RISK_THRESHOLD,
        "duration_s": duration,
    })


@app.route("/predict", methods=["POST"])
def predict():
    t0 = time.time()

    if not asym_model_ok:
        return jsonify({"error": "Modèle de prédiction (AsymMirai) non chargé."}), 503

    # --- Lecture des 4 vues mammographiques ---
    FIELD_MAP = {
        "image_l_cc":  "lcc",
        "image_r_cc":  "rcc",
        "image_l_mlo": "lmlo",
        "image_r_mlo": "rmlo",
    }
    images = {}
    for field, key in FIELD_MAP.items():
        if field in request.files:
            f = request.files[field]
            try:
                images[key] = Image.open(io.BytesIO(f.read()))
            except Exception as e:
                return jsonify({"error": f"Erreur lecture {field} : {e}"}), 400

    has_all_images = len(images) == 4

    # --- Lecture des données cliniques ---
    clinical_raw = request.form.get("clinical", "{}")
    try:
        clinical = json.loads(clinical_raw)
    except Exception:
        clinical = {}

    def _get(key, default=-1):
        v = clinical.get(key, default)
        return default if v is None else v

    age      = _get("age", -1)
    bmi      = _get("bmi", -1)
    density_num = _get("breast_density", -1)   # 1=A, 2=B, 3=C, 4=D côté front
    fam_hist    = _get("family_history_1st", -1)  # 0/1

    # Valeurs par défaut raisonnables si non renseignées (le modèle a besoin de nombres)
    age_val   = float(age) if age not in (-1, "", None) else 50.0
    bmi_val   = float(bmi) if bmi not in (-1, "", None) else 25.0
    fam_val   = bool(int(fam_hist)) if fam_hist not in (-1, "", None) else False
    density_letter_map = {1: "A", 2: "B", 3: "C", 4: "D"}
    density_letter = density_letter_map.get(int(density_num), "B") if density_num not in (-1, "", None) else "B"

    has_clinical = any(v not in (-1, "", None) for v in [age, bmi, density_num, fam_hist])

    if not has_all_images and not has_clinical:
        return jsonify({"error": "Aucune donnée reçue (ni images, ni données cliniques)."}), 400

    try:
        if has_all_images:
            risk_score_img = get_asymmirai_risk_vector(
                asym_model, images["lcc"], images["rcc"], images["lmlo"], images["rmlo"]
            )
            result = fuse_multimodal_risk(
                risk_score_img, age_val, bmi_val, fam_val, density_letter,
                has_clinical=has_clinical
            )
        else:
            # Pas d'imagerie complète → on s'appuie uniquement sur le score clinique
            score_cli = _heuristic_clinical_score(age_val, bmi_val, fam_val, density_letter)
            result = {
                "score_final":    round(score_cli, 4),
                "score_imagerie": None,
                "score_clinique": round(score_cli, 4),
                "niveau_risque":  classify_risk_level(score_cli),
            }

        timeline = project_risk_timeline(result["score_final"])

    except Exception as e:
        tb = traceback.format_exc()
        print("=" * 60)
        print("ERREUR PIPELINE PRÉDICTION :")
        print(tb)
        print("=" * 60)
        return jsonify({"error": f"{str(e)}\n\n{tb}"}), 500

    duration = round(time.time() - t0, 2)

    sources = []
    if has_all_images: sources.append("Imagerie")
    if has_clinical:    sources.append("Clinique")

    return jsonify({
        "probability":     result["score_final"],
        "risk_pct":        round(result["score_final"] * 100, 2),
        "score_imagerie":  result["score_imagerie"],
        "score_clinique":  result["score_clinique"],
        "niveau_risque":   result["niveau_risque"],
        "timeline":        timeline,
        "sources":         " + ".join(sources) if sources else "—",
        "model":           "AsymMirai + FedFusion v0.1",
        "duration_s":      duration,
    })


if __name__ == "__main__":
    print("=" * 55)
    print("  SeinTinelle — Backend Flask")
    print("  http://localhost:5001")
    print(f"  Seuil d'alerte (mammographie) : {RISK_THRESHOLD}")
    print(f"  Seuil d'alerte (échographie)  : {BEST_THRESH_ECHO}")
    print("=" * 55)
    app.run(debug=True, host="0.0.0.0", port=5001)
