const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'database.sqlite');
const schemaPath = path.join(__dirname, 'db', 'schema.sql');
const seedPath = path.join(__dirname, 'db', 'seed.sql');

let SQL;
let _db;

async function init() {
  if (SQL && _db) return;
  SQL = await initSqlJs({ locateFile: file => {
    try { return require.resolve('sql.js/dist/' + file); } catch (e) { return path.join(__dirname, 'node_modules', 'sql.js', 'dist', file); }
  } });
  // ensure folder
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    const filebuffer = fs.readFileSync(DB_PATH);
    _db = new SQL.Database(filebuffer);
  } else {
    _db = new SQL.Database();
    if (fs.existsSync(schemaPath)) _db.run(fs.readFileSync(schemaPath, 'utf8'));
    if (fs.existsSync(seedPath)) _db.run(fs.readFileSync(seedPath, 'utf8'));
    save();
  }
  // ensure purchase_requests table exists for request/confirm workflow
  _db.run(`
    CREATE TABLE IF NOT EXISTS purchase_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      clerk_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(item_id) REFERENCES items(id),
      FOREIGN KEY(clerk_id) REFERENCES users(id)
    );
  `);
  save();
}

function save() {
  const data = _db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

async function run(sql, params = []) {
  await init();
  _db.run(sql, params);
  save();
  return { changes: 1 };
}

async function runAndGetId(sql, params = []) {
  await init();
  _db.run(sql, params);
  const rows = allRaw('SELECT last_insert_rowid() as id');
  const id = (rows[0] && rows[0].id) || null;
  save();
  return { lastInsertRowid: id };
}

function allRaw(sql, params = []) {
  const res = _db.exec(sql, params);
  if (!res || res.length === 0) return [];
  const r = res[0];
  return r.values.map(row => {
    const obj = {};
    r.columns.forEach((c, i) => { obj[c] = row[i]; });
    return obj;
  });
}

async function all(sql, params = []) {
  await init();
  return allRaw(sql, params);
}

async function get(sql, params = []) {
  await init();
  const rows = allRaw(sql, params);
  return rows[0] || undefined;
}

module.exports = { init, run, all, get, runAndGetId };
