const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
const bcrypt = require('bcryptjs');
const { sign, authenticateToken } = require('./auth');
const uuid = require('uuid');
const cron = require('node-cron');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
// map of userId -> socketId
const userSockets = {};

app.use(cors());
app.use(express.json());

// ensure uploads folder and serve uploaded images
const uploadsDir = path.join(__dirname, 'uploads');
try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) { /* ignore */ }
app.use('/uploads', express.static(uploadsDir));

// Serve a simple inline SVG favicon at /favicon.ico to avoid 404s
app.get('/favicon.ico', (req, res) => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
    <rect width="48" height="48" rx="8" fill="#4F46E5"/>
    <text x="50%" y="55%" font-size="24" text-anchor="middle" fill="white" font-family="Arial, Helvetica, sans-serif">SMS</text>
  </svg>`
  res.type('image/svg+xml')
  res.send(svg)
})

const upload = multer({ dest: uploadsDir });

// simple health check for dev
app.get('/health', (req, res) => res.json({ ok: true }));

// create auxiliary tables if missing
(async () => {
  try {
    await db.run('CREATE TABLE IF NOT EXISTS item_images (item_id INTEGER, path TEXT)')
    await db.run('CREATE TABLE IF NOT EXISTS item_prices (item_id INTEGER, price_type TEXT, price REAL)')
    await db.run('CREATE TABLE IF NOT EXISTS purchase_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER, clerk_id INTEGER, quantity INTEGER, note TEXT, status TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)')
    await db.run('CREATE TABLE IF NOT EXISTS carts (id INTEGER PRIMARY KEY AUTOINCREMENT, clerk_id INTEGER, customer_name TEXT, status TEXT, total REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)')
    await db.run('CREATE TABLE IF NOT EXISTS cart_items (id INTEGER PRIMARY KEY AUTOINCREMENT, cart_id INTEGER, item_id INTEGER, quantity INTEGER, price REAL)')
    await db.run('CREATE TABLE IF NOT EXISTS user_meta (user_id INTEGER PRIMARY KEY, revoked INTEGER DEFAULT 0, requires_approval INTEGER DEFAULT 0)')
    await db.run('CREATE TABLE IF NOT EXISTS audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, meta TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)')
  } catch (e) { console.error('aux table setup error', e) }
})()

const PORT = process.env.PORT || 4000;

// Basic auth routes
app.post('/api/signup', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const roleRow = await db.get('SELECT id, name FROM roles WHERE name = ?', [role || 'cashier']);
    if (!roleRow) return res.status(400).json({ error: 'Invalid role' });
    const hashed = await bcrypt.hash(password, 8);
    const info = await db.runAndGetId('INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, ?)', [name, email, hashed, roleRow.id]);
    const userId = info.lastInsertRowid;
    // require admin approval for non-admin roles
    const requiresApproval = (roleRow.name !== 'admin') ? 1 : 0;
    await db.run('INSERT OR REPLACE INTO user_meta (user_id, revoked, requires_approval) VALUES (?, ?, ?)', [userId, 0, requiresApproval]);
    // if approval required, don't issue token yet
    if (requiresApproval) {
      await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [userId, 'signup_pending', JSON.stringify({ role: roleRow.name })]);
      return res.json({ pending: true, user: { id: userId, name, email, role_id: roleRow.id } });
    }
    const createdUser = { id: userId, name, email, role_id: roleRow.id };
    const token = sign(createdUser);
    res.json({ token, user: createdUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to signup' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.get('SELECT id, name, email, password, role_id FROM users WHERE email = ?', [email]);
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });
    // check meta (revoked or awaiting approval)
    const meta = await db.get('SELECT revoked, requires_approval FROM user_meta WHERE user_id = ?', [user.id]);
    if (meta && meta.revoked) return res.status(403).json({ error: 'Account revoked' });
    if (meta && meta.requires_approval) return res.status(403).json({ error: 'Awaiting admin approval' });
    const safeUser = { id: user.id, name: user.name, email: user.email, role_id: user.role_id };
    const token = sign(safeUser);
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Private admin signup (requires secret)
app.post('/api/admin/signup-private', async (req, res) => {
  try {
    const { secret, name, email, password } = req.body;
    if (!process.env.ADMIN_SIGNUP_SECRET) return res.status(500).json({ error: 'Server not configured for private signup' });
    if (!secret || secret !== process.env.ADMIN_SIGNUP_SECRET) return res.status(403).json({ error: 'Forbidden' });
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(400).json({ error: 'Email already exists' });
    const hashed = await bcrypt.hash(password, 8);
    const info = await db.runAndGetId('INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, ?)', [name, email, hashed, 1]);
    const userId = info.lastInsertRowid;
    try { await db.run('INSERT OR REPLACE INTO user_meta (user_id, revoked, requires_approval) VALUES (?, ?, ?)', [userId, 0, 0]); } catch (e) { /* ignore */ }
    const created = await db.get('SELECT id, name, email, role_id FROM users WHERE id = ?', [userId]);
    res.json({ user: created });
  } catch (e) { console.error('private signup error', e); res.status(500).json({ error: 'Failed to create admin' }) }
})

// Info endpoint for private signup availability
app.get('/api/admin/signup-private', async (req, res) => {
  try {
    const available = !!process.env.ADMIN_SIGNUP_SECRET
    res.json({ available })
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed' }) }
})

// Item creation (clerk/admin) with image and box/item prices
app.post('/api/items', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const { sku, name, quantity, box_quantity, price_box, price_item } = req.body;
    const finalSku = sku && sku.trim() ? sku.trim() : `SKU_${Date.now()}`;
    const info = await db.runAndGetId('INSERT INTO items (sku, name, quantity, box_quantity, low_threshold, medium_threshold) VALUES (?, ?, ?, ?, ?, ?)', [finalSku, name, quantity || 0, box_quantity || 0, 5, 20]);
    const itemId = info.lastInsertRowid;
    // store image reference
    await db.run('CREATE TABLE IF NOT EXISTS item_images (item_id INTEGER, path TEXT)');
    if (req.file) {
      const webPath = '/uploads/' + req.file.filename;
      await db.run('INSERT INTO item_images (item_id, path) VALUES (?, ?)', [itemId, webPath]);
    }
    // store prices in a flexible table
    await db.run('CREATE TABLE IF NOT EXISTS item_prices (item_id INTEGER, price_type TEXT, price REAL)');
    if (price_box) await db.run('INSERT INTO item_prices (item_id, price_type, price) VALUES (?, ?, ?)', [itemId, 'box', parseFloat(price_box)]);
    if (price_item) await db.run('INSERT INTO item_prices (item_id, price_type, price) VALUES (?, ?, ?)', [itemId, 'item', parseFloat(price_item)]);
    const item = await db.get('SELECT * FROM items WHERE id = ?', [itemId]);
    res.json({ item });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create item' });
  }
});

// Items
app.get('/api/items', authenticateToken, (req, res) => {
  ;(async () => {
    const items = await db.all('SELECT i.*, (SELECT path FROM item_images im WHERE im.item_id = i.id LIMIT 1) as image FROM items i');
    // attach prices
    const priced = [];
    for (const i of items) {
      const prices = await db.all('SELECT price_type, price FROM item_prices WHERE item_id = ?', [i.id]);
      let price_box = null, price_item = null;
      for (const p of prices) { if (p.price_type === 'box') price_box = p.price; if (p.price_type === 'item') price_item = p.price }
      let status = 'enough';
      if (i.quantity <= i.low_threshold) status = 'low';
      else if (i.quantity <= i.medium_threshold) status = 'medium';
      priced.push({ ...i, status, price_box, price_item, image: i.image })
    }
    res.json(priced);
  })();
});

app.post('/api/items/restock', authenticateToken, (req, res) => {
  const { item_id, quantity, note } = req.body;
  const userId = req.user.id;
  ;(async () => {
    const info = await db.runAndGetId('INSERT INTO stock_movements (item_id, user_id, type, quantity, note) VALUES (?, ?, ?, ?, ?)', [item_id, userId, 'restock', quantity, note || null]);
    await db.run('UPDATE items SET quantity = quantity + ? WHERE id = ?', [quantity, item_id]);
    const movement = await db.get('SELECT * FROM stock_movements WHERE id = ?', [info.lastInsertRowid]);
    io.emit('stock:update', { item_id, quantity });
    res.json({ movement });
  })();
});

// Sales (cashier)
app.post('/api/sales', authenticateToken, (req, res) => {
  const { items, total, payment_method } = req.body;
  const cashierId = req.user.id;
  ;(async () => {
    const info = await db.runAndGetId('INSERT INTO sales (cashier_id, total, payment_method) VALUES (?, ?, ?)', [cashierId, total, payment_method]);
    const saleId = info.lastInsertRowid;
    for (const it of items) {
      await db.run('INSERT INTO sale_items (sale_id, item_id, quantity, price) VALUES (?, ?, ?, ?)', [saleId, it.id, it.quantity, it.price]);
      await db.run('UPDATE items SET quantity = quantity - ? WHERE id = ?', [it.quantity, it.id]);
      await db.run('INSERT INTO stock_movements (item_id, user_id, type, quantity, note) VALUES (?, ?, ?, ?, ?)', [it.id, cashierId, 'sale', it.quantity, `Sale ${saleId}`]);
    }
    io.emit('sale:created', { saleId });
    res.json({ saleId });
  })();
});

// Admin: list users
app.get('/api/admin/users', authenticateToken, (req, res) => {
  // check admin
  ;(async () => {
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const users = await db.all('SELECT u.id, u.name, u.email, u.created_at, r.name as role FROM users u JOIN roles r ON u.role_id = r.id');
    res.json(users);
  })();
});

app.post('/api/admin/users', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  const { name, email, password, role } = req.body;
  const r = await db.get('SELECT id FROM roles WHERE name = ?', [role]);
  if (!r) return res.status(400).json({ error: 'Invalid role' });
  const hashed = await bcrypt.hash(password, 8);
  const info = await db.runAndGetId('INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, ?)', [name, email, hashed, r.id]);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/admin/users/:id', authenticateToken, (req, res) => {
  ;(async () => {
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    const id = req.params.id
    // remove related meta then delete user record
    await db.run('DELETE FROM user_meta WHERE user_id = ?', [id])
    await db.run('DELETE FROM users WHERE id = ?', [id])
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [req.user.id, 'admin_deleted_user', JSON.stringify({ deleted_user: id })])
    res.json({ ok: true });
  })();
});

// Admin: list pending approvals
app.get('/api/admin/approvals', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const rows = await db.all('SELECT u.id, u.name, u.email, r.name as role FROM users u JOIN roles r ON u.role_id = r.id JOIN user_meta m ON m.user_id = u.id WHERE m.requires_approval = 1');
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch approvals' }) }
});

app.post('/api/admin/approvals/:id/approve', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    await db.run('UPDATE user_meta SET requires_approval = 0 WHERE user_id = ?', [req.params.id]);
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [req.params.id, 'approved', JSON.stringify({ by: req.user.id })]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to approve' }) }
});

// admin analytics
app.get('/api/admin/analytics', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const totalSales = await db.get('SELECT SUM(total) as total FROM sales')
    const byPayment = await db.all('SELECT payment_method, COUNT(*) as count, SUM(total) as total FROM sales GROUP BY payment_method')
    const perClerk = await db.all('SELECT u.id, u.name, COUNT(c.id) as carts, SUM(c.total) as total_served FROM users u LEFT JOIN carts c ON c.clerk_id = u.id GROUP BY u.id')
    res.json({ totalSales: totalSales.total || 0, byPayment, perClerk })
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed analytics' }) }
})

// Generate a daily sales report for a given date (YYYY-MM-DD)
async function generateDailyReport(dateStr) {
  // sales totals
  const totalRow = await db.get('SELECT IFNULL(SUM(total),0) as total FROM sales WHERE date(created_at)=?', [dateStr]);
  const salesCountRow = await db.get('SELECT COUNT(*) as count FROM sales WHERE date(created_at)=?', [dateStr]);
  // unique customers from carts and sales: use carts.customer_name and sales rows (assume each sale is a customer)
  const customersFromCarts = await db.all('SELECT DISTINCT customer_name FROM carts WHERE date(created_at)=? AND customer_name IS NOT NULL', [dateStr]);
  const totalCustomers = (customersFromCarts ? customersFromCarts.length : 0) + (salesCountRow.count || 0);

  // per-product breakdown from sale_items
  const productSales = await db.all(`SELECT si.item_id, i.name as item_name, SUM(si.quantity) as quantity_sold, SUM(si.quantity * si.price) as revenue
    FROM sale_items si JOIN sales s ON si.sale_id = s.id JOIN items i ON si.item_id = i.id
    WHERE date(s.created_at) = ? GROUP BY si.item_id`, [dateStr]);

  // also include carts (clerk-created) breakdown
  const productCarts = await db.all(`SELECT ci.item_id, i.name as item_name, SUM(ci.quantity) as quantity_sold, SUM(ci.quantity * ci.price) as revenue
    FROM cart_items ci JOIN carts c ON ci.cart_id = c.id JOIN items i ON ci.item_id = i.id
    WHERE date(c.created_at) = ? GROUP BY ci.item_id`, [dateStr]);

  // merge productSales and productCarts by item_id
  const productsMap = {};
  for (const p of productSales) productsMap[p.item_id] = { item_id: p.item_id, item_name: p.item_name, quantity_sold: p.quantity_sold || 0, revenue: p.revenue || 0 };
  for (const p of productCarts) {
    if (!productsMap[p.item_id]) productsMap[p.item_id] = { item_id: p.item_id, item_name: p.item_name, quantity_sold: 0, revenue: 0 };
    productsMap[p.item_id].quantity_sold = (productsMap[p.item_id].quantity_sold || 0) + (p.quantity_sold || 0);
    productsMap[p.item_id].revenue = (productsMap[p.item_id].revenue || 0) + (p.revenue || 0);
  }

  const products = Object.values(productsMap);

  const report = {
    date: dateStr,
    totalRevenue: totalRow.total || 0,
    salesCount: salesCountRow.count || 0,
    totalCustomers: totalCustomers || 0,
    products,
    generated_at: new Date().toISOString()
  };

  // write to file for archival
  try {
    const reportsDir = path.join(__dirname, 'reports')
    try { fs.mkdirSync(reportsDir, { recursive: true }) } catch (e) { }
    const filePath = path.join(reportsDir, `daily-${dateStr}.json`)
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2))
  } catch (e) { console.error('failed to write daily report file', e) }

  return report;
}

// Admin endpoint to fetch daily report
app.get('/api/admin/reports/daily', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const date = req.query.date || new Date().toISOString().slice(0,10)
    const report = await generateDailyReport(date)
    res.json(report)
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to generate report' }) }
})

// Allow admin to set item price tags for easier total calculation
app.post('/api/admin/items/:id/price', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const itemId = req.params.id
    const { price_type, price } = req.body
    if (!price_type || (price_type !== 'item' && price_type !== 'box')) return res.status(400).json({ error: 'Invalid price_type' })
    // remove existing price for this type
    await db.run('DELETE FROM item_prices WHERE item_id = ? AND price_type = ?', [itemId, price_type])
    await db.run('INSERT INTO item_prices (item_id, price_type, price) VALUES (?, ?, ?)', [itemId, price_type, parseFloat(price)])
    res.json({ ok: true })
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to set price' }) }
})

// Broadcast messages from authenticated users (admin/cashier/clerk)
app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { message, target } = req.body; // target optional
    if (!message) return res.status(400).json({ error: 'Missing message' });
    const user = req.user;
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [user.role_id]);
    const payload = { from_id: user.id, from_name: user.name, from_role: roleRow ? roleRow.name : 'user', message, target: target || 'all', created_at: new Date().toISOString() };
    // emit to all connected clients (client can filter by role if needed)
    io.emit('global:message', payload);
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [user.id, 'broadcast_message', JSON.stringify(payload)]);
    res.json({ ok: true });
  } catch (e) { console.error('broadcast message error', e); res.status(500).json({ error: 'Failed to broadcast' }) }
})

// Schedule daily report generation at 00:05 server time (runs for previous day)
try {
  cron.schedule('5 0 * * *', async () => {
    try {
      const yesterday = new Date(Date.now() - 24*60*60*1000)
      const dateStr = yesterday.toISOString().slice(0,10)
      const report = await generateDailyReport(dateStr)
      console.log('Daily report generated for', dateStr)
      // emit to admins if connected
      io.emit('admin:daily_report', report)
    } catch (e) { console.error('daily report cron error', e) }
  })
} catch (e) { console.error('failed to schedule cron', e) }

// Admin purchases and carts history with basic filters
app.get('/api/admin/purchases', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { item_id, start_date, end_date, min_total, cart_id } = req.query;
    const clauses = [];
    const params = [];
    let base = 'SELECT c.*, u.name as clerk_name FROM carts c LEFT JOIN users u ON c.clerk_id = u.id WHERE 1=1';
    if (cart_id) { clauses.push('c.id = ?'); params.push(cart_id) }
    if (start_date) { clauses.push('c.created_at >= ?'); params.push(start_date) }
    if (end_date) { clauses.push('c.created_at <= ?'); params.push(end_date) }
    if (min_total) { clauses.push('c.total >= ?'); params.push(min_total) }
    if (clauses.length) base += ' AND ' + clauses.join(' AND ')
    const rows = await db.all(base, params)
    // if item_id filter, filter cart items
    if (item_id) {
      const filtered = [];
      for (const r of rows) {
        const items = await db.all('SELECT * FROM cart_items WHERE cart_id = ? AND item_id = ?', [r.id, item_id])
        if (items.length) filtered.push({ ...r, items })
      }
      return res.json(filtered)
    }
    res.json(rows)
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch purchases' }) }
})

// simple search for low stock
app.get('/api/items/low', authenticateToken, (req, res) => {
  ;(async () => {
    const items = await db.all('SELECT *, (CASE WHEN quantity <= low_threshold THEN 1 ELSE 0 END) as is_low FROM items WHERE quantity <= medium_threshold');
    res.json(items);
  })();
});

io.on('connection', socket => {
  console.log('socket connected', socket.id);
  socket.on('identify', data => {
    try {
      const uid = data && (data.userId || data.id)
      if (uid) {
        userSockets[uid] = socket.id;
        console.log('socket identified user', uid, '->', socket.id)
      }
    } catch (e) { /* ignore */ }
  })
  socket.on('disconnect', () => {
    // remove mapping for this socket
    for (const [uid, sid] of Object.entries(userSockets)) {
      if (sid === socket.id) delete userSockets[uid]
    }
  })
  socket.on('call:clerk', payload => {
    // payload: { clerkId, fromCashierId }
    const callId = uuid.v4();
    // Save minimal call in DB
    ;(async () => {
      const info = await db.runAndGetId('INSERT INTO calls (caller_id, clerk_id, status) VALUES (?, ?, ?)', [payload.fromCashierId, payload.clerkId, 'pending']);
      // include caller/clerk names
      const saved = await db.get('SELECT c.*, uc.name as caller_name, uk.name as clerk_name FROM calls c LEFT JOIN users uc ON c.caller_id = uc.id LEFT JOIN users uk ON c.clerk_id = uk.id WHERE c.id = ?', [info.lastInsertRowid]);
      // notify the caller socket that the call has been created (so cashier can show calling UI)
      try { socket.emit('call:created', saved) } catch (e) { console.error('emit call:created failed', e) }
      // try to deliver to specific clerk socket if connected
      const targetSocket = userSockets[payload.clerkId]
      if (targetSocket) {
        console.log('delivering call:new to socket', targetSocket)
        io.to(targetSocket).emit('call:new', saved)
      } else {
        console.log('clerk socket not found, broadcasting call:new')
        io.emit('call:new', saved)
      }
    })();
  });

  socket.on('call:response', async payload => {
    // payload: { callId, response, clerkId }
    try {
      const { callId, response } = payload;
      // map clerk response to cashier-friendly message and normalized status
      const message = response === 'answered' ? 'coming' : (response === 'have_customer' ? 'occupied' : response);
      const statusValue = response === 'answered' ? 'answered' : (response === 'have_customer' ? 'occupied' : response);
      // update call status in DB
      await db.run('UPDATE calls SET status = ? WHERE id = ?', [statusValue, callId]);
      const callRow = await db.get('SELECT * FROM calls WHERE id = ?', [callId]);
      if (!callRow) return;
      // find caller socket and notify with a friendly message
      const callerSocket = userSockets[callRow.caller_id]
      const dataToSend = { callId, response, message, clerk_id: callRow.clerk_id };
      console.log('call:response received', { callId, response, message, caller_id: callRow.caller_id, callerSocket })
      if (callerSocket) {
        console.log('emitting call:response to caller socket id', callerSocket)
        io.to(callerSocket).emit('call:response', dataToSend)
      } else {
        console.log('caller socket not found, broadcasting call:response')
        io.emit('call:response', dataToSend)
      }
      await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [callRow.clerk_id, 'call_response', JSON.stringify({ callId, response, message })]);
    } catch (e) { console.error('call:response error', e) }
  })
  socket.on('purchase:request', async payload => {
    // payload: { item_id, quantity, clerkId, note }
    try {
      console.log('socket purchase:request received', payload);
      const info = await db.runAndGetId('INSERT INTO purchase_requests (item_id, clerk_id, quantity, note, status) VALUES (?, ?, ?, ?, ?)', [payload.item_id, payload.clerkId, payload.quantity, payload.note || null, 'pending']);
      const saved = await db.get('SELECT pr.*, i.name as item_name, u.name as clerk_name FROM purchase_requests pr LEFT JOIN items i ON pr.item_id = i.id LEFT JOIN users u ON pr.clerk_id = u.id WHERE pr.id = ?', [info.lastInsertRowid]);
      console.log('emitting purchase:new via socket.io', saved);
      io.emit('purchase:new', saved);
    } catch (err) {
      console.error('purchase:request error', err);
    }
  });
});

// Purchases endpoints: clerk requests and cashier confirms
app.post('/api/purchases/request', authenticateToken, async (req, res) => {
  try {
    const { item_id, quantity, note, unit_type, price } = req.body;
    const clerkId = req.user.id;
    // treat as removal request by clerk: decrement stock immediately and record movement
    const item = await db.get('SELECT * FROM items WHERE id = ?', [item_id]);
    if (!item) return res.status(400).json({ error: 'Invalid item' });
    // decrease stock
    await db.run('UPDATE items SET quantity = quantity - ? WHERE id = ?', [quantity, item_id]);
    await db.run('INSERT INTO stock_movements (item_id, user_id, type, quantity, note) VALUES (?, ?, ?, ?, ?)', [item_id, clerkId, 'remove', quantity, `Removed by clerk`]);
    // emit stock update with new quantity
    const newItem = await db.get('SELECT id, quantity FROM items WHERE id = ?', [item_id]);
    io.emit('stock:update', { item_id: item_id, quantity: newItem.quantity });
    // persist unit_type and price in note as JSON
    const noteObj = { note: note || null, unit_type: unit_type || 'item', price: price ? parseFloat(price) : null };
    const info = await db.runAndGetId('INSERT INTO purchase_requests (item_id, clerk_id, quantity, note, status) VALUES (?, ?, ?, ?, ?)', [item_id, clerkId, quantity, JSON.stringify(noteObj), 'pending']);
    const saved = await db.get('SELECT pr.*, i.name as item_name, u.name as clerk_name FROM purchase_requests pr LEFT JOIN items i ON pr.item_id = i.id LEFT JOIN users u ON pr.clerk_id = u.id WHERE pr.id = ?', [info.lastInsertRowid]);
    console.log('HTTP purchase request created, emitting purchase:new', saved);
    io.emit('purchase:new', saved);
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [clerkId, 'purchase_request', JSON.stringify({ request_id: info.lastInsertRowid, item_id, quantity })]);
    res.json({ id: info.lastInsertRowid, saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create purchase request' });
  }
});

// clerk: list own purchase requests
app.get('/api/purchases/mine', authenticateToken, async (req, res) => {
  try {
    const clerkId = req.user.id
    const rows = await db.all('SELECT pr.*, i.name as item_name, u.name as clerk_name FROM purchase_requests pr LEFT JOIN items i ON pr.item_id = i.id LEFT JOIN users u ON pr.clerk_id = u.id WHERE pr.clerk_id = ? ORDER BY pr.created_at DESC', [clerkId])
    res.json(rows)
  } catch (e) { console.error('failed to fetch my purchases', e); res.status(500).json({ error: 'Failed to fetch' }) }
})

// admin: list pending users awaiting approval
app.get('/api/admin/pending-users', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const rows = await db.all('SELECT u.id, u.name, u.email, r.name as role FROM users u JOIN roles r ON u.role_id = r.id JOIN user_meta m ON m.user_id = u.id WHERE m.requires_approval = 1')
    res.json(rows)
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed' }) }
})

app.post('/api/admin/approve-user/:id', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const id = req.params.id
    await db.run('UPDATE user_meta SET requires_approval = 0 WHERE user_id = ?', [id])
    await db.run('INSERT INTO audit_logs (user_id, action) VALUES (?, ?)', [id, 'approved_by_admin'])
    res.json({ ok: true })
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed' }) }
})

// admin: view all carts and sales
app.get('/api/admin/carts', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const rows = await db.all('SELECT c.*, u.name as clerk_name FROM carts c LEFT JOIN users u ON c.clerk_id = u.id')
    res.json(rows)
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed' }) }
})

app.get('/api/admin/sales', authenticateToken, async (req, res) => {
  const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
  if (!roleRow || roleRow.name !== 'admin') return res.status(403).json({ error: 'Forbidden' });
  try {
    const rows = await db.all('SELECT s.*, u.name as cashier_name FROM sales s LEFT JOIN users u ON s.cashier_id = u.id')
    res.json(rows)
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed' }) }
})

app.get('/api/purchases/pending', authenticateToken, async (req, res) => {
  try {
    const rows = await db.all('SELECT pr.*, i.name as item_name, u.name as clerk_name FROM purchase_requests pr LEFT JOIN items i ON pr.item_id = i.id LEFT JOIN users u ON pr.clerk_id = u.id WHERE pr.status = ?', ['pending']);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch pending purchases' });
  }
});

app.post('/api/purchases/confirm', authenticateToken, async (req, res) => {
  try {
    const { request_id } = req.body;
    // check role is cashier or admin
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || (roleRow.name !== 'cashier' && roleRow.name !== 'admin')) return res.status(403).json({ error: 'Forbidden' });
    const reqRow = await db.get('SELECT * FROM purchase_requests WHERE id = ?', [request_id]);
    if (!reqRow) return res.status(404).json({ error: 'Not found' });
    if (reqRow.status !== 'pending') return res.status(400).json({ error: 'Already processed' });
    // mark confirmed
    await db.run('UPDATE purchase_requests SET status = ? WHERE id = ?', ['confirmed', request_id]);
    // update stock
    await db.run('UPDATE items SET quantity = quantity + ? WHERE id = ?', [reqRow.quantity, reqRow.item_id]);
    // record movement
    await db.run('INSERT INTO stock_movements (item_id, user_id, type, quantity, note) VALUES (?, ?, ?, ?, ?)', [reqRow.item_id, req.user.id, 'restock', reqRow.quantity, `Confirmed purchase ${request_id}`]);
    const saved = await db.get('SELECT pr.*, i.name as item_name, u.name as clerk_name FROM purchase_requests pr LEFT JOIN items i ON pr.item_id = i.id LEFT JOIN users u ON pr.clerk_id = u.id WHERE pr.id = ?', [request_id]);
    io.emit('purchase:confirmed', saved);
    io.emit('stock:update', { item_id: reqRow.item_id, quantity: reqRow.quantity });
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [req.user.id, 'purchase_confirmed', JSON.stringify({ request_id })]);
    res.json({ ok: true, saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to confirm purchase' });
  }
});

app.post('/api/purchases/mark-paid', authenticateToken, async (req, res) => {
  try {
    console.log('POST /api/purchases/mark-paid body=', req.body, 'user=', req.user && { id: req.user.id, role_id: req.user.role_id })
    const { request_id, payment_method } = req.body;
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || (roleRow.name !== 'cashier' && roleRow.name !== 'admin')) return res.status(403).json({ error: 'Forbidden' });
    const reqRow = await db.get('SELECT * FROM purchase_requests WHERE id = ?', [request_id]);
    if (!reqRow) return res.status(404).json({ error: 'Not found' });
    // mark as paid
    // update note JSON to include payment method and paid_by
    let noteObj = null;
    try { noteObj = JSON.parse(reqRow.note); } catch (e) { noteObj = { note: reqRow.note }; }
    noteObj.payment_method = payment_method || 'unknown';
    noteObj.paid_by = req.user.id;
    noteObj.paid_at = new Date().toISOString();
    await db.run('UPDATE purchase_requests SET status = ?, note = ? WHERE id = ?', ['paid', JSON.stringify(noteObj), request_id]);
    // create a sale record for cashier
    const total = (noteObj.price || 0) * (reqRow.quantity || 0);
    let saleId = null;
    try {
      console.log('Creating sale record', { cashier_id: req.user.id, total, payment_method: noteObj.payment_method })
      const saleInfo = await db.runAndGetId('INSERT INTO sales (cashier_id, total, payment_method) VALUES (?, ?, ?)', [req.user.id, total, noteObj.payment_method]);
      saleId = saleInfo.lastInsertRowid;
      console.log('Created sale id=', saleId)
    } catch (e) {
      console.error('Failed to insert sale record', e && e.stack ? e.stack : e);
      return res.status(500).json({ error: 'Failed to create sale record', detail: e && e.message ? e.message : String(e) });
    }
    try {
      const priceToUse = (noteObj.price != null) ? noteObj.price : 0
      console.log('Inserting sale_items', { saleId, item_id: reqRow.item_id, quantity: reqRow.quantity, price: priceToUse })
      await db.run('INSERT INTO sale_items (sale_id, item_id, quantity, price) VALUES (?, ?, ?, ?)', [saleId, reqRow.item_id, reqRow.quantity, priceToUse]);
    } catch (e) {
      console.error('Failed to insert sale_items', e && e.stack ? e.stack : e);
      // do not fail the whole flow; return partial success with note
      const saved = await db.get('SELECT pr.*, i.name as item_name, u.name as clerk_name FROM purchase_requests pr LEFT JOIN items i ON pr.item_id = i.id LEFT JOIN users u ON pr.clerk_id = u.id WHERE pr.id = ?', [request_id]);
      await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [req.user.id, 'purchase_paid_partial', JSON.stringify({ request_id, payment_method: noteObj.payment_method, saleId, error: e && e.message ? e.message : String(e) })]);
      io.emit('purchase:paid', saved);
      io.emit('sale:created', { saleId });
      return res.status(200).json({ ok: false, partial: true, saved, saleId, note: 'sale_items insertion failed' });
    }
    const saved = await db.get('SELECT pr.*, i.name as item_name, u.name as clerk_name FROM purchase_requests pr LEFT JOIN items i ON pr.item_id = i.id LEFT JOIN users u ON pr.clerk_id = u.id WHERE pr.id = ?', [request_id]);
    io.emit('purchase:paid', saved);
    io.emit('sale:created', { saleId });
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [req.user.id, 'purchase_paid', JSON.stringify({ request_id, payment_method: noteObj.payment_method, saleId })]);
    res.json({ ok: true, saved, saleId });
  } catch (err) {
    console.error('Error in /api/purchases/mark-paid:', err && err.stack ? err.stack : err);
    res.status(500).json({ error: 'Failed to mark paid', detail: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/purchases/deny', authenticateToken, async (req, res) => {
  try {
    const { request_id, reason } = req.body;
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || (roleRow.name !== 'cashier' && roleRow.name !== 'admin')) return res.status(403).json({ error: 'Forbidden' });
    const reqRow = await db.get('SELECT * FROM purchase_requests WHERE id = ?', [request_id]);
    if (!reqRow) return res.status(404).json({ error: 'Not found' });
    // mark as denied and restore stock (since clerk reserved/removed earlier)
    await db.run('UPDATE purchase_requests SET status = ? WHERE id = ?', ['denied', request_id]);
    await db.run('UPDATE items SET quantity = quantity + ? WHERE id = ?', [reqRow.quantity, reqRow.item_id]);
    await db.run('INSERT INTO stock_movements (item_id, user_id, type, quantity, note) VALUES (?, ?, ?, ?, ?)', [reqRow.item_id, req.user.id, 'restock', reqRow.quantity, `Denied purchase ${request_id}: ${reason || ''}`]);
    const saved = await db.get('SELECT pr.*, i.name as item_name, u.name as clerk_name FROM purchase_requests pr LEFT JOIN items i ON pr.item_id = i.id LEFT JOIN users u ON pr.clerk_id = u.id WHERE pr.id = ?', [request_id]);
    io.emit('purchase:denied', saved);
    io.emit('stock:update', { item_id: reqRow.item_id, quantity: reqRow.quantity });
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [req.user.id, 'purchase_denied', JSON.stringify({ request_id, reason })]);
    res.json({ ok: true, saved });
  } catch (err) {
    console.error('Error denying purchase', err);
    res.status(500).json({ error: 'Failed to deny purchase', detail: err && err.message ? err.message : String(err) });
  }
});

// Carts: clerk creates a cart (local customer cart)
app.post('/api/carts', authenticateToken, async (req, res) => {
  try {
    const { customer_name, items: cartItems } = req.body; // items: [{item_id, quantity, price}]
    const clerkId = req.user.id;
    // only clerks or admins can create carts
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || (roleRow.name !== 'clerk' && roleRow.name !== 'admin')) return res.status(403).json({ error: 'Forbidden' });
    const total = cartItems.reduce((s, it) => s + (it.price || 0) * it.quantity, 0);
    const info = await db.runAndGetId('INSERT INTO carts (clerk_id, customer_name, status, total) VALUES (?, ?, ?, ?)', [clerkId, customer_name || null, 'sent', total]);
    const cartId = info.lastInsertRowid;
    for (const it of cartItems) {
      await db.run('INSERT INTO cart_items (cart_id, item_id, quantity, price) VALUES (?, ?, ?, ?)', [cartId, it.item_id, it.quantity, it.price || 0]);
      // decrease stock reserved immediately
      await db.run('UPDATE items SET quantity = quantity - ? WHERE id = ?', [it.quantity, it.item_id]);
      await db.run('INSERT INTO stock_movements (item_id, user_id, type, quantity, note) VALUES (?, ?, ?, ?, ?)', [it.item_id, clerkId, 'remove', it.quantity, `Assigned to cart ${cartId}`]);
    }
    const saved = await db.get('SELECT * FROM carts WHERE id = ?', [cartId]);
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [clerkId, 'cart_created', JSON.stringify({ cartId, total })]);
    io.emit('cart:new', { cart: saved });
    io.emit('stock:refresh')
    res.json({ cartId, saved });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to create cart' }) }
});

app.get('/api/carts/pending', authenticateToken, async (req, res) => {
  try {
    const rows = await db.all('SELECT c.*, u.name as clerk_name FROM carts c LEFT JOIN users u ON c.clerk_id = u.id WHERE c.status = ?', ['sent']);
    res.json(rows)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to fetch carts' }) }
});

app.post('/api/carts/:id/confirm', authenticateToken, async (req, res) => {
  try {
    const cartId = req.params.id;
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || (roleRow.name !== 'cashier' && roleRow.name !== 'admin')) return res.status(403).json({ error: 'Forbidden' });
    await db.run('UPDATE carts SET status = ? WHERE id = ?', ['confirmed', cartId]);
    const saved = await db.get('SELECT * FROM carts WHERE id = ?', [cartId]);
    io.emit('cart:confirmed', saved);
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [req.user.id, 'cart_confirmed', JSON.stringify({ cartId })]);
    res.json({ ok: true, saved });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to confirm cart' }) }
});

app.post('/api/carts/:id/pay', authenticateToken, async (req, res) => {
  try {
    const cartId = req.params.id;
    const { payment_method } = req.body;
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || (roleRow.name !== 'cashier' && roleRow.name !== 'admin')) return res.status(403).json({ error: 'Forbidden' });
    const cart = await db.get('SELECT * FROM carts WHERE id = ?', [cartId]);
    if (!cart) return res.status(404).json({ error: 'Not found' });
    await db.run('UPDATE carts SET status = ?, total = ? WHERE id = ?', ['paid', cart.total, cartId]);
    // create sale record
    const saleInfo = await db.runAndGetId('INSERT INTO sales (cashier_id, total, payment_method) VALUES (?, ?, ?)', [req.user.id, cart.total, payment_method || 'unknown']);
    const saleId = saleInfo.lastInsertRowid;
    const items = await db.all('SELECT * FROM cart_items WHERE cart_id = ?', [cartId]);
    for (const it of items) {
      await db.run('INSERT INTO sale_items (sale_id, item_id, quantity, price) VALUES (?, ?, ?, ?)', [saleId, it.item_id, it.quantity, it.price]);
    }
    const saved = await db.get('SELECT * FROM carts WHERE id = ?', [cartId]);
    io.emit('cart:paid', saved);
    io.emit('sale:created', { saleId });
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [req.user.id, 'cart_paid', JSON.stringify({ cartId, saleId, payment_method })]);
    res.json({ ok: true, saleId, saved });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Failed to pay cart' }) }
});

app.post('/api/carts/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const cartId = req.params.id;
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || (roleRow.name !== 'cashier' && roleRow.name !== 'admin')) return res.status(403).json({ error: 'Forbidden' });
    const cart = await db.get('SELECT * FROM carts WHERE id = ?', [cartId]);
    if (!cart) return res.status(404).json({ error: 'Not found' });
    if (cart.status === 'paid' || cart.status === 'cancelled') return res.status(400).json({ error: 'Cannot cancel' });
    const items = await db.all('SELECT * FROM cart_items WHERE cart_id = ?', [cartId]);
    for (const it of items) {
      await db.run('UPDATE items SET quantity = quantity + ? WHERE id = ?', [it.quantity, it.item_id]);
      await db.run('INSERT INTO stock_movements (item_id, user_id, type, quantity, note) VALUES (?, ?, ?, ?, ?)', [it.item_id, req.user.id, 'restock', it.quantity, `Cart ${cartId} cancelled`]);
      io.emit('stock:update', { item_id: it.item_id, quantity: it.quantity });
    }
    await db.run('UPDATE carts SET status = ? WHERE id = ?', ['cancelled', cartId]);
    const saved = await db.get('SELECT * FROM carts WHERE id = ?', [cartId]);
    io.emit('cart:cancelled', saved);
    await db.run('INSERT INTO audit_logs (user_id, action, meta) VALUES (?, ?, ?)', [req.user.id, 'cart_cancelled', JSON.stringify({ cartId })]);
    res.json({ ok: true, saved });
  } catch (err) { console.error('Failed to cancel cart', err); res.status(500).json({ error: 'Failed to cancel cart', detail: err && err.message ? err.message : String(err) }) }
});

// Cart items
app.get('/api/carts/:id/items', authenticateToken, async (req, res) => {
  try {
    const cid = req.params.id;
    const rows = await db.all('SELECT ci.*, i.name as item_name FROM cart_items ci LEFT JOIN items i ON ci.item_id = i.id WHERE ci.cart_id = ?', [cid]);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch cart items' }) }
});

// cashier/admin cart history
app.get('/api/carts/history', authenticateToken, async (req, res) => {
  try {
    const roleRow = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
    if (!roleRow || (roleRow.name !== 'cashier' && roleRow.name !== 'admin')) return res.status(403).json({ error: 'Forbidden' });
    const { item_id, start_date, end_date, min_total, cart_id } = req.query;
    const clauses = [];
    const params = [];
    let base = 'SELECT c.*, u.name as clerk_name FROM carts c LEFT JOIN users u ON c.clerk_id = u.id WHERE 1=1';
    if (cart_id) { clauses.push('c.id = ?'); params.push(cart_id) }
    if (start_date) { clauses.push('c.created_at >= ?'); params.push(start_date) }
    if (end_date) { clauses.push('c.created_at <= ?'); params.push(end_date) }
    if (min_total) { clauses.push('c.total >= ?'); params.push(min_total) }
    if (clauses.length) base += ' AND ' + clauses.join(' AND ')
    const rows = await db.all(base, params)
    if (item_id) {
      const filtered = [];
      for (const r of rows) {
        const items = await db.all('SELECT * FROM cart_items WHERE cart_id = ? AND item_id = ?', [r.id, item_id])
        if (items.length) filtered.push({ ...r, items })
      }
      return res.json(filtered)
    }
    res.json(rows)
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to fetch history' }) }
});

server.on('error', err => {
  console.error('Server error', err);
});

// startup: init DB, ensure default admin user, then start server
(async () => {
  try {
    await db.init();
    // ensure there is at least one admin user
    const hasAdmin = await db.get('SELECT id FROM users WHERE role_id = 1 LIMIT 1');
    if (!hasAdmin) {
      const hashed = await bcrypt.hash('admin', 8);
      const info = await db.runAndGetId('INSERT INTO users (name, email, password, role_id) VALUES (?, ?, ?, ?)', ['Administrator', 'admin@local', hashed, 1]);
      const adminId = info.lastInsertRowid;
      try { await db.run('INSERT OR REPLACE INTO user_meta (user_id, revoked, requires_approval) VALUES (?, ?, ?)', [adminId, 0, 0]); } catch (e) { /* ignore */ }
      console.log('Created default admin: email=admin@local password=admin');
    }
    server.listen(PORT, () => {
      console.log(`Server listening on ${PORT}`);
    });
  } catch (err) {
    console.error('Startup error', err);
    process.exit(1);
  }
})();
