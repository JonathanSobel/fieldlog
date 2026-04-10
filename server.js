const express = require('express');
const path    = require('path');
const { requests, inventory, visits } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const OVERDUE_DAYS = 3;

function isOverdue(row) {
  if (!['New', 'In Progress'].includes(row.status)) return false;
  const received = new Date(row.date_received + 'T00:00:00');
  return (Date.now() - received.getTime()) / 86_400_000 > OVERDUE_DAYS;
}

function sortByDateDesc(a, b) {
  return new Date(b.created_at) - new Date(a.created_at);
}

function csvCell(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

// ─── REQUESTS ────────────────────────────────────────────────────────────────

// GET /api/requests  – optional ?status= and ?search=
app.get('/api/requests', (req, res) => {
  const { status, search } = req.query;

  let rows = requests.findAll({ orderBy: sortByDateDesc });

  if (status && status !== 'all') {
    rows = rows.filter(r => r.status === status);
  }
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(r =>
      ['soldier_name', 'unit', 'items'].some(f =>
        String(r[f] ?? '').toLowerCase().includes(q)
      )
    );
  }

  res.json(rows);
});

// GET /api/requests/:id
app.get('/api/requests/:id', (req, res) => {
  const row = requests.findById(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

// POST /api/requests
app.post('/api/requests', (req, res) => {
  const { soldier_name, unit, category, items, quantity, date_received, notes } = req.body;

  const row = requests.insert({
    soldier_name:  soldier_name?.trim() ?? '',
    unit:          unit?.trim() ?? '',
    category:      category ?? '',
    items:         items?.trim() ?? '',
    quantity:      quantity?.trim() ?? '',
    date_received: date_received ?? new Date().toISOString().split('T')[0],
    status:        'New',
    notes:         notes?.trim() ?? '',
  });

  res.status(201).json(row);
});

// PUT /api/requests/:id  – partial or full update
app.put('/api/requests/:id', (req, res) => {
  const existing = requests.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const allowed = ['soldier_name', 'unit', 'category', 'items', 'quantity', 'date_received', 'status', 'notes'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  const updated = requests.update(req.params.id, updates);
  res.json(updated);
});

// DELETE /api/requests/:id
app.delete('/api/requests/:id', (req, res) => {
  if (!requests.remove(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ─── STATS ────────────────────────────────────────────────────────────────────

app.get('/api/stats', (_req, res) => {
  const all = requests.findAll();
  res.json({
    new:           all.filter(r => r.status === 'New').length,
    inProgress:    all.filter(r => r.status === 'In Progress').length,
    waitingPickup: all.filter(r => r.status === 'In Stock – Waiting for Pickup').length,
    completed:     all.filter(r => r.status === 'Completed (Picked Up)').length,
    cancelled:     all.filter(r => r.status === 'Cancelled').length,
    overdue:       all.filter(isOverdue).length,
    total:         all.length,
  });
});

// ─── INVENTORY ────────────────────────────────────────────────────────────────

app.get('/api/inventory', (_req, res) => {
  const rows = inventory.findAll({
    orderBy: (a, b) => {
      const cat = a.category.localeCompare(b.category);
      return cat !== 0 ? cat : a.item_name.localeCompare(b.item_name);
    },
  });
  res.json(rows);
});

app.post('/api/inventory', (req, res) => {
  const { item_name, quantity, category } = req.body;
  if (!item_name?.trim()) return res.status(400).json({ error: 'item_name required' });

  const row = inventory.insert({
    item_name: item_name.trim(),
    quantity:  Number(quantity) || 0,
    category:  category ?? 'Other',
  });
  res.status(201).json(row);
});

app.put('/api/inventory/:id', (req, res) => {
  const existing = inventory.findById(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const updates = {};
  if (req.body.item_name !== undefined) updates.item_name = req.body.item_name;
  if (req.body.quantity  !== undefined) updates.quantity  = Number(req.body.quantity);
  if (req.body.category  !== undefined) updates.category  = req.body.category;

  res.json(inventory.update(req.params.id, updates));
});

app.delete('/api/inventory/:id', (req, res) => {
  if (!inventory.remove(req.params.id)) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────

app.get('/api/export', (_req, res) => {
  const rows = requests.findAll({ orderBy: (a, b) => new Date(b.date_received) - new Date(a.date_received) });
  const headers = ['ID', 'Soldier Name', 'Unit', 'Category', 'Items', 'Quantity', 'Date Received', 'Status', 'Notes', 'Created At'];
  const lines = rows.map(r =>
    [r.id, r.soldier_name, r.unit, r.category, r.items, r.quantity,
     r.date_received, r.status, r.notes, r.created_at].map(csvCell).join(',')
  );

  const today = new Date().toISOString().split('T')[0];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="requests-${today}.csv"`);
  res.send([headers.join(','), ...lines].join('\r\n'));
});

// ─── VISITS ───────────────────────────────────────────────────────────────────

app.post('/api/visits', (_req, res) => {
  res.json({ total: visits.increment() });
});

app.get('/api/visits', (_req, res) => {
  res.json({ total: visits.get() });
});

// ─── START ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  FieldLog – Supply Tracker`);
  console.log(`  ─────────────────────────`);
  console.log(`  http://localhost:${PORT}\n`);
});
