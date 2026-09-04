// =============================================
//  consulter.js — Module "Consulter un médecin"
//  Géolocalisation + carte Google Maps (embed sans clé API)
// =============================================

const locateBtn  = document.getElementById('locateBtn');
const filterRow  = document.getElementById('filterRow');
const mapIdle    = document.getElementById('mapIdle');
const mapError   = document.getElementById('mapError');
const mapWrapper = document.getElementById('mapWrapper');
const mapFrame   = document.getElementById('mapFrame');
const manualLocateBtn     = document.getElementById('manualLocateBtn');
const manualLocationInput = document.getElementById('manualLocationInput');

let userLat = null;
let userLng = null;
let manualLocationQuery = null; // ville / code postal saisis manuellement, utilisé si pas de coordonnées GPS

// -----------------------------------------------
// Géolocalisation
// -----------------------------------------------
locateBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showState('error');
    return;
  }

  locateBtn.disabled = true;
  locateBtn.querySelector('span').textContent = 'Localisation en cours…';

  navigator.geolocation.getCurrentPosition(
    (position) => {
      userLat = position.coords.latitude;
      userLng = position.coords.longitude;
      manualLocationQuery = null;

      locateBtn.querySelector('span').textContent = 'Position trouvée';
      filterRow.classList.remove('hidden');

      const activeChip = filterRow.querySelector('.filter-chip.active');
      updateMap(activeChip.dataset.q);
      showState('map');
    },
    () => {
      locateBtn.disabled = false;
      locateBtn.querySelector('span').textContent = 'Me localiser';
      showState('error');
    },
    { enableHighAccuracy: false, timeout: 10000 }
  );
});

// -----------------------------------------------
// Recherche manuelle (ville / code postal)
// -----------------------------------------------
function runManualSearch() {
  const value = manualLocationInput.value.trim();
  if (!value) {
    manualLocationInput.focus();
    return;
  }

  manualLocationQuery = value;
  userLat = null;
  userLng = null;

  filterRow.classList.remove('hidden');
  const activeChip = filterRow.querySelector('.filter-chip.active');
  updateMap(activeChip.dataset.q);
  showState('map');
}

manualLocateBtn.addEventListener('click', runManualSearch);
manualLocationInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runManualSearch();
  }
});

// -----------------------------------------------
// Filtres de catégorie
// -----------------------------------------------
filterRow.addEventListener('click', (e) => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;

  filterRow.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  chip.classList.add('active');

  if ((userLat !== null && userLng !== null) || manualLocationQuery) {
    updateMap(chip.dataset.q);
  }
});

// -----------------------------------------------
// Mise à jour de la carte
// -----------------------------------------------
function updateMap(query) {
  const openMapsLink = document.getElementById('openMapsLink');

  if (userLat !== null && userLng !== null) {
    // Mode géolocalisation : centrage précis sur les coordonnées GPS
    const q = encodeURIComponent(query);
    mapFrame.src = `https://maps.google.com/maps?q=${q}&ll=${userLat},${userLng}&z=14&output=embed`;
    openMapsLink.href = `https://www.google.com/maps/search/${q}/@${userLat},${userLng},14z`;
  } else if (manualLocationQuery) {
    // Mode recherche manuelle : on laisse Google géocoder "catégorie + ville/code postal"
    const q = encodeURIComponent(`${query} ${manualLocationQuery}`);
    mapFrame.src = `https://maps.google.com/maps?q=${q}&output=embed`;
    openMapsLink.href = `https://www.google.com/maps/search/${q}`;
  }
}

// -----------------------------------------------
// Gestion des états d'affichage
// -----------------------------------------------
function showState(state) {
  mapIdle.classList.add('hidden');
  mapError.classList.add('hidden');
  mapWrapper.classList.add('hidden');

  if (state === 'idle')  mapIdle.classList.remove('hidden');
  if (state === 'error') mapError.classList.remove('hidden');
  if (state === 'map')   mapWrapper.classList.remove('hidden');
}
