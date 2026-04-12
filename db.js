/**
 * db.js – Lightweight JSON-file database
 *
 * No native compilation required. Each table lives in data/<name>.json.
 * Writes are synchronous and atomic (write → rename pattern on save).
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

class Table {
  constructor(name) {
    this.file = path.join(DATA_DIR, `${name}.json`);
    this._store = this._load();
  }

  _load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return { nextId: 1, rows: [] };
    }
  }

  _save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this._store, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  insert(fields) {
    const now = new Date().toISOString();
    const row = { id: this._store.nextId++, ...fields, created_at: now, updated_at: now };
    this._store.rows.push(row);
    this._save();
    return row;
  }

  findById(id) {
    return this._store.rows.find(r => r.id === Number(id)) ?? null;
  }

  findAll({ where = {}, orderBy } = {}) {
    let rows = this._store.rows.filter(row =>
      Object.entries(where).every(([k, v]) => row[k] === v)
    );
    if (orderBy) rows = [...rows].sort(orderBy);
    return rows;
  }

  update(id, fields) {
    const idx = this._store.rows.findIndex(r => r.id === Number(id));
    if (idx === -1) return null;
    this._store.rows[idx] = {
      ...this._store.rows[idx],
      ...fields,
      updated_at: new Date().toISOString(),
    };
    this._save();
    return this._store.rows[idx];
  }

  remove(id) {
    const before = this._store.rows.length;
    this._store.rows = this._store.rows.filter(r => r.id !== Number(id));
    if (this._store.rows.length === before) return false;
    this._save();
    return true;
  }

  removeWhere(predicate) {
    const before = this._store.rows.length;
    this._store.rows = this._store.rows.filter(r => !predicate(r));
    if (this._store.rows.length !== before) this._save();
  }

  count(predicate = () => true) {
    return this._store.rows.filter(predicate).length;
  }

  // ── SEARCH helper ────────────────────────────────────────────────────────────

  search(text, fields) {
    const q = text.toLowerCase();
    return this._store.rows.filter(row =>
      fields.some(f => String(row[f] ?? '').toLowerCase().includes(q))
    );
  }
}

// ── SIMPLE COUNTER ────────────────────────────────────────────────────────────

class Counter {
  constructor(name) {
    this.file = path.join(DATA_DIR, `${name}.json`);
    this._store = this._load();
  }
  _load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch { return { count: 0 }; }
  }
  _save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this._store));
    fs.renameSync(tmp, this.file);
  }
  increment() { this._store.count++; this._save(); return this._store.count; }
  get()       { return this._store.count; }
  reset()     { this._store.count = 0; this._save(); }
}

// ── TABLE INSTANCES ───────────────────────────────────────────────────────────

const requests  = new Table('requests');
const inventory = new Table('inventory');
const activity  = new Table('activity');
const visits    = new Counter('visits');
const logins    = new Table('logins');

module.exports = { requests, inventory, activity, visits, logins };
