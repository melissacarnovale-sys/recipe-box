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
  const data = {};
  recipes.forEach(r => { data[r.id] = r; });
  recipesRef.set(data).catch(() => {});
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

// ── Scraping ──────────────────────────────────────────────────────────────────

async function fetchViaProxy(url) {
  // Try allorigins first (returns JSON wrapper); fall back to corsproxy
  const proxies = [
    async () => {
      const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
      if (!res.ok) return null;
      const json = await res.json();
      return json.contents || null;
    },
    async () => {
      const res = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
      if (!res.ok) return null;
      return res.text();
    }
  ];
  for (const attempt of proxies) {
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 8000);
      const html = await attempt();
      clearTimeout(tid);
      if (html) return html;
    } catch {}
  }
  return null;
}

async function scrapeRecipe(url) {
  const isSocial = url.includes('instagram.com') || url.includes('instagr.am') || url.includes('tiktok.com');
  if (isSocial) return null;
  const html = await fetchViaProxy(url);
  return html ? parseSchemaOrg(html) : null;
}

function parseSchemaOrg(html) {
  // Try DOMParser first, then fall back to regex in case scripts are stripped
  const sources = [];

  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      sources.push(s.textContent);
    }
  } catch {}

  if (sources.length === 0) {
    // Regex fallback
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) sources.push(m[1]);
  }

  for (const src of sources) {
    try {
      const schema = findRecipeSchema(JSON.parse(src));
      if (schema) return extractRecipeData(schema);
    } catch {}
  }
  return null;
}

function findRecipeSchema(data) {
  if (!data) return null;
  if (Array.isArray(data)) {
    for (const item of data) { const f = findRecipeSchema(item); if (f) return f; }
  }
  const type = data['@type'];
  const isRecipe = type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
  if (isRecipe) return data;
  if (data['@graph']) return findRecipeSchema(data['@graph']);
  return null;
}

function parseISO8601Duration(str) {
  if (!str) return '';
  const m = str.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return str;
  const h = parseInt(m[1] || 0), min = parseInt(m[2] || 0);
  if (h && min) return `${h}h ${min} min`;
  if (h) return `${h}h`;
  if (min) return `${min} min`;
  return '';
}

function extractRecipeData(r) {
  const raw = r.recipeInstructions || [];
  const steps = (typeof raw === 'string'
    ? raw.split('\n')
    : raw.map(s => (typeof s === 'string' ? s : s.text || s.name || ''))
  ).map(s => s.trim()).filter(Boolean);

  const n = r.nutrition || {};
  const rawImg = r.image;
  const imgUrl = Array.isArray(rawImg) ? rawImg[0]
    : (rawImg && typeof rawImg === 'object' ? rawImg.url : rawImg);

  return {
    title:       r.name || '',
    ingredients: (r.recipeIngredient || []).map(s => s.trim()),
    steps,
    cookTime:    parseISO8601Duration(r.totalTime || r.cookTime || ''),
    servings:    r.recipeYield
                   ? String(Array.isArray(r.recipeYield) ? r.recipeYield[0] : r.recipeYield)
                   : '',
    macros: {
      calories: n.calories           || '',
      protein:  n.proteinContent     || '',
      carbs:    n.carbohydrateContent|| '',
      fat:      n.fatContent         || ''
    },
    imgSrc: safeUrl(typeof imgUrl === 'string' ? imgUrl : null)
  };
}

// ── Add Recipe ────────────────────────────────────────────────────────────────

async function saveFromLink() {
  const input = document.getElementById('url-input');
  const url   = input.value.trim();
  if (!url) return;

  const btn = document.getElementById('save-link-btn');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  const scraped = await scrapeRecipe(url);
  const source  = sourceLabel(url);

  const recipe = {
    id:          Date.now(),
    title:       scraped?.title       || (source ? `Recipe from ${source}` : 'New recipe'),
    url,
    source:      source || 'Link',
    emoji:       randomEmoji(),
    imgSrc:      scraped?.imgSrc      || null,
    status:      'want',
    notes:       '',
    createdAt:   Date.now(),
    ingredients: scraped?.ingredients || [],
    steps:       scraped?.steps       || [],
    cookTime:    scraped?.cookTime    || '',
    servings:    scraped?.servings    || '',
    macros:      scraped?.macros      || { calories: '', protein: '', carbs: '', fat: '' }
  };

  recipes.unshift(recipe);
  save();
  input.value      = '';
  btn.textContent  = 'Save';
  btn.disabled     = false;
  render();
  openDetail(recipe.id, scraped ? 'view' : 'edit');
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
      save();
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
  const toggle = document.getElementById('btn-edit-toggle');
  toggle.textContent = detailMode === 'view' ? 'Edit' : 'Cancel';
  toggle.classList.toggle('active', detailMode === 'edit');
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
      <button class="btn-delete" onclick="deleteRecipe()">Delete</button>
      <button class="btn-done"   onclick="saveEdit()">Save</button>
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
  save();
  render();
  detailMode = 'view';
  renderDetail();
}

function toggleDetailStatus() {
  const r = recipes.find(r => r.id === editingId);
  if (!r) return;
  r.status = r.status === 'want' ? 'tried' : 'want';
  save();
  render();
  renderDetail();
}

function deleteRecipe() {
  if (!editingId) return;
  recipes = recipes.filter(r => r.id !== editingId);
  save();
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
