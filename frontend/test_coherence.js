// =============================================
//  test_coherence.js — Outil de test de cohérence
//  Fait varier un facteur clinique à la fois, images fixes
// =============================================

const BACKEND_URL = "http://localhost:5001";

const VIEWS = ["LCC", "RCC", "LMLO", "RMLO"];
const testFiles = { LCC: null, RCC: null, LMLO: null, RMLO: null };

const runTestBtn = document.getElementById('runTestBtn');
const runStatus  = document.getElementById('runStatus');
const factorRow  = document.getElementById('factorRow');
const resultsCard = document.getElementById('resultsCard');
const resultsTableBody = document.getElementById('resultsTableBody');
const coherenceVerdict = document.getElementById('coherenceVerdict');

let activeFactor = 'age';

// -----------------------------------------------
// Dropzones de référence (4 images fixes)
// -----------------------------------------------
VIEWS.forEach(view => {
  const dz    = document.getElementById(`dropzoneTest${view}`);
  const input = document.getElementById(`fileTest${view}`);
  const inner = document.getElementById(`innerTest${view}`);

  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(view, e.target.files[0], inner);
  });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(view, f, inner);
  });
});

function handleFile(view, file, inner) {
  testFiles[view] = file;
  inner.innerHTML = `<p class="dropzone-text" style="color:var(--accent);font-size:0.8rem;">${view} ✓</p>`;
  updateRunButton();
}

function updateRunButton() {
  const allLoaded = VIEWS.every(v => testFiles[v] !== null);
  runTestBtn.disabled = !allLoaded;
  runStatus.textContent = allLoaded
    ? "Prêt à lancer les 4 tests."
    : "Dépose les 4 images ci-dessus pour activer le test.";
}

// -----------------------------------------------
// Sélection du facteur à tester
// -----------------------------------------------
factorRow.addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  factorRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');
  activeFactor = chip.dataset.factor;
});

// -----------------------------------------------
// Valeurs testées par facteur (4 points, ordre croissant de risque attendu)
// -----------------------------------------------
const FACTOR_VALUES = {
  age:      [30, 45, 60, 75],
  bmi:      [20, 25, 32, 40],
  density:  [1, 2, 3, 4],          // A, B, C, D
  family:   [0, 0, 1, 1],          // Non, Non, Oui, Oui (binaire, dupliqué pour 4 points)
};

const FACTOR_LABELS = {
  age:     (v) => `${v} ans`,
  bmi:     (v) => `IMC ${v}`,
  density: (v) => ({1:'A', 2:'B', 3:'C', 4:'D'}[v]),
  family:  (v) => (v === 1 ? 'Oui' : 'Non'),
};

// -----------------------------------------------
// Lancement des 4 tests successifs
// -----------------------------------------------
runTestBtn.addEventListener('click', async () => {
  runTestBtn.disabled = true;
  runStatus.textContent = "Tests en cours… (peut prendre 30-60s pour les 4 appels)";
  resultsCard.classList.add('hidden');

  const fixedAge      = parseFloat(document.getElementById('fixedAge').value) || 50;
  const fixedBmi       = parseFloat(document.getElementById('fixedBmi').value) || 24;
  const fixedDensity  = parseInt(document.getElementById('fixedDensity').value) || 2;
  const fixedFamily   = parseInt(document.getElementById('fixedFamily').value) || 0;

  const values = FACTOR_VALUES[activeFactor];
  const results = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    runStatus.textContent = `Test ${i + 1}/4 en cours…`;

    let age = fixedAge, bmi = fixedBmi, density = fixedDensity, family = fixedFamily;
    if (activeFactor === 'age')     age = v;
    if (activeFactor === 'bmi')     bmi = v;
    if (activeFactor === 'density') density = v;
    if (activeFactor === 'family')  family = v;

    try {
      const data = await callPredict(age, bmi, density, family);
      results.push({
        label: FACTOR_LABELS[activeFactor](v),
        score_imagerie: data.score_imagerie,
        score_clinique: data.score_clinique,
        score_final: data.probability,
        niveau: data.niveau_risque,
      });
    } catch (err) {
      runStatus.textContent = `Erreur au test ${i + 1} : ${err.message}`;
      runTestBtn.disabled = false;
      return;
    }
  }

  runStatus.textContent = "Tests terminés.";
  runTestBtn.disabled = false;
  displayResults(results);
});

async function callPredict(age, bmi, density, family) {
  const formData = new FormData();
  formData.append('image_l_cc',  testFiles.LCC);
  formData.append('image_r_cc',  testFiles.RCC);
  formData.append('image_l_mlo', testFiles.LMLO);
  formData.append('image_r_mlo', testFiles.RMLO);
  formData.append('clinical', JSON.stringify({
    age: age, bmi: bmi, breast_density: density, family_history_1st: family,
  }));

  const res = await fetch(`${BACKEND_URL}/predict`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// -----------------------------------------------
// Affichage des résultats (tableau + graphique + verdict)
// -----------------------------------------------
let _chartInstance = null;

function displayResults(results) {
  resultsCard.classList.remove('hidden');

  // Tableau
  resultsTableBody.innerHTML = results.map(r => `
    <tr style="border-bottom:1px solid var(--border-light);">
      <td style="padding:8px 4px;">${r.label}</td>
      <td style="padding:8px 4px;text-align:right;">${r.score_imagerie !== null ? (r.score_imagerie*100).toFixed(1)+'%' : '—'}</td>
      <td style="padding:8px 4px;text-align:right;">${r.score_clinique !== null ? (r.score_clinique*100).toFixed(1)+'%' : '—'}</td>
      <td style="padding:8px 4px;text-align:right;font-weight:600;">${(r.score_final*100).toFixed(1)}%</td>
      <td style="padding:8px 4px;text-align:right;">${r.niveau}</td>
    </tr>
  `).join('');

  // Graphique
  const canvas = document.getElementById('coherenceChart');
  if (_chartInstance) _chartInstance.destroy();

  _chartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: results.map(r => r.label),
      datasets: [{
        label: 'Score final (%)',
        data: results.map(r => r.score_final * 100),
        borderColor: '#F45A9D',
        backgroundColor: 'rgba(244,90,157,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 5,
        pointBackgroundColor: '#F45A9D',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` } },
      },
    },
  });

  // Verdict de cohérence : la séquence est-elle monotone croissante ?
  const scores = results.map(r => r.score_final);
  let isMonotonic = true;
  for (let i = 1; i < scores.length; i++) {
    if (scores[i] < scores[i - 1] - 0.001) { isMonotonic = false; break; }
  }

  coherenceVerdict.innerHTML = isMonotonic
    ? `✅ Cohérent : le score augmente bien avec ce facteur de risque (${(scores[0]*100).toFixed(1)}% → ${(scores[scores.length-1]*100).toFixed(1)}%).`
    : `⚠️ Incohérence détectée : le score ne progresse pas de façon strictement croissante. Vérifie la formule de score clinique pour ce facteur.`;
}
