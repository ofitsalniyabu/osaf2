// server.js - Backend REST API va Statik fayllar
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const selfsigned = require('selfsigned');
const { db, initDb } = require('./database');
const reports = require('./reports');
const telegram = require('./telegram');
const { hashPassword, verifyPassword } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

app.disable('x-powered-by');
if (process.env.VERCEL === '1') app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
let initialization;
function initializeApp() {
  if (!initialization) {
    initialization = initDb().catch(error => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}
app.use(async (req, res, next) => {
  try {
    await initializeApp();
    next();
  } catch (error) {
    next(error);
  }
});
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const hasRequestBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding') !== undefined;
  const bodylessPost = req.method === 'POST' &&
    (req.path === '/auth/logout' ||
     req.path === '/telegram/test' ||
     /^\/orders\/\d+\/send-telegram$/.test(req.path));
  const requiresBody = ['POST', 'PUT', 'PATCH'].includes(req.method) && !bodylessPost;
  const hasInvalidBody = hasRequestBody &&
    (!req.body || typeof req.body !== 'object' || Array.isArray(req.body));
  if (hasInvalidBody || (requiresBody && !hasRequestBody)) {
    return res.status(400).json({ success: false, error: 'So‘rov tanasi JSON obyekt bo‘lishi kerak' });
  }
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== req.get('host').toLowerCase()) {
        return res.status(403).json({ success: false, error: 'Boshqa manbadan yuborilgan so‘rov rad etildi' });
      }
    } catch (error) {
      return res.status(403).json({ success: false, error: 'So‘rov manbasi noto‘g‘ri' });
    }
  }
  next();
});

function getSessionToken(req) {
  const cookie = (req.headers.cookie || '').split(';').map(value => value.trim())
    .find(value => value.startsWith('carpet_session='));
  return cookie ? cookie.slice('carpet_session='.length) : null;
}

function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function setSessionCookie(res, token, maxAge) {
  res.set('Set-Cookie', `carpet_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
}

function canAccessOrder(user, order) {
  return user.role !== 'courier' ||
    order.courier_pickup_id === user.id ||
    order.courier_delivery_id === user.id;
}

// ================= LOGIN VA AUTORIZATSIYA =================
app.post('/api/auth/login', async (req, res) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const now = Date.now();
    const loginIpHash = hashToken(req.ip || req.socket.remoteAddress || 'unknown');
    const attempts = await db.get('SELECT attempts, first_attempt FROM login_attempts WHERE ip_hash = ?', [loginIpHash]);
    const attemptsWindowExpired = attempts && now - attempts.first_attempt >= 15 * 60 * 1000;
    if (attempts && !attemptsWindowExpired && attempts.attempts >= 10) {
      return res.status(429).json({ success: false, error: 'Juda ko‘p urinish. 15 daqiqadan keyin qayta urinib ko‘ring.' });
    }

    if (!username || username.length > 40 || !password || password.length > 256) {
      return res.status(400).json({ success: false, error: "Login va parolni kiriting" });
    }

    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || user.status !== 'active' || !verifyPassword(password, user.password)) {
      await db.run(`
        INSERT INTO login_attempts (ip_hash, attempts, first_attempt)
        VALUES (?, 1, ?)
        ON CONFLICT(ip_hash) DO UPDATE SET
          attempts = CASE WHEN login_attempts.first_attempt <= ? THEN 1 ELSE login_attempts.attempts + 1 END,
          first_attempt = CASE WHEN login_attempts.first_attempt <= ? THEN excluded.first_attempt ELSE login_attempts.first_attempt END
      `, [loginIpHash, now, now - 15 * 60 * 1000, now - 15 * 60 * 1000]);
      return res.status(401).json({ success: false, error: "Login yoki parol noto'g'ri" });
    }

    await db.run('DELETE FROM login_attempts WHERE ip_hash = ?', [loginIpHash]);
    if (!user.password.startsWith('scrypt$')) {
      await db.run('UPDATE users SET password = ? WHERE id = ?', [hashPassword(password), user.id]);
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    await db.run('DELETE FROM sessions WHERE expires_at <= ?', [now]);
    await db.run(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      [hashToken(token), user.id, expiresAt]
    );
    setSessionCookie(res, token, SESSION_TTL_MS / 1000);
    delete user.password;
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = getSessionToken(req);
    const session = token && await db.get(
      'SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?',
      [hashToken(token), Date.now()]
    );
    if (!session) {
      if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
      setSessionCookie(res, '', 0);
      return res.status(401).json({ success: false, error: 'Sessiya muddati tugagan' });
    }
    const user = await db.get(
      'SELECT id, username, full_name, role, phone, car_model, car_number, status FROM users WHERE id = ?',
      [session.userId]
    );
    if (!user || user.status !== 'active') {
      await db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
      setSessionCookie(res, '', 0);
      return res.status(401).json({ success: false, error: 'Hisob faol emas' });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = getSessionToken(req);
  try {
    if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
    setSessionCookie(res, '', 0);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/health', async (req, res, next) => {
  try {
    await db.get('SELECT 1 AS ok');
    res.json({ success: true, database: db.driver });
  } catch (error) {
    next(error);
  }
});

app.use('/api', async (req, res, next) => {
  const token = getSessionToken(req);
  const tokenHash = token && hashToken(token);
  try {
    const session = tokenHash && await db.get(
      'SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?',
      [tokenHash, Date.now()]
    );
    if (!session) {
      if (tokenHash) await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
      setSessionCookie(res, '', 0);
      return res.status(401).json({ success: false, error: 'Tizimga qayta kiring' });
    }
    const user = await db.get(
      'SELECT id, username, full_name, role, phone, car_model, car_number, status FROM users WHERE id = ?',
      [session.user_id]
    );
    if (!user || user.status !== 'active') {
      await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
      setSessionCookie(res, '', 0);
      return res.status(401).json({ success: false, error: 'Hisob faol emas' });
    }
    req.user = user;
    req.sessionTokenHash = tokenHash;
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/api/auth/change-password', async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (typeof current_password !== 'string' || typeof new_password !== 'string' ||
        new_password.length < 8 || new_password.length > 256) {
      return res.status(400).json({ success: false, error: 'Yangi parol 8–256 belgidan iborat bo‘lishi kerak' });
    }

    const user = await db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);
    if (!user || !verifyPassword(current_password, user.password)) {
      return res.status(400).json({ success: false, error: 'Joriy parol noto‘g‘ri' });
    }
    if (verifyPassword(new_password, user.password)) {
      return res.status(400).json({ success: false, error: 'Yangi parol joriy paroldan farq qilishi kerak' });
    }

    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashPassword(new_password), req.user.id]);
    await db.run(
      'DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?',
      [req.user.id, req.sessionTokenHash]
    );
    res.json({ success: true, message: 'Parol muvaffaqiyatli almashtirildi' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/stats', async (req, res) => {
  if (req.user.role === 'courier') {
    return res.status(403).json({ success: false, error: 'Statistika faqat boshqaruv uchun mavjud' });
  }
  try {
    const stats = await db.get(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'yangi' THEN 1 ELSE 0 END) as new_orders,
        SUM(CASE WHEN status = 'yuvishda' THEN 1 ELSE 0 END) as washing_orders,
        SUM(CASE WHEN status = 'yetkazilmoqda' THEN 1 ELSE 0 END) as delivering_orders,
        SUM(CASE WHEN status = 'yetkazildi' THEN 1 ELSE 0 END) as completed_orders,
        COALESCE(SUM(final_amount), 0) as total_revenue,
        COALESCE(SUM(paid_amount), 0) as total_paid,
        COALESCE(SUM(total_area), 0) as total_sqm,
        COALESCE(SUM(total_items), 0) as total_items
      FROM orders
    `);

    const courierRow = await db.get(`SELECT COUNT(*) as count FROM users WHERE role = 'courier'`);
    const customerRow = await db.get(`SELECT COUNT(*) as count FROM customers`);

    const data = {
      ...stats,
      debt_amount: (stats.total_revenue || 0) - (stats.total_paid || 0),
      couriersCount: courierRow ? courierRow.count : 0,
      customersCount: customerRow ? customerRow.count : 0
    };
    if (req.user.role !== 'owner') {
      delete data.total_revenue;
      delete data.total_paid;
      delete data.debt_amount;
    }
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= BUYURTMALAR (ORDERS) =================
app.get('/api/orders', async (req, res) => {
  try {
    const { status, courier_id, search } = req.query;
    let query = `
      SELECT o.*, 
        c.full_name as customer_name, c.phone as customer_phone, c.address as customer_address, c.landmark,
        u1.full_name as courier_pickup_name, u2.full_name as courier_deliv_name
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u1 ON o.courier_pickup_id = u1.id
      LEFT JOIN users u2 ON o.courier_delivery_id = u2.id
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      query += ` AND o.status = ?`;
      params.push(status);
    }

    if (courier_id && courier_id !== 'all') {
      query += ` AND (o.courier_pickup_id = ? OR o.courier_delivery_id = ?)`;
      params.push(courier_id, courier_id);
    }

    if (req.user.role === 'courier') {
      query += ` AND (o.courier_pickup_id = ? OR o.courier_delivery_id = ?)`;
      params.push(req.user.id, req.user.id);
    }

    if (search) {
      query += ` AND (o.order_number LIKE ? OR c.full_name LIKE ? OR c.phone LIKE ? OR c.address LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    query += ` ORDER BY o.id DESC`;
    const orders = await db.all(query, params);

    // Har bir buyurtmaning itemlarini ham yuklash
    const enriched = await Promise.all(orders.map(async ord => {
      const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [ord.id]);
      if (req.user.role === 'courier') delete ord.admin_notes;
      return {
        ...ord,
        items
      };
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const order = await db.get(`
      SELECT o.*, 
        c.full_name as customer_name, c.phone as customer_phone, c.phone2, c.address as customer_address, c.landmark,
        u1.full_name as courier_pickup_name, u1.phone as courier_pickup_phone,
        u2.full_name as courier_deliv_name, u2.phone as courier_deliv_phone
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u1 ON o.courier_pickup_id = u1.id
      LEFT JOIN users u2 ON o.courier_delivery_id = u2.id
      WHERE o.id = ?
    `, [req.params.id]);

    if (!order) return res.status(404).json({ success: false, error: "Buyurtma topilmadi" });
    if (!canAccessOrder(req.user, order)) {
      return res.status(403).json({ success: false, error: 'Bu buyurtmaga ruxsatingiz yo‘q' });
    }
    if (req.user.role === 'courier') delete order.admin_notes;

    const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [order.id]);
    res.json({ success: true, data: { ...order, items } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Yangi buyurtma yaratish
app.post('/api/orders', async (req, res) => {
  try {
    const {
      customer_name,
      customer_phone,
      customer_phone2,
      customer_address,
      landmark,
      latitude,
      longitude,
      location_address,
      defect_tags,
      courier_pickup_id,
      courier_delivery_id,
      items,
      discount = 0,
      paid_amount = 0,
      payment_method = 'naqd',
      pickup_date,
      target_delivery_date,
      courier_notes,
      admin_notes
    } = req.body;

    if (typeof customer_name !== 'string' || !customer_name.trim() ||
        typeof customer_phone !== 'string' || !customer_phone.trim() ||
        typeof customer_address !== 'string' || !customer_address.trim() ||
        customer_name.length > 120 || customer_phone.length > 40 || customer_address.length > 500 ||
        !Array.isArray(items) || items.length === 0 || items.length > 100) {
      return res.status(400).json({ success: false, error: "Kerakli maydonlar to'ldirilmadi" });
    }

    // Hisob-kitoblar
    let totalArea = 0;
    let totalItems = 0;
    let totalAmount = 0;

    const processedItems = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') {
        return res.status(400).json({ success: false, error: 'Buyum ma’lumoti noto‘g‘ri' });
      }
      const len = Number(item.length || 0);
      const wid = Number(item.width || 0);
      const qty = item.quantity === undefined || item.quantity === null || item.quantity === ''
        ? 1
        : Number(item.quantity);
      const categoryId = Number(item.category_id);
      const category = Number.isInteger(categoryId)
        ? await db.get('SELECT id, name, price_per_unit FROM categories WHERE id = ?', [categoryId])
        : null;
      if (!category || !Number.isFinite(len) || !Number.isFinite(wid) ||
          len < 0 || len > 100 || wid < 0 || wid > 100 ||
          !Number.isInteger(qty) || qty < 1 || qty > 100 ||
          !Number.isFinite(category.price_per_unit) || category.price_per_unit < 0 ||
          ((len === 0) !== (wid === 0))) {
        return res.status(400).json({ success: false, error: 'Buyum o‘lchami, soni yoki kategoriyasi noto‘g‘ri' });
      }
      const price = category.price_per_unit;

      let area = 0;
      let subtotal = 0;

      if (len > 0 && wid > 0) {
        area = parseFloat((len * wid * qty).toFixed(2));
        subtotal = Math.round(area * price);
        totalArea += area;
      } else {
        subtotal = Math.round(qty * price);
      }
      if (!Number.isFinite(area) || !Number.isSafeInteger(subtotal)) {
        return res.status(400).json({ success: false, error: 'Buyum o‘lchami yoki narxi juda katta' });
      }
      totalItems += qty;
      totalAmount += subtotal;
      if (!Number.isSafeInteger(totalAmount) || !Number.isFinite(totalArea)) {
        return res.status(400).json({ success: false, error: 'Buyurtma summasi juda katta' });
      }

      processedItems.push({
        category_id: category.id,
        item_type: category.name,
        length: len,
        width: wid,
        area,
        quantity: qty,
        unit_price: price,
        subtotal,
        notes: typeof item.notes === 'string' ? item.notes.slice(0, 500) : ''
      });
    }

    const disc = req.user.role === 'courier' ? 0 : Number(discount);
    const paid = req.user.role === 'courier' ? 0 : Number(paid_amount);
    const effectivePaymentMethod = req.user.role === 'courier' ? 'naqd' : payment_method;
    if (!['naqd', 'click', 'payme', 'bank'].includes(effectivePaymentMethod)) {
      return res.status(400).json({ success: false, error: 'To‘lov usuli noto‘g‘ri' });
    }
    if (!Number.isFinite(disc) || disc < 0 || disc > totalAmount ||
        !Number.isFinite(paid) || paid < 0 || paid > totalAmount - disc) {
      return res.status(400).json({ success: false, error: 'Chegirma yoki to‘lov summasi noto‘g‘ri' });
    }
    const finalAmount = Math.max(0, totalAmount - disc);
    const paymentStatus = paid >= finalAmount ? 'tolandi' : (paid > 0 ? 'qisman' : 'kutilmoqda');

    const latitudeValue = latitude === null || latitude === undefined || latitude === ''
      ? null
      : Number(latitude);
    const longitudeValue = longitude === null || longitude === undefined || longitude === ''
      ? null
      : Number(longitude);
    if ((latitudeValue !== null && (!Number.isFinite(latitudeValue) || latitudeValue < -90 || latitudeValue > 90)) ||
        (longitudeValue !== null && (!Number.isFinite(longitudeValue) || longitudeValue < -180 || longitudeValue > 180)) ||
        ((latitudeValue === null) !== (longitudeValue === null))) {
      return res.status(400).json({ success: false, error: 'Lokatsiya koordinatalari noto‘g‘ri' });
    }

    // Mijoz ma’lumotlarini faqat buyurtma qiymatlari tekshirilgandan keyin saqlash
    let orderNumber;
    const orderId = await db.transaction(async transaction => {
      const counter = await transaction.get(
        'UPDATE counters SET value = value + 1 WHERE name = ? RETURNING value',
        ['order_number']
      );
      if (!counter) throw new Error('Buyurtma raqami hisoblagichi tayyor emas');
      orderNumber = `#GLM-${counter.value}`;

      let customer = await transaction.get('SELECT id FROM customers WHERE phone = ?', [customer_phone]);
      let customerId;
      if (customer) {
        customerId = customer.id;
        await transaction.run(`
          UPDATE customers SET full_name = ?, address = ?, landmark = ?, phone2 = ? WHERE id = ?
        `, [customer_name.trim(), customer_address.trim(), landmark || '', customer_phone2 || '', customerId]);
      } else {
        const newCustomer = await transaction.run(`
          INSERT INTO customers (full_name, phone, phone2, address, landmark)
          VALUES (?, ?, ?, ?, ?)
        `, [customer_name.trim(), customer_phone.trim(), customer_phone2 || '', customer_address.trim(), landmark || '']);
        customerId = newCustomer.lastID;
      }

      const insertResult = await transaction.run(`
        INSERT INTO orders (
          order_number, customer_id, courier_pickup_id, courier_delivery_id, status,
          total_area, total_items, total_amount, discount, final_amount, paid_amount,
          payment_method, payment_status, pickup_date, target_delivery_date, courier_notes, admin_notes,
          latitude, longitude, location_address, defect_tags
        ) VALUES (?, ?, ?, ?, 'yangi', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        orderNumber, customerId,
        req.user.role === 'courier' ? req.user.id : (courier_pickup_id || null),
        req.user.role === 'courier' ? null : (courier_delivery_id || courier_pickup_id || null),
        totalArea, totalItems, totalAmount, disc, finalAmount, paid,
        effectivePaymentMethod, paymentStatus, pickup_date || new Date().toISOString().slice(0, 10),
        target_delivery_date || '', courier_notes || '', req.user.role === 'courier' ? '' : (admin_notes || ''),
        latitudeValue, longitudeValue,
        typeof location_address === 'string' ? location_address.slice(0, 300) : '',
        typeof defect_tags === 'string' ? defect_tags.slice(0, 500) : ''
      ]);

      const orderId = insertResult.lastID;
      for (let idx = 0; idx < processedItems.length; idx++) {
        const item = processedItems[idx];
        const barcode = `${orderNumber}-${idx + 1}`;
        await transaction.run(`
          INSERT INTO order_items (
            order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          orderId, item.category_id, item.item_type, barcode,
          item.length, item.width, item.area, item.quantity, item.unit_price, item.subtotal, item.notes || ''
        ]);
      }

      if (paid > 0) {
        await transaction.run(`
          INSERT INTO transactions (order_id, type, category, amount, payment_method, description, created_by)
          VALUES (?, 'kirim', 'buyurtma_tolovi', ?, ?, ?, ?)
        `, [orderId, paid, effectivePaymentMethod, `${orderNumber} bo'yicha boshlang'ich to'lov`, req.user.id]);
      }
      return orderId;
    });

    // Order creation explicitly requests a Telegram message; notification failures must not undo the order.
    let telegramResult = null;
    try {
      const tgResult = await telegram.formatOrderMessage(orderId, 'new_order');
      if (tgResult && tgResult.text) {
        telegramResult = await telegram.sendTelegramMessage(tgResult.text, 'HTML', tgResult.location);
      } else {
        telegramResult = { success: false, error: 'Buyurtma uchun Telegram xabari tayyorlanmadi' };
      }
    } catch (telegramError) {
      console.error('New order Telegram notification failed:', telegramError);
      telegramResult = { success: false, error: 'Telegram xabari yuborilmadi' };
    }

    res.json({
      success: true,
      message: "Buyurtma muvaffaqiyatli yaratildi",
      orderId,
      orderNumber,
      telegram: telegramResult
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Holatni yangilash (Status change)
app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { status, courier_notes, paid_amount, payment_status } = req.body;
    const orderId = req.params.id;

    const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
    if (!order) return res.status(404).json({ success: false, error: "Buyurtma topilmadi" });
    if (!canAccessOrder(req.user, order)) {
      return res.status(403).json({ success: false, error: 'Bu buyurtmani o‘zgartirishga ruxsatingiz yo‘q' });
    }
    if (req.user.role === 'courier') {
      const canConfirmPickup =
        order.courier_pickup_id === req.user.id &&
        order.status === 'yangi' &&
        status === 'qabul_qilindi' &&
        paid_amount === undefined;
      const canUpdateDelivery =
        order.courier_delivery_id === req.user.id &&
        ['yetkazilmoqda', 'yetkazildi'].includes(status) &&
        (status !== 'yetkazilmoqda' || order.status === 'tayyor') &&
        (status !== 'yetkazildi' || order.status === 'yetkazilmoqda');
      if (!canConfirmPickup && !canUpdateDelivery) {
        return res.status(403).json({
          success: false,
          error: 'Kuryer faqat o‘zi olgan buyurtmani sexga topshirilgan deb, tayyor buyurtmani esa yetkazish holatiga o‘tkaza oladi'
        });
      }
    }
    if (!['yangi', 'qabul_qilindi', 'yuvishda', 'quritishda', 'tayyor', 'yetkazilmoqda', 'yetkazildi', 'bekor_qilindi'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Buyurtma holati noto‘g‘ri' });
    }

    let deliveredDate = order.delivered_date;
    if (status === 'yetkazildi' && !deliveredDate) {
      deliveredDate = new Date().toISOString().slice(0, 19).replace('T', ' ');
    }

    let updatedPaid = order.paid_amount;
    let updatedPayStatus = order.payment_status;

    if (req.user.role === 'courier' && status === 'yetkazildi' &&
        Number(paid_amount) !== order.final_amount) {
      return res.status(400).json({ success: false, error: 'Yetkazilgan buyurtma uchun to‘liq to‘lov summasini kiriting' });
    }

    if (paid_amount !== undefined) {
      updatedPaid = Number(paid_amount);
      if (!Number.isFinite(updatedPaid) || updatedPaid < order.paid_amount || updatedPaid > order.final_amount) {
        return res.status(400).json({ success: false, error: 'To‘lov summasi noto‘g‘ri' });
      }
      if (updatedPaid >= order.final_amount) updatedPayStatus = 'tolandi';
      else if (updatedPaid > 0) updatedPayStatus = 'qisman';
      else updatedPayStatus = 'kutilmoqda';

      const diff = updatedPaid - order.paid_amount;
      if (diff > 0) {
        await db.run(`
          INSERT INTO transactions (order_id, type, category, amount, payment_method, description, created_by)
          VALUES (?, 'kirim', 'buyurtma_tolovi', ?, ?, ?, ?)
        `, [orderId, diff, order.payment_method || 'naqd', `${order.order_number} to'liq/qisman to'lov`, req.user.id]);
      }
    }

    await db.run(`
      UPDATE orders 
      SET status = ?, courier_notes = COALESCE(?, courier_notes), 
          delivered_date = ?, paid_amount = ?, payment_status = ?
      WHERE id = ?
    `, [status, courier_notes || null, deliveredDate, updatedPaid, updatedPayStatus, orderId]);

    // Telegramga yuborish
    const tgResultObj = await telegram.formatOrderMessage(orderId, 'status_change');
    let tgResult = null;
    if (tgResultObj && tgResultObj.text) {
      tgResult = await telegram.sendTelegramMessage(tgResultObj.text, 'HTML', tgResultObj.location);
    }

    res.json({ success: true, message: "Holat muvaffaqiyatli yangilandi", telegram: tgResult });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Buyurtmaga kuryer biriktirish
app.patch('/api/orders/:id/assign-courier', async (req, res) => {
  if (req.user.role === 'courier') {
    return res.status(403).json({ success: false, error: 'Kuryer biriktirish uchun ruxsat yo‘q' });
  }
  try {
    const { courier_pickup_id, courier_delivery_id } = req.body;
    const order = await db.get('SELECT id FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });

    const pickupId = courier_pickup_id ? Number(courier_pickup_id) : null;
    const deliveryId = courier_delivery_id ? Number(courier_delivery_id) : null;
    if ((pickupId !== null && !Number.isInteger(pickupId)) ||
        (deliveryId !== null && !Number.isInteger(deliveryId))) {
      return res.status(400).json({ success: false, error: 'Kuryer tanlovi noto‘g‘ri' });
    }
    for (const courierId of [pickupId, deliveryId]) {
      if (courierId === null) continue;
      const courier = await db.get(
        "SELECT id FROM users WHERE id = ? AND role = 'courier' AND status = 'active'",
        [courierId]
      );
      if (!courier) return res.status(400).json({ success: false, error: 'Faol kuryerni tanlang' });
    }

    await db.run(`
      UPDATE orders 
      SET courier_pickup_id = COALESCE(?, courier_pickup_id),
          courier_delivery_id = COALESCE(?, courier_delivery_id)
      WHERE id = ?
    `, [pickupId, deliveryId, req.params.id]);

    const tgMsg = await telegram.formatOrderMessage(req.params.id, 'courier_assigned');
    if (tgMsg) await telegram.sendTelegramMessage(tgMsg.text, 'HTML', tgMsg.location);

    res.json({ success: true, message: "Dastavchik muvaffaqiyatli biriktirildi" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Buyurtmani o'chirish (Faqat Ega admin)
app.delete('/api/orders/:id', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Faqat egasi buyurtmani o‘chira oladi' });
  }
  try {
    await db.run('DELETE FROM order_items WHERE order_id = ?', [req.params.id]);
    await db.run('DELETE FROM transactions WHERE order_id = ?', [req.params.id]);
    await db.run('DELETE FROM orders WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: "Buyurtma o'chirildi" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= KATEGORIYALAR VA XIZMATLAR =================
app.get('/api/categories', async (req, res) => {
  try {
    const categories = await db.all('SELECT * FROM categories ORDER BY id ASC');
    res.json({ success: true, data: categories });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/categories', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Faqat egasi xizmatlarni boshqara oladi' });
  }
  try {
    const { name, unit, price_per_unit, description, icon } = req.body;
    if (typeof name !== 'string' || !name.trim() ||
        !['kv_m', 'dona'].includes(unit) ||
        !Number.isFinite(Number(price_per_unit)) || Number(price_per_unit) < 0) {
      return res.status(400).json({ success: false, error: 'Xizmat nomi, birligi yoki narxi noto‘g‘ri' });
    }
    const resInsert = await db.run(`
      INSERT INTO categories (name, unit, price_per_unit, description, icon)
      VALUES (?, ?, ?, ?, ?)
    `, [name.trim(), unit, Number(price_per_unit), description || '', icon || '🧺']);
    res.json({ success: true, id: resInsert.lastID });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/categories/:id', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Faqat egasi xizmatlarni boshqara oladi' });
  }
  try {
    const { name, unit, price_per_unit, description, icon } = req.body;
    if (typeof name !== 'string' || !name.trim() ||
        !['kv_m', 'dona'].includes(unit) ||
        !Number.isFinite(Number(price_per_unit)) || Number(price_per_unit) < 0) {
      return res.status(400).json({ success: false, error: 'Xizmat nomi, birligi yoki narxi noto‘g‘ri' });
    }
    await db.run(`
      UPDATE categories 
      SET name = ?, unit = ?, price_per_unit = ?, description = ?, icon = ?
      WHERE id = ?
    `, [name.trim(), unit, Number(price_per_unit), description, icon, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= FOYDALANUVCHILAR (ADMIN, DASTAVCHIK) =================
app.get('/api/users', async (req, res) => {
  if (req.user.role === 'courier') {
    return res.status(403).json({ success: false, error: 'Xodimlar ro‘yxati uchun ruxsat yo‘q' });
  }
  try {
    const { role } = req.query;
    let query = 'SELECT id, username, full_name, role, phone, car_model, car_number, status, created_at FROM users WHERE 1=1';
    const params = [];
    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }
    const users = await db.all(query, params);
    res.json({ success: true, data: users });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Faqat egasi xodim qo‘sha oladi' });
  }
  try {
    const { username, password, full_name, role, phone, car_model, car_number } = req.body;
    if (typeof username !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username) ||
        typeof password !== 'string' || password.length < 8 || password.length > 256 ||
        typeof full_name !== 'string' || !full_name.trim() ||
        !['admin', 'courier'].includes(role || 'courier')) {
      return res.status(400).json({ success: false, error: 'Login (3+ belgi), ism, rol va kamida 8 belgili parol talab qilinadi' });
    }
    const insert = await db.run(`
      INSERT INTO users (username, password, full_name, role, phone, car_model, car_number)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [username.trim(), hashPassword(password), full_name.trim(), role || 'courier', phone || '', car_model || '', car_number || '']);
    res.json({ success: true, id: insert.lastID });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= TELEGRAM GURUHIGA TO'G'RIDAN TO'G'RI YUBORISH VA SOZLAMALAR =================
app.get('/api/settings', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Sozlamalarni ko‘rish uchun ruxsat yo‘q' });
  }
  try {
    const rows = await db.all('SELECT * FROM settings');
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Sozlamalarni o‘zgartirish uchun ruxsat yo‘q' });
  }
  try {
    const { bot_token, group_chat_id, company_name, company_phone, company_address, auto_send_telegram } = req.body;
    if (bot_token !== undefined) await telegram.setSetting('bot_token', bot_token);
    if (group_chat_id !== undefined) await telegram.setSetting('group_chat_id', group_chat_id);
    if (company_name !== undefined) await telegram.setSetting('company_name', company_name);
    if (company_phone !== undefined) await telegram.setSetting('company_phone', company_phone);
    if (company_address !== undefined) await telegram.setSetting('company_address', company_address);
    if (auto_send_telegram !== undefined) await telegram.setSetting('auto_send_telegram', String(auto_send_telegram));

    res.json({ success: true, message: "Sozlamalar saqlandi" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/telegram/test', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Faqat egasi test xabar yubora oladi' });
  }
  try {
    const testMsg = `🚀 <b>TOZA GILAM BOSHQARUV TIZIMI TEST XABARI</b>\n\nTelegram Bot va Guruh aloqasi muvaffaqiyatli ishlayapti!\nSana: ${new Date().toLocaleString('uz-UZ')}`;
    const result = await telegram.sendTelegramMessage(testMsg);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/orders/:id/send-telegram', async (req, res) => {
  try {
    const order = await db.get('SELECT courier_pickup_id, courier_delivery_id FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
    if (!canAccessOrder(req.user, order)) {
      return res.status(403).json({ success: false, error: 'Bu buyurtmaga ruxsatingiz yo‘q' });
    }
    const tgResultObj = await telegram.formatOrderMessage(req.params.id);
    if (!tgResultObj || !tgResultObj.text) return res.status(404).json({ success: false, error: "Buyurtma topilmadi" });
    const result = await telegram.sendTelegramMessage(tgResultObj.text, 'HTML', tgResultObj.location);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/telegram/logs', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Telegram jurnalini ko‘rish uchun ruxsat yo‘q' });
  }
  try {
    const logs = await db.all('SELECT * FROM telegram_logs ORDER BY id DESC LIMIT 50');
    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ================= HISOBOTLARNI EXCEL VA WORD DA YUKLAB OLISH =================
app.get('/api/reports/excel', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Moliyaviy hisobot faqat egasi uchun mavjud' });
  }
  try {
    const buffer = await reports.generateOrdersExcel();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Gilam_Yuvish_Hisobot_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/reports/word/:id', async (req, res) => {
  try {
    const order = await db.get('SELECT courier_pickup_id, courier_delivery_id FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
    if (!canAccessOrder(req.user, order) && req.user.role !== 'owner' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Bu buyurtma kvitansiyasiga ruxsatingiz yo‘q' });
    }
    const buffer = await reports.generateOrderDocx(req.params.id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Kvitansiya_${req.params.id}.docx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/reports/word-summary', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Moliyaviy hisobot faqat egasi uchun mavjud' });
  }
  try {
    const buffer = await reports.generateGeneralReportDocx();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Umumiy_Hisobot_${Date.now()}.docx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

async function getHttpsCredentials() {
  const customCertPath = process.env.TLS_CERT_PATH;
  const customKeyPath = process.env.TLS_KEY_PATH;
  if (Boolean(customCertPath) !== Boolean(customKeyPath)) {
    throw new Error('TLS_CERT_PATH va TLS_KEY_PATH ikkalasi ham birga ko‘rsatilishi kerak');
  }

  const certPath = customCertPath || path.join(os.homedir(), '.toza-gilam', 'localhost-cert.pem');
  const keyPath = customKeyPath || path.join(os.homedir(), '.toza-gilam', 'localhost-key.pem');
  const certDirectory = path.dirname(certPath);
  if (!customCertPath) fs.mkdirSync(certDirectory, { recursive: true, mode: 0o700 });

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const cert = fs.readFileSync(certPath);
    const x509 = new crypto.X509Certificate(cert);
    if (Date.parse(x509.validTo) > Date.now() + 24 * 60 * 60 * 1000) {
      return { cert, key: fs.readFileSync(keyPath), certPath };
    }
  } else if (customCertPath) {
    throw new Error('TLS sertifikat yoki kalit fayli topilmadi');
  }

  const generated = await selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    {
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
      notBeforeDate: new Date(Date.now() - 60 * 60 * 1000),
      notAfterDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      extensions: [
        { name: 'basicConstraints', cA: false, critical: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' }
          ]
        }
      ]
    }
  );

  fs.writeFileSync(certPath, generated.cert, { mode: 0o644 });
  fs.writeFileSync(keyPath, generated.private, { mode: 0o600 });
  console.log(`Mahalliy HTTPS sertifikati yaratildi: ${certPath}`);
  return { cert: generated.cert, key: generated.private, certPath };
}

async function startServer() {
  await initializeApp();
  const credentials = await getHttpsCredentials();
  const server = https.createServer({ cert: credentials.cert, key: credentials.key }, app);
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`3000-port (${PORT}) band. Eski server oynasida Ctrl+C bosing, keyin npm start ni qayta bajaring.`);
    } else {
      console.error('HTTPS serverni ishga tushirish xatosi:', err);
    }
    process.exit(1);
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Gilam yuvish boshqaruv tizimi https://localhost:${PORT} da ishga tushdi`);
    console.log('Eslatma: mahalliy o‘z-o‘zini imzolagan sertifikat uchun brauzer ogohlantirishi mumkin.');
  });
}

if (require.main === module) {
  startServer().catch(err => {
  console.error("Serverni ishga tushirish xatosi:", err);
  process.exitCode = 1;
  });
}

app.initializeApp = initializeApp;
module.exports = app;
