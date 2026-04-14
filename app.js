const EMOJIS = ['🍝','🌮','🍜','🥗','🍛','🍲','🥘','🍣','🧆','🥞','🍕','🍗','🥩','🍱','🥟','🍤','🫕','🥙','🌯','🥨'];
const STORAGE_KEY = 'recipe_box_v1';

firebase.initializeApp({
  apiKey: "AIzaSyDFnC2renqsMDlFE0Pt32JS7xuE4tf_w_k",
  authDomain: "recipebox-5d176.firebaseapp.com",
  databaseURL: "https://recipebox-5d176-default-rtdb.firebaseio.com",
  projectId: "recipebox-5d176",
  storageBucket: "recipebox-5d176.firebasestorage.app",
  messagingSenderId: "211643687144",
  appId: "1:211643687144:web:c3d1be06fe50cc054ae95d"
});
const recipesRef = firebase.database().ref('recipes');

let recipes    = [];
let activeFilter = 'all';
let editingId  = null;
let detailMode = 'view'; // 'view' | 'edit'

// ── Storage ───────────────────────────────────────────────────────────────────

function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    recipes = saved ? JSON.parse(saved) : [];
  } catch(e) { recipes = []; }
  render();
  recipesRef.once('value').then(snapshot => {
    const data = snapshot.val();
    if (data) {
      recipes = Object.values(data).sort((a, b) => b.createdAt - a.createdAt);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
      render();
    }
  }).catch(() => {});
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
}

// Write a single recipe to Firebase without touching any others
function syncRecipe(recipe) {
  save();
  recipesRef.child(String(recipe.id)).set(recipe).catch(() => {});
}

// Remove a single recipe from Firebase
function removeRecipe(id) {
  save();
  recipesRef.child(String(id)).remove().catch(() => {});
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sourceLabel(url) {
  if (!url) return null;
  if (url.includes('instagram.com') || url.includes('instagr.am')) return 'Instagram';
  if (url.includes('tiktok.com')) return 'TikTok';
  return 'Link';
}

function randomEmoji() {
  return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || u.protocol === 'http:') return url;
  } catch {}
  return null;
}

// ── Link Metadata (Microlink) ─────────────────────────────────────────────────

async function fetchLinkMeta(url) {
  try {
    const res = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const { data } = await res.json();
    return {
      title:  data.title  || '',
      imgSrc: safeUrl(data.image?.url) || null
    };
  } catch { return null; }
}

// ── Add Recipe ────────────────────────────────────────────────────────────────

async function saveFromLink() {
  const input = document.getElementById('url-input');
  const url   = input.value.trim();
  if (!url) return;

  const btn = document.getElementById('save-link-btn');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  const meta   = await fetchLinkMeta(url);
  const source = sourceLabel(url);

  const recipe = {
    id:          Date.now(),
    title:       meta?.title || (source ? `Recipe from ${source}` : 'New recipe'),
    url,
    source:      source || 'Link',
    emoji:       randomEmoji(),
    imgSrc:      meta?.imgSrc || null,
    status:      'want',
    notes:       '',
    createdAt:   Date.now(),
    ingredients: [],
    steps:       [],
    cookTime:    '',
    servings:    '',
    macros:      { calories: '', protein: '', carbs: '', fat: '' }
  };

  recipes.unshift(recipe);
  syncRecipe(recipe);
  input.value     = '';
  btn.textContent = 'Save';
  btn.disabled    = false;
  render();
  openDetail(recipe.id, 'edit');
}

function compressImage(dataUrl, maxSize, quality, callback) {
  const img = new Image();
  img.onload = () => {
    let { width, height } = img;
    if (width > height) {
      if (width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
    } else {
      if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(img, 0, 0, width, height);
    callback(canvas.toDataURL('image/jpeg', quality));
  };
  img.src = dataUrl;
}

function saveFromScreenshot(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    compressImage(e.target.result, 800, 0.75, (imgSrc) => {
      const recipe = {
        id:          Date.now(),
        title:       'Screenshot recipe',
        url:         null,
        source:      'Screenshot',
        emoji:       randomEmoji(),
        imgSrc,
        status:      'want',
        notes:       '',
        createdAt:   Date.now(),
        ingredients: [],
        steps:       [],
        cookTime:    '',
        servings:    '',
        macros:      { calories: '', protein: '', carbs: '', fat: '' }
      };
      recipes.unshift(recipe);
      syncRecipe(recipe);
      render();
      openDetail(recipe.id, 'edit');
    });
  };
  reader.readAsDataURL(file);
  input.value = '';
}

// ── Filter ────────────────────────────────────────────────────────────────────

function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  render();
}

// ── List Render ───────────────────────────────────────────────────────────────

function render() {
  const want  = recipes.filter(r => r.status === 'want').length;
  const tried = recipes.filter(r => r.status === 'tried').length;
  document.getElementById('stat-want').textContent  = `${want} to try`;
  document.getElementById('stat-tried').textContent = `${tried} tried`;

  const filtered = activeFilter === 'all'
    ? recipes
    : recipes.filter(r => r.status === activeFilter);

  const grid  = document.getElementById('recipe-grid');
  const empty = document.getElementById('empty-state');

  if (filtered.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    const msgs = {
      all:   ['No recipes yet.',            'Paste a link above to get started!'],
      want:  ['Nothing on your list yet.',  'Save a recipe and mark it as "want to try".'],
      tried: ['No tried recipes yet.',      'Mark a recipe as "tried it" to see it here.']
    };
    empty.querySelector('p').textContent        = msgs[activeFilter][0];
    empty.querySelector('.empty-sub').textContent = msgs[activeFilter][1];
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = filtered.map(r => `
    <div class="recipe-card" onclick="openDetail(${r.id})">
      <div class="card-thumb">
        ${r.imgSrc
          ? `<img src="${escapeHtml(r.imgSrc)}" alt="${escapeHtml(r.title)}" />`
          : r.emoji}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(r.title)}</div>
        <div class="card-meta">
          ${r.source   ? `<span class="card-source">${escapeHtml(r.source)}</span>` : ''}
          ${r.cookTime ? `<span class="card-source">${r.source ? ' · ' : ''}${escapeHtml(r.cookTime)}</span>` : ''}
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

// ── Detail Panel ──────────────────────────────────────────────────────────────

function openDetail(id, mode = 'view') {
  editingId  = id;
  detailMode = mode;
  renderDetail();
  document.getElementById('detail-overlay').classList.add('open');
  document.getElementById('detail-content').scrollTop = 0;
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
  editingId  = null;
  detailMode = 'view';
}

function toggleEditMode() {
  detailMode = detailMode === 'view' ? 'edit' : 'view';
  renderDetail();
  document.getElementById('detail-content').scrollTop = 0;
}

function renderDetail() {
  const r = recipes.find(r => r.id === editingId);
  if (!r) return;
  const toggle  = document.getElementById('btn-edit-toggle');
  const saveBtn = document.getElementById('btn-header-save');
  toggle.textContent = detailMode === 'view' ? 'Edit' : 'Cancel';
  toggle.classList.toggle('active', detailMode === 'edit');
  saveBtn.style.display = detailMode === 'edit' ? '' : 'none';
  document.getElementById('detail-content').innerHTML =
    detailMode === 'view' ? renderViewMode(r) : renderEditMode(r);
  if (detailMode === 'edit') updateStatusButtons(r.status);
}

function renderViewMode(r) {
  const hasMacros = r.macros && Object.values(r.macros).some(v => v);
  const hasIngr   = r.ingredients && r.ingredients.length > 0;
  const hasSteps  = r.steps && r.steps.length > 0;
  const link      = safeUrl(r.url);

  return `<div class="recipe-view">
    <div class="view-hero">
      <div class="hero-thumb">
        ${r.imgSrc
          ? `<img src="${escapeHtml(r.imgSrc)}" alt="${escapeHtml(r.title)}" />`
          : `<span>${r.emoji}</span>`}
      </div>
      <div class="hero-info">
        <h2 class="hero-title">${escapeHtml(r.title)}</h2>
        <span class="status-badge ${r.status}">${r.status === 'want' ? 'Want to try' : 'Tried it ✓'}</span>
      </div>
    </div>

    ${(r.cookTime || r.servings) ? `
    <div class="detail-meta-row">
      ${r.cookTime ? `<div class="meta-pill">⏱ ${escapeHtml(r.cookTime)}</div>` : ''}
      ${r.servings ? `<div class="meta-pill">🍽 ${escapeHtml(r.servings)}</div>` : ''}
    </div>` : ''}

    ${link ? `
    <a class="detail-source-link" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">
      Open on ${escapeHtml(r.source || 'link')} →
    </a>` : ''}

    <div class="recipe-section">
      <h3>Ingredients</h3>
      ${hasIngr
        ? `<ul class="ingredients-list">${r.ingredients.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
        : `<p class="section-empty" onclick="toggleEditMode()">Tap Edit to add ingredients</p>`}
    </div>

    <div class="recipe-section">
      <h3>Steps</h3>
      ${hasSteps
        ? `<ol class="steps-list">${r.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`
        : `<p class="section-empty" onclick="toggleEditMode()">Tap Edit to add steps</p>`}
    </div>

    ${hasMacros ? `
    <div class="recipe-section">
      <h3>Nutrition</h3>
      <div class="macros-grid">
        ${r.macros.calories ? `<div class="macro-cell"><strong>${escapeHtml(String(r.macros.calories))}</strong><span>Calories</span></div>` : ''}
        ${r.macros.protein  ? `<div class="macro-cell"><strong>${escapeHtml(String(r.macros.protein))}</strong><span>Protein</span></div>`  : ''}
        ${r.macros.carbs    ? `<div class="macro-cell"><strong>${escapeHtml(String(r.macros.carbs))}</strong><span>Carbs</span></div>`    : ''}
        ${r.macros.fat      ? `<div class="macro-cell"><strong>${escapeHtml(String(r.macros.fat))}</strong><span>Fat</span></div>`      : ''}
      </div>
    </div>` : ''}

    ${r.notes ? `
    <div class="recipe-section">
      <h3>Notes</h3>
      <p class="detail-notes">${escapeHtml(r.notes)}</p>
    </div>` : ''}

    <div class="detail-footer">
      <button class="btn-status-toggle${r.status === 'tried' ? ' is-tried' : ''}" onclick="toggleDetailStatus()">
        ${r.status === 'want' ? 'Mark as tried ✓' : 'Mark as want to try'}
      </button>
      <button class="btn-delete-sm" onclick="deleteRecipe()">Delete</button>
    </div>
  </div>`;
}

function renderEditMode(r) {
  return `<div class="edit-fields">
    <div class="edit-field">
      <label class="field-label">Title</label>
      <input type="text" id="edit-title" class="modal-input" value="${escapeHtml(r.title)}" />
    </div>
    <div class="edit-field">
      <label class="field-label">Source link</label>
      <input type="url" id="edit-url" class="modal-input" value="${escapeHtml(r.url || '')}" placeholder="https://..." />
    </div>
    <div class="edit-row-2">
      <div class="edit-field">
        <label class="field-label">Cook time</label>
        <input type="text" id="edit-cooktime" class="modal-input" value="${escapeHtml(r.cookTime || '')}" placeholder="e.g. 30 min" />
      </div>
      <div class="edit-field">
        <label class="field-label">Servings</label>
        <input type="text" id="edit-servings" class="modal-input" value="${escapeHtml(r.servings || '')}" placeholder="e.g. 4" />
      </div>
    </div>
    <div class="edit-field">
      <label class="field-label">Ingredients <span class="field-hint">one per line</span></label>
      <textarea id="edit-ingredients" class="modal-input edit-textarea">${escapeHtml((r.ingredients || []).join('\n'))}</textarea>
    </div>
    <div class="edit-field">
      <label class="field-label">Steps <span class="field-hint">one per line</span></label>
      <textarea id="edit-steps" class="modal-input edit-textarea">${escapeHtml((r.steps || []).join('\n'))}</textarea>
    </div>
    <div class="edit-field">
      <label class="field-label">Nutrition <span class="field-hint">optional</span></label>
      <div class="macros-inputs">
        <input type="text" id="edit-cal"     class="modal-input" placeholder="Calories" value="${escapeHtml(String(r.macros?.calories || ''))}" />
        <input type="text" id="edit-protein" class="modal-input" placeholder="Protein"  value="${escapeHtml(String(r.macros?.protein  || ''))}" />
        <input type="text" id="edit-carbs"   class="modal-input" placeholder="Carbs"    value="${escapeHtml(String(r.macros?.carbs    || ''))}" />
        <input type="text" id="edit-fat"     class="modal-input" placeholder="Fat"      value="${escapeHtml(String(r.macros?.fat      || ''))}" />
      </div>
    </div>
    <div class="edit-field">
      <label class="field-label">Notes</label>
      <textarea id="edit-notes" class="modal-input modal-textarea">${escapeHtml(r.notes || '')}</textarea>
    </div>
    <div class="edit-field">
      <label class="field-label">Status</label>
      <div class="modal-status">
        <button class="status-btn" id="btn-want"  onclick="setModalStatus('want')">Want to try</button>
        <button class="status-btn" id="btn-tried" onclick="setModalStatus('tried')">Tried it ✓</button>
      </div>
    </div>
    <div class="edit-actions">
      <button class="btn-delete" onclick="deleteRecipe()">Delete recipe</button>
    </div>
  </div>`;
}

// ── Detail Actions ────────────────────────────────────────────────────────────

function setModalStatus(status) {
  const r = recipes.find(r => r.id === editingId);
  if (r) { r.status = status; updateStatusButtons(status); }
}

function updateStatusButtons(status) {
  const bw = document.getElementById('btn-want');
  const bt = document.getElementById('btn-tried');
  if (!bw || !bt) return;
  bw.className = 'status-btn' + (status === 'want'  ? ' active-want'  : '');
  bt.className = 'status-btn' + (status === 'tried' ? ' active-tried' : '');
}

function saveEdit() {
  const r = recipes.find(r => r.id === editingId);
  if (!r) return;
  r.title       = document.getElementById('edit-title').value.trim() || r.title;
  r.url         = document.getElementById('edit-url').value.trim()   || null;
  r.cookTime    = document.getElementById('edit-cooktime').value.trim();
  r.servings    = document.getElementById('edit-servings').value.trim();
  r.ingredients = document.getElementById('edit-ingredients').value.split('\n').map(s => s.trim()).filter(Boolean);
  r.steps       = document.getElementById('edit-steps').value.split('\n').map(s => s.trim()).filter(Boolean);
  r.macros      = {
    calories: document.getElementById('edit-cal').value.trim(),
    protein:  document.getElementById('edit-protein').value.trim(),
    carbs:    document.getElementById('edit-carbs').value.trim(),
    fat:      document.getElementById('edit-fat').value.trim()
  };
  r.notes = document.getElementById('edit-notes').value.trim();
  if (r.url && !r.source) r.source = sourceLabel(r.url);
  syncRecipe(r);
  render();
  detailMode = 'view';
  renderDetail();
}

function toggleDetailStatus() {
  const r = recipes.find(r => r.id === editingId);
  if (!r) return;
  r.status = r.status === 'want' ? 'tried' : 'want';
  syncRecipe(r);
  render();
  renderDetail();
}

function deleteRecipe() {
  if (!editingId) return;
  const id = editingId;
  recipes = recipes.filter(r => r.id !== id);
  removeRecipe(id);
  render();
  closeDetail();
}

// ── Event Listeners ───────────────────────────────────────────────────────────

document.getElementById('url-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !document.getElementById('save-link-btn').disabled) saveFromLink();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDetail();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

load();
