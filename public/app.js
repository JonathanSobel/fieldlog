/* ════════════════════════════════════════════════
   FIELDLOG – SUPPLY TRACKER  |  app.js
════════════════════════════════════════════════ */

// ─── STATE ───────────────────────────────────────────────────────────────────

const state = {
  view:        'dashboard',
  allRequests: [],
  stats:       {},
  inventory:   [],
  activity:    [],
  visits:      0,
  filter:      'all',
  search:      '',
};

const OVERDUE_DAYS = 3;

const CATEGORY_ICONS = {
  Hygiene: '🧴', Clothing: '👕', Sweets: '🍫',
  Cigarettes: '🚬', Other: '📦',
};

const STATUS_META = {
  'New':                            { cls: 's-New',       badge: 'badge-New',      label: 'New' },
  'In Progress':                    { cls: 's-In-Progress', badge: 'badge-Progress', label: 'In Progress' },
  'In Stock – Waiting for Pickup':  { cls: 's-Pickup',    badge: 'badge-Pickup',   label: '📦 Pickup' },
  'Completed (Picked Up)':          { cls: 's-Completed', badge: 'badge-Done',     label: '✓ Done' },
  'Cancelled':                      { cls: 's-Cancelled', badge: 'badge-Cancel',   label: 'Cancelled' },
};

// ─── API ─────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (method === 'DELETE') {
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Delete failed');
    }
    return {};
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── DATA LOADING ─────────────────────────────────────────────────────────────

async function loadAll() {
  const [requests, stats, inventory, activityData, visitRes, versionRes] = await Promise.all([
    api('GET', '/api/requests'),
    api('GET', '/api/stats'),
    api('GET', '/api/inventory'),
    api('GET', '/api/activity'),
    api('POST', '/api/visits'),
    api('GET', '/api/version'),
  ]);
  state.allRequests = requests;
  state.stats = stats;
  state.inventory = inventory;
  state.activity = activityData;
  state.visits = visitRes.total;
  const av = document.getElementById('appVersion');
  if (av) av.textContent = 'v' + versionRes.version;
}

async function refreshRequests() {
  const [requests, stats, activityData] = await Promise.all([
    api('GET', '/api/requests'),
    api('GET', '/api/stats'),
    api('GET', '/api/activity'),
  ]);
  state.allRequests = requests;
  state.stats = stats;
  state.activity = activityData;
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isOverdue(req) {
  if (!['New', 'In Progress'].includes(req.status)) return false;
  const received = new Date(req.date_received + 'T00:00:00');
  return (Date.now() - received.getTime()) / 86_400_000 > OVERDUE_DAYS;
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysAgoLabel(dateStr) {
  if (!dateStr) return '';
  const diff = Math.floor((Date.now() - new Date(dateStr + 'T00:00:00').getTime()) / 86_400_000);
  if (isNaN(diff)) return '';
  if (diff === 0) return 'Today';
  if (diff === 1) return '1 day ago';
  return `${diff} days ago`;
}

function getFiltered() {
  return state.allRequests.filter(r => {
    if (state.filter === 'urgent') {
      if (!r.urgent || !['New', 'In Progress'].includes(r.status)) return false;
    } else if (state.filter !== 'all' && r.status !== state.filter) {
      return false;
    }
    if (state.search) {
      const q = state.search.toLowerCase();
      return (r.soldier_name || '').toLowerCase().includes(q) ||
             (r.unit || '').toLowerCase().includes(q) ||
             (r.items || '').toLowerCase().includes(q);
    }
    return true;
  });
}

// ─── RENDER: SHARED COMPONENTS ────────────────────────────────────────────────

function statusBadge(status) {
  const m = STATUS_META[status];
  if (!m) return `<span class="badge badge-Cancel">${esc(status)}</span>`;
  return `<span class="badge ${m.badge}">${m.label}</span>`;
}

function catBadge(cat) {
  if (!cat) return '';
  return cat.split(',').map(c => c.trim()).filter(Boolean).map(c =>
    `<span class="badge badge-cat">${CATEGORY_ICONS[c] || '📦'} ${esc(c)}</span>`
  ).join(' ');
}

function nextActionButtons(req) {
  const id = req.id;
  switch (req.status) {
    case 'New':
      return `
        <button class="btn btn-start"   onclick="setStatus(${id},'In Progress')">▶ Start</button>
        <button class="btn btn-cancel"  onclick="setStatus(${id},'Cancelled')">✕</button>`;
    case 'In Progress':
      return `
        <button class="btn btn-ready"   onclick="setStatus(${id},'In Stock \u2013 Waiting for Pickup')">📦 Mark Ready</button>
        <button class="btn btn-cancel"  onclick="setStatus(${id},'Cancelled')">✕</button>`;
    case 'In Stock – Waiting for Pickup':
      return `
        <button class="btn btn-done"    onclick="setStatus(${id},'Completed (Picked Up)')">✅ Collected</button>`;
    case 'Completed (Picked Up)':
      return `<span style="color:var(--s-done);font-size:12px;font-weight:700;">✓ Completed</span>`;
    case 'Cancelled':
      return `<button class="btn btn-reopen" onclick="setStatus(${id},'New')">↩ Reopen</button>`;
    default:
      return '';
  }
}

function renderReqCard(req) {
  const overdue      = isOverdue(req);
  const activeUrgent = req.urgent && ['New', 'In Progress'].includes(req.status);
  const meta         = STATUS_META[req.status] || {};
  let cls = meta.cls || '';
  if (overdue)      cls += ' overdue';
  if (activeUrgent) cls += ' urgent-req';

  return `
    <div class="req-card ${cls}" data-id="${req.id}">
      <div class="req-top">
        <div class="req-identity">
          <div class="soldier-name">${esc(req.soldier_name)}</div>
          <div class="unit-name">${esc(req.unit)}</div>
        </div>
        <div class="req-badges">
          ${activeUrgent ? '<span class="badge badge-urgent">⚡ URGENT</span>' : ''}
          ${overdue ? '<span class="badge badge-overdue">⚠ Overdue</span>' : ''}
          ${catBadge(req.category)}
        </div>
      </div>
      <div class="req-items">
        ${esc(req.items)}${req.quantity ? ` <span class="req-qty">× ${esc(req.quantity)}</span>` : ''}
      </div>
      <div class="req-meta">
        <span>📅 ${formatDate(req.date_received)}</span>
        <span>${daysAgoLabel(req.date_received)}</span>
        ${req.logged_by ? `<span>🖥️ ${esc(req.logged_by)}</span>` : ''}
        ${statusBadge(req.status)}
      </div>
      <div class="req-actions">
        ${nextActionButtons(req)}
        <button class="btn btn-ghost" onclick="openEdit(${req.id})" title="Edit">✏️</button>
        <button class="btn btn-ghost" onclick="deleteReq(${req.id})" title="Delete" style="color:var(--s-overdue)">🗑️</button>
      </div>
    </div>`;
}

// ─── ACTIVITY FEED ────────────────────────────────────────────────────────────

function timeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)    return 'just now';
  if (m < 60)   return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

function renderActivityEntry(entry) {
  let icon, desc;
  if (entry.action === 'created') {
    icon = '🆕';
    const filer = entry.logged_by || entry.soldier_name;
    desc = `<b>${esc(filer)}</b> submitted a new request`;
  } else {
    const toMeta = STATUS_META[entry.to_status] || {};
    icon = toMeta.badge === 'badge-Done'     ? '✅'
         : toMeta.badge === 'badge-Pickup'   ? '📦'
         : toMeta.badge === 'badge-Cancel'   ? '✕'
         : toMeta.badge === 'badge-Progress' ? '▶' : '🔄';
    desc = `<b>${esc(entry.soldier_name)}</b>: `
         + `<span class="act-status-from">${esc(entry.from_status)}</span>`
         + ` → ${esc(entry.to_status)}`;
  }
  return `
    <div class="activity-entry">
      <div class="act-icon">${icon}</div>
      <div class="act-body">
        <div class="act-desc">${desc} <span class="act-unit">${esc(entry.unit)}</span></div>
        <div class="act-time">${timeAgo(entry.created_at)}</div>
      </div>
    </div>`;
}

function renderActivityFeed() {
  if (!state.activity.length) return '';
  return `
    <div class="section-hdr" style="margin-top:28px">
      <span class="section-title">Recent Activity</span>
      <button class="btn btn-ghost" onclick="clearActivity()" style="font-size:12px;color:var(--s-overdue)">Clear all</button>
    </div>
    <div class="activity-feed">
      ${state.activity.slice(0, 10).map(renderActivityEntry).join('')}
    </div>`;
}

// ─── RENDER: DASHBOARD ────────────────────────────────────────────────────────

function renderDashboard() {
  const { stats } = state;
  const recent    = state.allRequests.slice(0, 6);

  const urgentBar = stats.urgent > 0 ? `
    <div class="overdue-banner" style="border-color:rgba(255,59,48,.2)">
      <span>⚡</span>
      <span>${stats.urgent} urgent request${stats.urgent > 1 ? 's' : ''} need${stats.urgent === 1 ? 's' : ''} immediate attention</span>
      <button class="btn btn-cancel ml-auto" onclick="goFiltered('urgent')" style="font-size:12px;padding:5px 10px;">View</button>
    </div>` : '';

  const overdueBar = stats.overdue > 0 ? `
    <div class="overdue-banner">
      <span>⚠️</span>
      <span>${stats.overdue} overdue request${stats.overdue > 1 ? 's' : ''} — older than ${OVERDUE_DAYS} days</span>
      <button class="btn btn-cancel ml-auto" onclick="goFiltered('New')" style="font-size:12px;padding:5px 10px;">View</button>
    </div>` : '';

  document.getElementById('view-dashboard').innerHTML = `
    <div class="page-title">Dashboard</div>

    ${urgentBar}
    ${overdueBar}

    <div class="stats-grid">
      <div class="stat-card sc-new"  onclick="goFiltered('New')">
        <div class="stat-num">${stats.new || 0}</div>
        <div class="stat-lbl">New</div>
      </div>
      <div class="stat-card sc-prog" onclick="goFiltered('In Progress')">
        <div class="stat-num">${stats.inProgress || 0}</div>
        <div class="stat-lbl">In Progress</div>
      </div>
      <div class="stat-card sc-pick" onclick="navigate('pickups')">
        <div class="stat-num">${stats.waitingPickup || 0}</div>
        <div class="stat-lbl">Waiting Pickup</div>
      </div>
      <div class="stat-card sc-done" onclick="goFiltered('Completed (Picked Up)')">
        <div class="stat-num">${stats.completed || 0}</div>
        <div class="stat-lbl">Completed</div>
      </div>
    </div>

    <div class="section-hdr">
      <span class="section-title">Recent Requests</span>
      <button class="btn btn-ghost" onclick="navigate('requests')" style="font-size:13px;">See all →</button>
    </div>
    ${recent.length === 0
      ? `<div class="empty"><div class="empty-icon">📋</div><p>No requests yet.<br>Tap <strong>+</strong> to add the first one.</p></div>`
      : recent.map(renderReqCard).join('')
    }
    ${renderActivityFeed()}`;
}

// ─── RENDER: REQUESTS ─────────────────────────────────────────────────────────

function renderRequests() {
  const filtered = getFiltered();

  const filterDefs = [
    { key: 'all',                              label: 'All' },
    { key: 'urgent',                           label: '⚡ Urgent' },
    { key: 'New',                              label: '🔵 New' },
    { key: 'In Progress',                      label: '▶ Progress' },
    { key: 'In Stock – Waiting for Pickup',    label: '📦 Pickup' },
    { key: 'Completed (Picked Up)',            label: '✅ Done' },
    { key: 'Cancelled',                        label: '✕ Cancelled' },
  ];

  document.getElementById('view-requests').innerHTML = `
    <div class="search-wrap">
      <input type="search" id="searchInput" placeholder="Search soldier, unit, items…"
             value="${esc(state.search)}" autocomplete="off">
    </div>
    <div class="filter-row">
      ${filterDefs.map(f => `
        <button class="ftab ${state.filter === f.key ? 'active' : ''}"
                onclick="setFilter('${esc(f.key)}')">${f.label}</button>
      `).join('')}
    </div>
    ${filtered.length === 0
      ? `<div class="empty"><div class="empty-icon">🔍</div><p>No matching requests.</p></div>`
      : filtered.map(renderReqCard).join('')
    }`;

  // Replace node to drop any accumulated listeners from previous renders
  const oldSi = document.getElementById('searchInput');
  if (oldSi) {
    const si = oldSi.cloneNode(true);
    oldSi.replaceWith(si);
    si.addEventListener('input', debounce(e => {
      state.search = e.target.value;
      renderRequestList();
    }, 250));
  }
}

function renderRequestList() {
  const filtered = getFiltered();
  const container = document.getElementById('view-requests');
  if (!container) return;
  // Remove old list items (everything after the filter-row)
  const filterRow = container.querySelector('.filter-row');
  if (!filterRow) return;
  // Remove all siblings after filterRow
  while (filterRow.nextSibling) filterRow.nextSibling.remove();
  // Append updated list
  const html = filtered.length === 0
    ? `<div class="empty"><div class="empty-icon">🔍</div><p>No matching requests.</p></div>`
    : filtered.map(renderReqCard).join('');
  filterRow.insertAdjacentHTML('afterend', html);
}

// ─── RENDER: PICKUPS ──────────────────────────────────────────────────────────

function renderPickups() {
  const pickups = state.allRequests.filter(r => r.status === 'In Stock – Waiting for Pickup');
  document.getElementById('view-pickups').innerHTML = `
    <div class="page-title">
      Waiting for Pickup
      <span class="badge badge-count badge-Pickup">${pickups.length}</span>
    </div>
    ${pickups.length === 0
      ? `<div class="empty"><div class="empty-icon">📦</div><p>Nothing waiting for pickup right now.</p></div>`
      : pickups.map(renderReqCard).join('')
    }`;
}

// ─── RENDER: INVENTORY ────────────────────────────────────────────────────────

function renderInventory() {
  const catOptions = ['Hygiene', 'Clothing', 'Sweets', 'Cigarettes', 'Other']
    .map(c => `<option value="${c}">${CATEGORY_ICONS[c]} ${c}</option>`).join('');

  document.getElementById('view-inventory').innerHTML = `
    <div class="page-title">Inventory</div>

    <div class="card">
      <div class="card-title">Add Item</div>
      <form id="invForm" onsubmit="submitInvForm(event)">
        <div class="form-row" style="margin-bottom:8px">
          <div class="form-group" style="flex:1;margin:0">
            <input type="text" id="invName" placeholder="Item name" required>
          </div>
          <div class="form-group" style="width:80px;margin:0">
            <input type="number" id="invQty" placeholder="Qty" min="0" value="0">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="flex:1;margin:0">
            <select id="invCat">${catOptions}</select>
          </div>
          <button type="submit" class="btn btn-primary">Add</button>
        </div>
      </form>
    </div>

    <div id="invList">
      ${state.inventory.length === 0
        ? `<div class="empty"><div class="empty-icon">🗃️</div><p>No inventory items yet.</p></div>`
        : state.inventory.map(renderInvItem).join('')
      }
    </div>`;
}

function renderInvItem(item) {
  const icon = CATEGORY_ICONS[item.category] || '📦';
  return `
    <div class="inv-item" data-inv="${item.id}">
      <div class="inv-info">
        <div class="inv-name">${esc(item.item_name)}</div>
        <div class="inv-cat">${icon} ${esc(item.category)}</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="adjustInv(${item.id},${item.quantity - 1})">−</button>
        <span class="qty-val ${item.quantity === 0 ? 'qty-zero' : ''}">${item.quantity}</span>
        <button class="qty-btn" onclick="adjustInv(${item.id},${item.quantity + 1})">+</button>
      </div>
      <button class="icon-btn" onclick="deleteInvItem(${item.id})" style="color:var(--s-overdue)" title="Delete">🗑️</button>
    </div>`;
}

// ─── RENDER CURRENT VIEW ──────────────────────────────────────────────────────

function renderView() {
  switch (state.view) {
    case 'dashboard': return renderDashboard();
    case 'requests':  return renderRequests();
    case 'pickups':   return renderPickups();
    case 'inventory': return renderInventory();
  }
}

// ─── NAVIGATION ───────────────────────────────────────────────────────────────

function navigate(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.id === `view-${view}`));
  renderView();
}

function goFiltered(status) {
  state.filter = status;
  state.search = '';
  navigate('requests');
}

// ─── ACTIONS: REQUESTS ────────────────────────────────────────────────────────

async function setStatus(id, status) {
  try {
    await api('PUT', `/api/requests/${id}`, { status });
    await refreshRequests();
    renderView();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteReq(id) {
  if (!confirm('Delete this request permanently?')) return;
  try {
    await api('DELETE', `/api/requests/${id}`);
    await refreshRequests();
    renderView();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ─── ACTIONS: ACTIVITY ────────────────────────────────────────────────────────

async function clearActivity() {
  if (!confirm('Clear all activity entries?')) return;
  try {
    await api('DELETE', '/api/activity');
    state.activity = [];
    renderView();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ─── ACTIONS: INVENTORY ───────────────────────────────────────────────────────

async function adjustInv(id, newQty) {
  if (newQty < 0) return;
  try {
    await api('PUT', `/api/inventory/${id}`, { quantity: newQty });
    state.inventory = await api('GET', '/api/inventory');
    renderView();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function deleteInvItem(id) {
  if (!confirm('Delete this inventory item?')) return;
  try {
    await api('DELETE', `/api/inventory/${id}`);
    state.inventory = await api('GET', '/api/inventory');
    renderView();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function submitInvForm(e) {
  e.preventDefault();
  const data = {
    item_name: document.getElementById('invName').value.trim(),
    quantity:  parseInt(document.getElementById('invQty').value) || 0,
    category:  document.getElementById('invCat').value,
  };
  try {
    await api('POST', '/api/inventory', data);
    state.inventory = await api('GET', '/api/inventory');
    renderInventory();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// ─── FILTERS ──────────────────────────────────────────────────────────────────

function setFilter(filter) {
  state.filter = filter;
  renderRequests();
}

// ─── MODAL ────────────────────────────────────────────────────────────────────

function openModal(req = null) {
  const modal = document.getElementById('modal');
  const form  = document.getElementById('requestForm');

  form.reset();
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected'));

  const urgentBtn = document.getElementById('urgentToggle');
  urgentBtn.classList.toggle('active', !!(req?.urgent));

  document.getElementById('modalTitle').textContent = req ? 'Edit Request' : 'New Request';
  const submitBtn = document.getElementById('formSubmitBtn');
  submitBtn.textContent = req ? 'Save Changes' : 'Save Request';
  submitBtn.disabled = false;
  document.getElementById('requestId').value = req?.id ?? '';

  if (req) {
    document.getElementById('soldierName').value  = req.soldier_name;
    document.getElementById('unit').value         = req.unit;
    document.getElementById('loggedBy').value     = req.logged_by ?? '';
    document.getElementById('items').value        = req.items;
    document.getElementById('quantity').value     = req.quantity;
    document.getElementById('dateReceived').value = req.date_received;
    document.getElementById('notes').value        = req.notes;
    document.getElementById('category').value     = req.category;
    (req.category || '').split(',').map(c => c.trim()).forEach(cat => {
      const cb = [...document.querySelectorAll('.cat-btn')].find(b => b.dataset.cat === cat);
      if (cb) cb.classList.add('selected');
    });
  } else {
    const t = new Date();
    const localDate = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
    document.getElementById('dateReceived').value = localDate;
  }

  modal.classList.remove('hidden');
  document.body.classList.add('no-scroll');
  setTimeout(() => document.getElementById('soldierName').focus(), 100);
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  document.body.classList.remove('no-scroll');
}

function openEdit(id) {
  const req = state.allRequests.find(r => r.id === id);
  if (req) {
    openModal(req);
  } else {
    alert('Request not found — please refresh the page.');
  }
}

async function submitForm(e) {
  e.preventDefault();

  const category = document.getElementById('category').value;
  const id   = document.getElementById('requestId').value;
  const data = {
    soldier_name:  document.getElementById('soldierName').value.trim(),
    unit:          document.getElementById('unit').value.trim(),
    logged_by:     document.getElementById('loggedBy').value.trim(),
    category,
    items:         document.getElementById('items').value.trim(),
    quantity:      document.getElementById('quantity').value.trim(),
    date_received: document.getElementById('dateReceived').value,
    notes:         document.getElementById('notes').value.trim(),
    urgent:        document.getElementById('urgentToggle').classList.contains('active'),
  };

  const btn = document.getElementById('formSubmitBtn');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    if (id) {
      await api('PUT', `/api/requests/${id}`, data);
    } else {
      await api('POST', '/api/requests', data);
    }
    closeModal();
    await refreshRequests();
    renderView();
  } catch (err) {
    alert('Error saving: ' + err.message);
    btn.textContent = id ? 'Save Changes' : 'Save Request';
    btn.disabled = false;
  }
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────

function exportCSV() {
  window.location.href = '/api/export';
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ─── THEME ────────────────────────────────────────────────────────────────────

function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const btn  = document.getElementById('themeToggle');
  const meta = document.getElementById('themeColorMeta');
  if (btn)  btn.textContent  = dark ? '🌙' : '☀️';
  if (meta) meta.content     = dark ? '#1c1c1e' : '#ffffff';
}

function initTheme() {
  const saved = localStorage.getItem('fieldlog-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = saved ? saved === 'dark' : prefersDark;
  applyTheme(dark);

  document.getElementById('themeToggle').addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = !isDark;
    localStorage.setItem('fieldlog-theme', next ? 'dark' : 'light');
    applyTheme(next);
  });
}

// ─── DISCLAIMER ───────────────────────────────────────────────────────────────

function initDisclaimer() {
  const modal     = document.getElementById('disclaimerModal');
  const accept    = document.getElementById('disclaimerAccept');
  const isLocal   = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const accepted  = localStorage.getItem('fieldlog-terms-accepted');

  if (isLocal || !accepted) {
    modal.classList.remove('hidden');
    document.body.classList.add('no-scroll');
  }
  accept.addEventListener('click', () => {
    if (!isLocal) localStorage.setItem('fieldlog-terms-accepted', '1');
    modal.classList.add('hidden');
    document.body.classList.remove('no-scroll');
  });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function init() {
  // Disclaimer
  initDisclaimer();

  // Theme
  initTheme();

  // Nav
  document.querySelectorAll('.nav-item').forEach(btn =>
    btn.addEventListener('click', () => navigate(btn.dataset.view)));

  // FAB
  document.getElementById('fab').addEventListener('click', () => openModal());

  // Modal
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalBackdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // Urgent toggle
  document.getElementById('urgentToggle').addEventListener('click', function() {
    this.classList.toggle('active');
  });

  // Form
  document.getElementById('requestForm').addEventListener('submit', submitForm);

  // Category buttons – toggle multi-select
  document.querySelectorAll('.cat-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      btn.classList.toggle('selected');
      const selected = [...document.querySelectorAll('.cat-btn.selected')].map(b => b.dataset.cat);
      document.getElementById('category').value = selected.join(',');
    }));

  // Kebab menu
  const kebabBtn  = document.getElementById('kebabBtn');
  const kebabMenu = document.getElementById('kebabMenu');
  kebabBtn.addEventListener('click', e => {
    e.stopPropagation();
    kebabMenu.classList.toggle('hidden');
  });
  document.addEventListener('click', () => kebabMenu.classList.add('hidden'));

  // Export
  document.getElementById('exportBtn').addEventListener('click', () => {
    kebabMenu.classList.add('hidden');
    exportCSV();
  });

  // Load data and render
  try {
    await loadAll();
  } catch (err) {
    console.error('Failed to load data:', err);
    document.getElementById('view-dashboard').innerHTML = `
      <div class="empty">
        <div class="empty-icon">⚠️</div>
        <p>Could not connect to server.<br>Please refresh the page.</p>
      </div>`;
  }
  navigate('dashboard');
}

document.addEventListener('DOMContentLoaded', init);