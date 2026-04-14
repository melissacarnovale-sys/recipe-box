const EMOJIS = ['🍝','🌮','🍜','🥗','🍛','🍲','🥘','🍣','🧆','🥞','🍕','🍗','🥩','🍱','🥟','🍤','🫕','🥙','🌯','🥨'];
const STORAGE_KEY = 'recipe_box_v1';

let recipes = [];
let activeFilter = 'all';
let editingId = null;

function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    recipes = saved ? JSON.parse(saved) : [];
  } catch(e) {
    recipes = [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
}

function sourceLabel(url) {
  if (!url) return null;
  if (url.includes('instagram.com') || url.includes('instagr.am')) return 'Instagram';
  if (url.includes('tiktok.com')) return 'TikTok';
  return 'Link';
}

function randomEmoji() {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

function saveFromLink() {
  const input = document.getElementById('url-input');
  const url = input.value.trim();
  if (!url) return;

  const source = sourceLabel(url);
  const recipe = {
    id: Date.now(),
    title: source ? `Recipe from ${source}` : 'New recipe',
    url,
    source,
    emoji: randomEmoji(),
    imgSrc: null,
    status: 'want',
    notes: '',
    createdAt: Date.now()
  };

  recipes.unshift(recipe);
  save();
  input.value = '';
  render();
  openModal(recipe.id);
}

function saveFromScreenshot(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const recipe = {
      id: Date.now(),
      title: 'Screenshot recipe',
      url: null,
      source: 'Screenshot',
      emoji: randomEmoji(),
      imgSrc: e.target.result,
      status: 'want',
      notes: '',
      createdAt: Date.now()
    };
    recipes.unshift(recipe);
    save();
    render();
    openModal(recipe.id);
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render();
}

function render() {
  const want = recipes.filter(r => r.status === 'want').length;
  const tried = recipes.filter(r => r.status === 'tried').length;
  document.getElementById('stat-want').textContent = `${want} to try`;
  document.getElementById('stat-tried').textContent = `${tried} tried`;

  const filtered = activeFilter === 'all'
    ? recipes
    : recipes.filter(r => r.status === activeFilter);

  const grid = document.getElementById('recipe-grid');
  const empty = document.getElementById('empty-state');

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    if (activeFilter === 'all') {
      empty.querySelector('p').textContent = 'No recipes yet.';
      empty.querySelector('.empty-sub').textContent = 'Paste a link above to get started!';
    } else if (activeFilter === 'want') {
      empty.querySelector('p').textContent = 'Nothing on your list yet.';
      empty.querySelector('.empty-sub').textContent = 'Save a recipe and mark it as "want to try".';
    } else {
      empty.querySelector('p').textContent = 'No tried recipes yet.';
      empty.querySelector('.empty-sub').textContent = 'Mark a recipe as "tried it" to see it here.';
    }
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = filtered.map(r => `
    <div class="recipe-card" onclick="openModal(${r.id})">
      <div class="card-thumb">
        ${r.imgSrc
          ? `<img src="${r.imgSrc}" alt="${escapeHtml(r.title)}" />`
          : r.emoji}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(r.title)}</div>
        <div class="card-meta">
          ${r.source ? `<span class="card-source">${r.source}</span>` : ''}
        </div>
      </div>
      <div class="card-right">
        <span class="status-badge ${r.status}">
          ${r.status === 'want' ? 'Want to try' : 'Tried it ✓'}
        </span>
      </div>
    </div>
  `).join('');
}

function openModal(id) {
  editingId = id;
  const r = recipes.find(r => r.id === id);
  if (!r) return;

  document.getElementById('modal-title').value = r.title;
  document.getElementById('modal-url').value = r.url || '';
  document.getElementById('modal-notes').value = r.notes || '';

  const modalBody = document.querySelector('.modal-body');
  let statusEl = document.getElementById('modal-status-row');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'modal-status-row';
    statusEl.innerHTML = `
      <label class="field-label">Status</label>
      <div class="modal-status">
        <button class="status-btn" id="btn-want" onclick="setModalStatus('want')">Want to try</button>
        <button class="status-btn" id="btn-tried" onclick="setModalStatus('tried')">Tried it ✓</button>
      </div>
    `;
    modalBody.appendChild(statusEl);
  }

  updateStatusButtons(r.status);

  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(() => document.getElementById('modal-title').focus(), 300);
}

function setModalStatus(status) {
  const r = recipes.find(r => r.id === editingId);
  if (r) {
    r.status = status;
    updateStatusButtons(status);
  }
}

function updateStatusButtons(status) {
  const btnWant = document.getElementById('btn-want');
  const btnTried = document.getElementById('btn-tried');
  if (!btnWant || !btnTried) return;
  btnWant.className = 'status-btn' + (status === 'want' ? ' active-want' : '');
  btnTried.className = 'status-btn' + (status === 'tried' ? ' active-tried' : '');
}

function saveModal() {
  const r = recipes.find(r => r.id === editingId);
  if (!r) return;

  r.title = document.getElementById('modal-title').value.trim() || r.title;
  r.url = document.getElementById('modal-url').value.trim() || null;
  r.notes = document.getElementById('modal-notes').value.trim();
  if (r.url && !r.source) r.source = sourceLabel(r.url);

  save();
  render();
  closeModal();
}

function deleteRecipe() {
  if (!editingId) return;
  recipes = recipes.filter(r => r.id !== editingId);
  save();
  render();
  closeModal();
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  document.getElementById('modal-overlay').classList.remove('open');
  editingId = null;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

document.getElementById('url-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveFromLink();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

load();
render();
