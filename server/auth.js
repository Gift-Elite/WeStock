const jwt = require('jsonwebtoken');
require('dotenv').config();
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

function sign(user) {
  return jwt.sign({ id: user.id, role_id: user.role_id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '8h' });
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

function requireRole(roleName) {
  return async (req, res, next) => {
    try {
      const role = await db.get('SELECT name FROM roles WHERE id = ?', [req.user.role_id]);
      if (!role || role.name !== roleName) return res.status(403).json({ error: 'Forbidden' });
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { sign, authenticateToken, requireRole };
