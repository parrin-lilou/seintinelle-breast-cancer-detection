// =============================================
//  prediction.js — Module Prédiction Multimodale
//  Appelle POST http://localhost:5001/predict
// =============================================

const BACKEND_URL = "http://localhost:5001";

const analyzeBtn    = document.getElementById('analyzeBtn');
const resetBtn      = document.getElementById('resetBtn');
const resultIdle    = document.getElementById('resultIdle');
const resultLoading = document.getElementById('resultLoading');
const resultOutput  = document.getElementById('resultOutput');
const resultScore   = document.getElementById('resultScore');
const resultBadge   = document.getElementById('resultBadge');
const progressFill  = document.getElementById('progressFill');
const metaSources   = document.getElementById('metaSources');
const metaDuration  = document.getElementById('metaDuration');

const dotClinical    = document.getElementById('dotClinical');
const dotImage       = document.getElementById('dotImage');
const statusClinical = document.getElementById('statusClinical');
const statusImage    = document.getElementById('statusImage');

// --- Champs cliniques (simplifiés : 4 features) ---
const CLINICAL_FIELDS = {
  age:                document.getElementById('age'),
  bmi:                document.getElementById('bmi'),
  breast_density:     document.getElementById('density'),
  family_history_1st: document.getElementById('familyHistory'),
};

// --- Fichiers des 4 vues mammographiques ---
const mammoFiles = {
  RCC:  null,
  RMLO: null,
  LCC:  null,
  LMLO: null,
};

// --- Libellés affichés pour chaque vue ---
const VIEW_LABELS = {
  RCC:  'Vue de face sein droit',
  RMLO: 'Vue oblique sein droit',
  LCC:  'Vue de face sein gauche',
  LMLO: 'Vue oblique sein gauche',
};

// -----------------------------------------------
// Validation clinique en temps réel
// -----------------------------------------------
Object.values(CLINICAL_FIELDS).forEach(el => {
  if (el) {
    el.addEventListener('change', onClinicalChange);
    el.addEventListener('input',  onClinicalChange);
  }
});

function isClinicalFilled() {
  return Object.values(CLINICAL_FIELDS).some(el => {
    if (!el) return false;
    return el.value.trim() !== '';
  });
}

function hasAnyImage() {
  return Object.values(mammoFiles).some(f => f !== null);
}

function updateAnalyzeButton() {
  const allImagesLoaded = Object.values(mammoFiles).every(f => f !== null);
  analyzeBtn.disabled = !(allImagesLoaded || isClinicalFilled());
}

function onClinicalChange() {
  if (isClinicalFilled()) {
    dotClinical.classList.replace('inactive', 'active');
    statusClinical.textContent = 'Renseignées';
  } else {
    dotClinical.classList.replace('active', 'inactive');
    statusClinical.textContent = 'Non renseignées';
  }
  updateAnalyzeButton();
  showResultState('idle');
  resetBtn.classList.add('hidden');
}

// -----------------------------------------------
// Upload des 4 vues mammographiques
// -----------------------------------------------
function setupMammoDropzone(viewKey) {
  const dz    = document.getElementById(`dropzone${viewKey}`);
  const input = document.getElementById(`fileInput${viewKey}`);
  const inner = document.getElementById(`dropzoneInner${viewKey}`);
  const browse = document.getElementById(`browseBtn${viewKey}`);

  if (!dz || !input) return; // sécurité si un id manque

  if (browse) {
    browse.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
  }
  input.addEventListener('change', (e) => { if (e.target.files[0]) handleMammoFile(e.target.files[0]); });

  dz.addEventListener('dragover',  (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', ()  => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handleMammoFile(f);
  });
  dz.addEventListener('click', (e) => { if (e.target !== browse) input.click(); });

  function handleMammoFile(file) {
    mammoFiles[viewKey] = file;

    // Au lieu d'afficher un aperçu image, on affiche un texte de confirmation
    if (inner) {
      inner.innerHTML = `<p class="dropzone-text" style="color: var(--accent);">${VIEW_LABELS[viewKey]} chargée !</p>`;
    }

    updateImageStatus();
  }
}

['RCC', 'RMLO', 'LCC', 'LMLO'].forEach(setupMammoDropzone);

function updateImageStatus() {
  const n = Object.values(mammoFiles).filter(f => f !== null).length;
  const allLoaded = n === 4;

  if (allLoaded) {
    dotImage.classList.replace('inactive', 'active');
  } else {
    dotImage.classList.replace('active', 'inactive');
  }

  statusImage.textContent = `${n} vue${n > 1 ? 's' : ''} chargée${n > 1 ? 's' : ''}`;

  updateAnalyzeButton();
  showResultState('idle');
  resetBtn.classList.add('hidden');
}

// -----------------------------------------------
// Collecte des données cliniques
// -----------------------------------------------
function collectClinical() {
  const out = {};
  for (const [key, el] of Object.entries(CLINICAL_FIELDS)) {
    if (!el) continue;
    const raw = parseFloat(el.value);
    out[key] = (el.value.trim() === '' || isNaN(raw)) ? -1 : raw;
  }
  return out;
}

// -----------------------------------------------
// Prédiction
// -----------------------------------------------
analyzeBtn.addEventListener('click', () => runPrediction());

async function runPrediction() {
  showResultState('loading');
  analyzeBtn.disabled = true;

  startPrevention(5000);

  const clinicalData = collectClinical();
  const formData = new FormData();

  if (mammoFiles.RCC)  formData.append('image_r_cc',  mammoFiles.RCC);
  if (mammoFiles.RMLO) formData.append('image_r_mlo', mammoFiles.RMLO);
  if (mammoFiles.LCC)  formData.append('image_l_cc',  mammoFiles.LCC);
  if (mammoFiles.LMLO) formData.append('image_l_mlo', mammoFiles.LMLO);

  formData.append('clinical', JSON.stringify(clinicalData));

  try {
    const res = await fetch(`${BACKEND_URL}/predict`, { method: 'POST', body: formData });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    closePrevention();
    displayResult(data);

  } catch (err) {
    closePrevention();
    console.error('Erreur prédiction :', err);
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
  const probability = data.probability;
  const pct = Math.round(probability * 100);
  resultScore.textContent = `${pct}%`;

  let badgeClass, fillClass, label;
  const niveau = data.niveau_risque;
  if (niveau === 'faible')          { badgeClass = 'badge-safe';   fillClass = 'fill-safe';   label = 'Risque faible'; }
  else if (niveau === 'modere')     { badgeClass = 'badge-warn';   fillClass = 'fill-warn';   label = 'Risque modéré'; }
  else                              { badgeClass = 'badge-danger'; fillClass = 'fill-danger'; label = 'Risque élevé'; }

  resultBadge.className   = `result-badge ${badgeClass}`;
  resultBadge.textContent = label;
  progressFill.className  = `progress-bar-fill ${fillClass}`;
  requestAnimationFrame(() => setTimeout(() => { progressFill.style.width = `${pct}%`; }, 50));

  metaSources.textContent  = data.sources    || '—';
  metaDuration.textContent = data.duration_s ? `${data.duration_s}s` : '—';

  if (data.timeline && Array.isArray(data.timeline)) {
    renderTimeline(data.timeline);
  }

  showResultState('output');
  resetBtn.classList.remove('hidden');
  analyzeBtn.disabled = false;
}

// -----------------------------------------------
// Timeline de risque (graphique + tableau)
// -----------------------------------------------
let _timelineChartInstance = null;

function renderTimeline(timeline) {
  const labels = timeline.map(t => `An ${t.year}`);
  const values = timeline.map(t => Math.round(t.risk * 1000) / 10); // % à 1 décimale

  // --- Tableau ---
  const tbody = document.getElementById('timelineTableBody');
  if (tbody) {
    tbody.innerHTML = timeline.map(t => `
      <tr style="border-bottom:1px solid var(--border-light);">
        <td style="padding:6px 4px;color:var(--text-primary);">À ${t.year} an${t.year > 1 ? 's' : ''}</td>
        <td style="padding:6px 4px;text-align:right;font-weight:600;color:var(--text-primary);">${(t.risk * 100).toFixed(1)}%</td>
      </tr>
    `).join('');
  }

  // --- Graphique (Chart.js) ---
  const canvas = document.getElementById('timelineChart');
  if (!canvas || typeof Chart === 'undefined') return;

  if (_timelineChartInstance) {
    _timelineChartInstance.destroy();
  }

  const barColors = values.map(v => {
    if (v < 15) return '#1a6b4a';        // safe
    if (v < 30) return '#a05c10';        // warn
    return '#b93232';                    // danger
  });

  _timelineChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Risque cumulé (%)',
        data: values,
        backgroundColor: barColors,
        borderRadius: 6,
        maxBarThickness: 48,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: { callback: (v) => `${v}%` },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

// -----------------------------------------------
// Erreur backend
// -----------------------------------------------
function showBackendError() {
  const box = document.getElementById('resultBox');
  box.innerHTML = `
    <div class="result-idle" style="color:var(--danger)">
      <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:40px;height:40px">
        <circle cx="24" cy="24" r="20" stroke="currentColor" stroke-width="1.5"/>
        <path d="M24 16v10M24 30v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <p style="font-weight:500">Serveur inaccessible</p>
      <p style="font-size:0.78rem;color:var(--text-muted);text-align:center;line-height:1.5">
        Lancez le backend Flask :<br>
        <code style="background:var(--surface-2);padding:2px 6px;border-radius:4px;font-size:0.85em">python app.py</code>
      </p>
    </div>`;
  analyzeBtn.disabled = false;
}

// -----------------------------------------------
// Reset
// -----------------------------------------------
resetBtn.addEventListener('click', () => {
  Object.values(CLINICAL_FIELDS).forEach(el => { if (el) el.value = ''; });

  ['RCC', 'RMLO', 'LCC', 'LMLO'].forEach((viewKey) => {
    mammoFiles[viewKey] = null;
    const input = document.getElementById(`fileInput${viewKey}`);
    const inner = document.getElementById(`dropzoneInner${viewKey}`);
    if (input) input.value = '';
    if (inner) {
      inner.innerHTML = `<p class="dropzone-text">${VIEW_LABELS[viewKey]}</p>`;
    }
  });

  dotClinical.classList.replace('active', 'inactive');
  dotImage.classList.replace('active', 'inactive');
  statusClinical.textContent = 'Non renseignées';
  statusImage.textContent    = 'Aucune image';
  analyzeBtn.disabled = true;
  resetBtn.classList.add('hidden');
  progressFill.style.width = '0%';
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
