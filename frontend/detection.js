// =============================================
//  detection.js — SeinTinelle
//  Pipeline : mammo-crop → mammoscreen
//  Support 1 ou 2 images, DICOM / PNG / JPEG
// =============================================

const BACKEND_URL  = "http://localhost:5001";
const RISK_THRESHOLD = 0.013;

// DOM
const analyzeBtn        = document.getElementById('analyzeBtn');
const resetBtn          = document.getElementById('resetBtn');
const resultIdle        = document.getElementById('resultIdle');
const resultLoading     = document.getElementById('resultLoading');
const resultOutput      = document.getElementById('resultOutput');
const resultScore       = document.getElementById('resultScore');
const resultBadge       = document.getElementById('resultBadge');
const progressFill      = document.getElementById('progressFill');
const metaViews         = document.getElementById('metaViews');
const metaDuration      = document.getElementById('metaDuration');
const loadingMsg        = document.getElementById('loadingMsg');
const densityRow        = document.getElementById('densityRow');
const densityBadges     = document.getElementById('densityBadges');
const singleViewWarning = document.getElementById('singleViewWarning');
const resultProbLabel   = document.getElementById('resultProbLabel');
const resultProbLabelEcho = document.getElementById('resultProbLabelEcho');


let file1 = null;
let file2 = null;

// -----------------------------------------------
// Setup dropzone générique
// -----------------------------------------------
function setupDropzone(num) {
  const dz         = document.getElementById(`dropzone${num}`);
  const input      = document.getElementById(`fileInput${num}`);
  const inner      = document.getElementById(`dropzoneInner${num}`);
  const preview    = document.getElementById(`preview${num}`);
  const dicomBadge = document.getElementById(`dicomPreview${num}`);
  const browse     = document.getElementById(`browseBtn${num}`);
  const fmtWarn    = document.getElementById(`formatWarning${num}`);

  browse.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
  input.addEventListener('change', (e) => { if (e.target.files[0]) handleFile(e.target.files[0], num); });

  dz.addEventListener('dragover',  (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f, num);
  });
  dz.addEventListener('click', (e) => { if (e.target !== browse) input.click(); });

  function handleFile(file, n) {
    const isDicom = file.name.toLowerCase().endsWith('.dcm');
    const isImage = file.type.startsWith('image/') || isDicom;
    if (!isImage && !isDicom) return;

    if (n === 1) file1 = file;
    if (n === 2) file2 = file;

    if (!isDicom) {
      fmtWarn.classList.remove('hidden');
    } else {
      fmtWarn.classList.add('hidden');
    }

    if (isDicom) {
      preview.classList.add('hidden');
      dicomBadge.classList.remove('hidden');
      inner.classList.add('hidden');
    } else {
      dicomBadge.classList.add('hidden');
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.classList.remove('hidden');
        inner.classList.add('hidden');
      };
      reader.readAsDataURL(file);
    }

    updateUI();
  }
}

setupDropzone(1);
setupDropzone(2);

// -----------------------------------------------
// UI state
// -----------------------------------------------
function updateUI() {
  analyzeBtn.disabled = !file1;

  if (file1 && !file2) {
    singleViewWarning.classList.remove('hidden');
  } else {
    singleViewWarning.classList.add('hidden');
  }

  showResultState('idle');
  resetBtn.classList.add('hidden');
}

// -----------------------------------------------
// Analyse
// -----------------------------------------------
analyzeBtn.addEventListener('click', () => { if (file1) runDetection(); });

async function runDetection() {
  showResultState('loading');
  analyzeBtn.disabled = true;

  // Durée estimée de l'analyse : 6 secondes (ajustez selon votre backend)
  startPrevention(6000);

  const messages = [
    "Vos images sont en cours d'analyse…",
    "Notre modèle examine chaque détail…",
    "Résultats bientôt disponibles…",
  ];
  let msgIdx = 0;
  loadingMsg.textContent = messages[0];
  const msgInterval = setInterval(() => {
    msgIdx = (msgIdx + 1) % messages.length;
    loadingMsg.textContent = messages[msgIdx];
  }, 1800);

  const formData = new FormData();
  formData.append('image_1', file1);
  if (file2) formData.append('image_2', file2);

  try {
    const res = await fetch(`${BACKEND_URL}/detect`, { method: 'POST', body: formData });
    clearInterval(msgInterval);

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    closePrevention();
    displayResult(data);

  } catch (err) {
    clearInterval(msgInterval);
    closePrevention();
    console.error('Erreur détection :', err);
    showResultState('idle');
    analyzeBtn.disabled = false;

    if (err.message.includes('fetch') || err.message.includes('Failed')) {
      showBackendError();
    } else {
      alert(`Erreur : ${err.message}`);
    }
  }
}

// -----------------------------------------------
// Affichage résultat
// -----------------------------------------------
function displayResult(data) {
  const risk    = data.risk_score;
  const alert   = data.alert;
  const density = data.density;
  const nViews  = data.n_images;
  const dur     = data.duration_s;

  resultScore.textContent = risk.toFixed(4);

  let badgeClass, fillClass, label, fillPct;

  if (alert) {
    badgeClass = 'badge-danger';
    fillClass  = 'fill-danger';
    label      = 'Alerte détectée';
    fillPct = Math.min(100, Math.round((risk / 0.3) * 100));
  } else {
    badgeClass = 'badge-safe';
    fillClass  = 'fill-safe';
    label      = 'Normal';
    fillPct = Math.min(100, Math.round((risk / RISK_THRESHOLD) * 40));
  }

  // --- Texte explicatif basé sur le seuil ---
  const ratio = (risk / RISK_THRESHOLD).toFixed(1);
if (alert) {
  resultProbLabel.innerHTML = `Score <strong>${ratio}×</strong> supérieur au seuil d'alerte`;
} else {
  resultProbLabel.innerHTML = `Score inférieur au seuil d'alerte`;
}
  resultBadge.className   = `result-badge ${badgeClass}`;
  resultBadge.textContent = label;
  progressFill.className  = `progress-bar-fill ${fillClass}`;
  requestAnimationFrame(() => setTimeout(() => { progressFill.style.width = `${fillPct}%`; }, 50));

  if (density) {
    densityRow.style.display = 'flex';
    densityBadges.querySelectorAll('.density-badge').forEach(b => {
      b.classList.toggle('density-active', b.dataset.d === density);
    });
  } else {
    densityRow.style.display = 'none';
  }

  metaViews.innerHTML = [file1, file2].filter(f => f).map(f => {
    return f.name.length > 18 ? f.name.slice(0, 15) + '…' : f.name;
  }).join('<br>');

  metaDuration.textContent = `${dur}s`;

  showResultState('output');
  resetBtn.classList.remove('hidden');
  analyzeBtn.disabled = false;
}

// -----------------------------------------------
// Erreur backend
// -----------------------------------------------
function showBackendError() {
  document.getElementById('resultBox').innerHTML = `
    <div class="result-idle" style="color:var(--danger)">
      <svg viewBox="0 0 48 48" fill="none" style="width:40px;height:40px">
        <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="1.5"/>
        <path d="M24 16v10M24 30v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p style="font-weight:500">Serveur inaccessible</p>
      <p style="font-size:0.78rem;color:var(--text-muted);text-align:center;line-height:1.6">
        Lancez le backend :<br>
        <code style="background:var(--surface-2);padding:2px 6px;border-radius:4px">python app.py</code><br><br>
        Premier lancement : téléchargement des modèles (~250 MB)
      </p>
    </div>`;
  analyzeBtn.disabled = false;
}

// -----------------------------------------------
// Reset
// -----------------------------------------------
resetBtn.addEventListener('click', () => {
  file1 = null; file2 = null;

  [1, 2].forEach(n => {
    document.getElementById(`fileInput${n}`).value = '';
    const preview = document.getElementById(`preview${n}`);
    preview.src = ''; preview.classList.add('hidden');
    document.getElementById(`dicomPreview${n}`).classList.add('hidden');
    document.getElementById(`dropzoneInner${n}`).classList.remove('hidden');
    document.getElementById(`formatWarning${n}`).classList.add('hidden');
  });

  singleViewWarning.classList.add('hidden');
  progressFill.style.width = '0%';
  densityRow.style.display = 'none';
  resetBtn.classList.add('hidden');
  analyzeBtn.disabled = true;
  showResultState('idle');
});

// -----------------------------------------------
// Helpers
// -----------------------------------------------
function showResultState(state) {
  resultIdle.classList.add('hidden');
  resultLoading.classList.add('hidden');
  resultOutput.classList.add('hidden');
  if (state === 'idle')    resultIdle.classList.remove('hidden');
  if (state === 'loading') resultLoading.classList.remove('hidden');
  if (state === 'output')  resultOutput.classList.remove('hidden');
}

// =============================================
//  ÉCHOGRAPHIE MAMMAIRE — une seule image (file3)
// =============================================

const RISK_THRESHOLD_ECHO = 0.735;

const analyzeBtnEcho    = document.getElementById('analyzeBtnEcho');
const resetBtnEcho      = document.getElementById('resetBtnEcho');
const resultIdleEcho    = document.getElementById('resultIdleEcho');
const resultLoadingEcho = document.getElementById('resultLoadingEcho');
const resultOutputEcho  = document.getElementById('resultOutputEcho');
const resultScoreEcho   = document.getElementById('resultScoreEcho');
const resultBadgeEcho   = document.getElementById('resultBadgeEcho');
const progressFillEcho  = document.getElementById('progressFillEcho');
const metaViewsEcho     = document.getElementById('metaViewsEcho');
const metaDurationEcho  = document.getElementById('metaDurationEcho');
const loadingMsgEcho    = document.getElementById('loadingMsgEcho');

let file3 = null;

function setupEchoDropzone() {
  const dz         = document.getElementById('dropzone3');
  const input      = document.getElementById('fileInput3');
  const inner      = document.getElementById('dropzoneInner3');
  const preview    = document.getElementById('preview3');
  const dicomBadge = document.getElementById('dicomPreview3');
  const browse     = document.getElementById('browseBtn3');
  const fmtWarn    = document.getElementById('formatWarning3');

  browse.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
  input.addEventListener('change', (e) => { if (e.target.files[0]) handleEchoFile(e.target.files[0]); });

  dz.addEventListener('dragover',  (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handleEchoFile(f);
  });
  dz.addEventListener('click', (e) => { if (e.target !== browse) input.click(); });

  function handleEchoFile(file) {
    const isDicom = file.name.toLowerCase().endsWith('.dcm');
    const isImage = file.type.startsWith('image/') || isDicom;
    if (!isImage && !isDicom) return;

    file3 = file;

    if (!isDicom) fmtWarn.classList.remove('hidden');
    else fmtWarn.classList.add('hidden');

    if (isDicom) {
      preview.classList.add('hidden');
      dicomBadge.classList.remove('hidden');
      inner.classList.add('hidden');
    } else {
      dicomBadge.classList.add('hidden');
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.classList.remove('hidden');
        inner.classList.add('hidden');
      };
      reader.readAsDataURL(file);
    }

    updateUIEcho();
  }
}

setupEchoDropzone();

function updateUIEcho() {
  analyzeBtnEcho.disabled = !file3;
  showResultStateEcho('idle');
  resetBtnEcho.classList.add('hidden');
}

// -----------------------------------------------
// Analyse échographie
// -----------------------------------------------
analyzeBtnEcho.addEventListener('click', () => { if (file3) runEchoDetection(); });

async function runEchoDetection() {
  showResultStateEcho('loading');
  analyzeBtnEcho.disabled = true;

  startPrevention(6000);

  const messages = [
    "Votre image est en cours d'analyse…",
    "Notre modèle examine chaque détail…",
    "Résultat bientôt disponible…",
  ];
  let msgIdx = 0;
  loadingMsgEcho.textContent = messages[0];
  const msgInterval = setInterval(() => {
    msgIdx = (msgIdx + 1) % messages.length;
    loadingMsgEcho.textContent = messages[msgIdx];
  }, 1800);

  const formData = new FormData();
  formData.append('image', file3);

  try {
    const res = await fetch(`${BACKEND_URL}/detect_echo`, { method: 'POST', body: formData });
    clearInterval(msgInterval);

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    closePrevention();
    displayEchoResult(data);

  } catch (err) {
    clearInterval(msgInterval);
    closePrevention();
    console.error('Erreur détection échographie :', err);
    showResultStateEcho('idle');
    analyzeBtnEcho.disabled = false;

    if (err.message.includes('fetch') || err.message.includes('Failed')) {
      showEchoBackendError();
    } else {
      alert(`Erreur : ${err.message}`);
    }
  }
}

// -----------------------------------------------
// Affichage résultat échographie
// -----------------------------------------------
function displayEchoResult(data) {
  const risk  = data.risk_score;
  const alert = data.alert;
  const dur   = data.duration_s;

  resultScoreEcho.textContent = risk.toFixed(4);

  let badgeClass, fillClass, label, fillPct;

  if (alert) {
    badgeClass = 'badge-danger';
    fillClass  = 'fill-danger';
    label      = 'Alerte détectée';
    fillPct = Math.min(100, Math.round(risk * 100));
  } else {
    badgeClass = 'badge-safe';
    fillClass  = 'fill-safe';
    label      = 'Normal';
    fillPct = Math.min(100, Math.round((risk / RISK_THRESHOLD_ECHO) * 40));
  }

  // --- Texte explicatif basé sur le seuil ---
  const ratioEcho = (risk / RISK_THRESHOLD_ECHO).toFixed(1);
  if (alert) {
    resultProbLabelEcho.innerHTML = `Score <strong>${ratioEcho}×</strong> supérieur au seuil d'alerte`;
  } else {
    resultProbLabelEcho.innerHTML = `Score nettement inférieur au seuil d'alerte`;
  }

  resultBadgeEcho.className   = `result-badge ${badgeClass}`;
  resultBadgeEcho.textContent = label;
  progressFillEcho.className  = `progress-bar-fill ${fillClass}`;
  requestAnimationFrame(() => setTimeout(() => { progressFillEcho.style.width = `${fillPct}%`; }, 50));

  metaViewsEcho.textContent = file3.name.length > 18
    ? file3.name.slice(0, 15) + '…'
    : file3.name;
  metaDurationEcho.textContent = `${dur}s`;

  showResultStateEcho('output');
  resetBtnEcho.classList.remove('hidden');
  analyzeBtnEcho.disabled = false;
}

function showEchoBackendError() {
  document.getElementById('resultBoxEcho').innerHTML = `
    <div class="result-idle" style="color:var(--danger)">
      <svg viewBox="0 0 48 48" fill="none" style="width:40px;height:40px">
        <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="1.5"/>
        <path d="M24 16v10M24 30v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p style="font-weight:500">Serveur inaccessible</p>
      <p style="font-size:0.78rem;color:var(--text-muted);text-align:center;line-height:1.6">
        Lancez le backend :<br>
        <code style="background:var(--surface-2);padding:2px 6px;border-radius:4px">python app.py</code>
      </p>
    </div>`;
  analyzeBtnEcho.disabled = false;
}

// -----------------------------------------------
// Reset échographie
// -----------------------------------------------
resetBtnEcho.addEventListener('click', () => {
  file3 = null;

  document.getElementById('fileInput3').value = '';
  const preview = document.getElementById('preview3');
  preview.src = ''; preview.classList.add('hidden');
  document.getElementById('dicomPreview3').classList.add('hidden');
  document.getElementById('dropzoneInner3').classList.remove('hidden');
  document.getElementById('formatWarning3').classList.add('hidden');

  progressFillEcho.style.width = '0%';
  resetBtnEcho.classList.add('hidden');
  analyzeBtnEcho.disabled = true;
  showResultStateEcho('idle');
});

function showResultStateEcho(state) {
  resultIdleEcho.classList.add('hidden');
  resultLoadingEcho.classList.add('hidden');
  resultOutputEcho.classList.add('hidden');
  if (state === 'idle')    resultIdleEcho.classList.remove('hidden');
  if (state === 'loading') resultLoadingEcho.classList.remove('hidden');
  if (state === 'output')  resultOutputEcho.classList.remove('hidden');
}