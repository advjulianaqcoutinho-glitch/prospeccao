'use strict';

const { Router } = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const supabase = require('../db');
const config = require('../config');
const authMiddleware = require('../middleware/auth');

const router = Router();

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const { data: users, error } = await supabase
    .from('user_profile')
    .select('*')
    .eq('email', email)
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });
  if (!users || users.length === 0) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const user = users[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });

  const payload = { id: user.id, email: user.email };
  const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '7d' });

  return res.json({
    token,
    user: { id: user.id, email: user.email, nome: user.nome, empresa: user.empresa },
  });
});

// GET /me
router.get('/me', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('user_profile')
    .select('id, email, nome, empresa, segmento, descricao, tom_comunicacao, criado_em, atualizado_em')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(404).json({ error: error.message });
  return res.json(data);
});

// PATCH /profile
router.patch('/profile', authMiddleware, async (req, res) => {
  const allowed = ['nome', 'empresa', 'segmento', 'descricao', 'tom_comunicacao'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  updates.atualizado_em = new Date().toISOString();

  const { data, error } = await supabase
    .from('user_profile')
    .update(updates)
    .eq('id', req.user.id)
    .select('id, email, nome, empresa, segmento, descricao, tom_comunicacao, criado_em, atualizado_em')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  return res.json(data);
});

// POST /change-password
router.post('/change-password', authMiddleware, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password are required' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'new_password must be at least 8 characters' });
  }

  const { data: users, error } = await supabase
    .from('user_profile')
    .select('password_hash')
    .eq('id', req.user.id)
    .limit(1);

  if (error || !users || users.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  const match = await bcrypt.compare(current_password, users[0].password_hash);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(new_password, 12);
  const { error: updateError } = await supabase
    .from('user_profile')
    .update({ password_hash: newHash, atualizado_em: new Date().toISOString() })
    .eq('id', req.user.id);

  if (updateError) return res.status(500).json({ error: updateError.message });
  return res.json({ message: 'Password updated successfully' });
});

module.exports = router;
