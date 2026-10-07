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
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
     req.path === '/telegram/setup' ||
     req.path === '/owner-notifications/read' ||
     /^\/users\/\d+\/reset-password$/.test(req.path) ||
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

function getTashkentDayRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const date = `${values.year}-${values.month}-${values.day}`;
  const start = new Date(Date.UTC(year, month - 1, day) - 5 * 60 * 60 * 1000);
  const end = new Date(Date.UTC(year, month - 1, day + 1) - 5 * 60 * 60 * 1000);
  const toDatabaseTimestamp = value => value.toISOString().slice(0, 19).replace('T', ' ');
  return { date, start: toDatabaseTimestamp(start), end: toDatabaseTimestamp(end) };
}

async function claimUnexportedOrders(batchId, exportedBy = null) {
  return db.transaction(async transaction => {
    const pending = await transaction.all(`
      SELECT o.id FROM orders o
      LEFT JOIN order_exports e ON e.order_id = o.id
      WHERE e.order_id IS NULL
      ORDER BY o.id ASC
    `);
    const claimed = [];
    for (const order of pending) {
      const result = await transaction.run(`
        INSERT INTO order_exports (order_id, batch_id, exported_by)
        VALUES (?, ?, ?)
        ON CONFLICT(order_id) DO NOTHING
      `, [order.id, batchId, exportedBy]);
      if (result.changes === 1) claimed.push(order.id);
    }
    return claimed;
  });
}

async function releaseExportClaim(batchId) {
  await db.run('DELETE FROM order_exports WHERE batch_id = ?', [batchId]);
}

app.get('/api/auth/captcha', async (req, res) => {
  try {
    const now = Date.now();
    await db.run('DELETE FROM login_captchas WHERE expires_at <= ?', [now]);
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const answer = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
    const challengeId = crypto.randomBytes(24).toString('base64url');
    const ipHash = hashToken(req.ip || req.socket.remoteAddress || 'unknown');
    const answerHash = hashToken(`${challengeId}:${answer.toLowerCase()}`);
    const characters = answer.split('').map((character, index) => {
      const x = 38 + index * 48;
      const rotation = crypto.randomInt(-16, 17);
      const y = crypto.randomInt(48, 72);
      return `<text x="${x}" y="${y}" transform="rotate(${rotation} ${x} ${y})">${character}</text>`;
    }).join('');
    const lines = Array.from({ length: 7 }, () => {
      const x1 = crypto.randomInt(0, 280);
      const y1 = crypto.randomInt(0, 90);
      const x2 = crypto.randomInt(0, 280);
      const y2 = crypto.randomInt(0, 90);
      return `<path d="M${x1} ${y1}L${x2} ${y2}"/>`;
    }).join('');
    const dots = Array.from({ length: 35 }, () =>
      `<circle cx="${crypto.randomInt(0, 280)}" cy="${crypto.randomInt(0, 90)}" r="${crypto.randomInt(1, 3)}"/>`
    ).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="90" viewBox="0 0 280 90"><rect width="280" height="90" rx="14" fill="#111827"/><g fill="none" stroke="#64748b" stroke-width="1">${lines}</g><g fill="#94a3b8">${dots}</g><g fill="#fff" font-family="monospace" font-size="40" font-weight="700" letter-spacing="4">${characters}</g></svg>`;
    await db.run(`
      INSERT INTO login_captchas (challenge_id, ip_hash, answer_hash, expires_at, attempts)
      VALUES (?, ?, ?, ?, 0)
    `, [challengeId, ipHash, answerHash, now + 5 * 60 * 1000]);
    const challenge = { id: challengeId, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}` };
    if (process.env.NODE_ENV === 'test') challenge.test_answer = answer;
    res.json({ success: true, data: challenge });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ================= LOGIN VA AUTORIZATSIYA =================
app.post('/api/auth/login', async (req, res) => {
  try {
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const now = Date.now();
    const loginIpHash = hashToken(req.ip || req.socket.remoteAddress || 'unknown');
    const captchaId = typeof req.body.captcha_id === 'string' ? req.body.captcha_id : '';
    const captchaAnswer = typeof req.body.captcha_answer === 'string'
      ? req.body.captcha_answer.trim().toLowerCase()
      : '';
    const captcha = captchaId && await db.get(
      'SELECT answer_hash, ip_hash, expires_at, attempts FROM login_captchas WHERE challenge_id = ?',
      [captchaId]
    );
    if (!captcha || captcha.ip_hash !== loginIpHash || captcha.expires_at <= now || captcha.attempts >= 5) {
      if (captchaId) await db.run('DELETE FROM login_captchas WHERE challenge_id = ?', [captchaId]);
      return res.status(400).json({ success: false, error: 'Tekshirish rasmi eskirgan. Yangi kod oling.' });
    }
    const suppliedCaptchaHash = Buffer.from(hashToken(`${captchaId}:${captchaAnswer}`), 'hex');
    const storedCaptchaHash = Buffer.from(captcha.answer_hash, 'hex');
    if (suppliedCaptchaHash.length !== storedCaptchaHash.length ||
        !crypto.timingSafeEqual(suppliedCaptchaHash, storedCaptchaHash)) {
      const nextAttempts = captcha.attempts + 1;
      if (nextAttempts >= 5) {
        await db.run('DELETE FROM login_captchas WHERE challenge_id = ?', [captchaId]);
      } else {
        await db.run('UPDATE login_captchas SET attempts = ? WHERE challenge_id = ?', [nextAttempts, captchaId]);
      }
      return res.status(400).json({ success: false, error: 'Tekshirish kodi noto‘g‘ri. Yangi rasmni tekshirib qayta kiriting.' });
    }
    await db.run('DELETE FROM login_captchas WHERE challenge_id = ?', [captchaId]);
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
      'INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip_address) VALUES (?, ?, ?, ?, ?)',
      [hashToken(token), user.id, expiresAt, String(req.get('user-agent') || '').slice(0, 500), String(req.ip || '').slice(0, 100)]
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
      [session.user_id]
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

app.post('/api/telegram/webhook', async (req, res) => {
  try {
    const expectedSecret = await telegram.getSetting('telegram_webhook_secret');
    const receivedSecret = req.get('x-telegram-bot-api-secret-token') || '';
    const expectedBuffer = Buffer.from(expectedSecret || '');
    const receivedBuffer = Buffer.from(receivedSecret);
    if (!expectedSecret || expectedBuffer.length !== receivedBuffer.length ||
        !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)) {
      return res.status(403).json({ success: false, error: 'Telegram webhook maxfiy kaliti noto‘g‘ri' });
    }
    const result = await telegram.processTelegramUpdate(req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Telegram webhook xatosi:', error.message);
    res.status(500).json({ success: false, error: 'Telegram yangilanishini qayta ishlashda xato' });
  }
});

app.get('/api/cron/daily-reports', async (req, res) => {
  const secret = process.env.CRON_SECRET || '';
  const authorization = req.get('authorization') || '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(authorization);
  if (!secret || expected.length !== provided.length ||
      !crypto.timingSafeEqual(expected, provided)) {
    return res.status(secret ? 401 : 503).json({ success: false, error: 'Hisobot cron kaliti sozlanmagan yoki noto‘g‘ri' });
  }
  try {
    const range = getTashkentDayRange();
    const batchId = `daily-${range.date}-${crypto.randomUUID()}`;
    const orderIds = await claimUnexportedOrders(batchId);
    try {
      const [excel, word] = await Promise.all([
        reports.generateOrdersExcel({ orderIds }),
        reports.generateDailyReportDocx(range.date, range.start, range.end)
      ]);
      const delivery = await telegram.sendReportsToAdmins([
        { name: `OSAF_Kunlik_${range.date}.xlsx`, buffer: excel },
        { name: `OSAF_Kunlik_${range.date}.docx`, buffer: word }
      ], `OSAF kunlik hisobot — ${range.date}; Excel ichida ${orderIds.length} yangi eksport qilinmagan buyurtma.`);
      if (delivery.simulated) {
        await releaseExportClaim(batchId);
        return res.status(503).json({ success: false, error: 'Telegram bot tokeni yoki ega/admin chat ID si sozlanmagan' });
      }
      res.json({ success: true, date: range.date, exported_orders: orderIds.length, recipients: delivery.recipients });
    } catch (error) {
      await releaseExportClaim(batchId);
      throw error;
    }
  } catch (error) {
    console.error('Kunlik Telegram hisobotini yuborish xatosi:', error.message);
    res.status(500).json({ success: false, error: error.message });
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
    if (user.role === 'washer' &&
        !(req.method === 'GET' && req.path === '/auth/me') &&
        !(req.method === 'POST' && ['/auth/logout', '/auth/change-password'].includes(req.path)) &&
        !(req.method === 'GET' && req.path === '/washer/orders') &&
        !(/^\/washer\/orders\/\d+\/(status|measurements)$/.test(req.path) && req.method === 'POST')) {
      return res.status(403).json({ success: false, error: 'Yuvuvchi faqat yuvish ish maydonidan foydalanishi mumkin' });
    }
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/api/owner-notifications', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Bildirishnomalarni faqat egasi ko‘ra oladi' });
  }
  try {
    const notifications = await db.all(`
      SELECT id, order_id, title, message, is_read, created_at
      FROM owner_notifications
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 30
    `, [req.user.id]);
    res.json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/owner-notifications/read', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Bildirishnomalarni faqat egasi boshqara oladi' });
  }
  try {
    await db.run('UPDATE owner_notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0', [req.user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/washer/orders', async (req, res) => {
  if (req.user.role !== 'washer') {
    return res.status(403).json({ success: false, error: 'Bu ish maydoni faqat yuvuvchi uchun' });
  }
  try {
    const orders = await db.all(`
      SELECT id, order_number, status, created_at
      FROM orders
      WHERE status IN ('qabul_qilindi', 'yuvishda', 'quritishda', 'qadoqlayapti')
      ORDER BY id DESC
    `);
    const data = await Promise.all(orders.map(async order => ({
      ...order,
      items: await db.all(`
        SELECT oi.id, oi.item_type, oi.length, oi.width, oi.area, oi.quantity, oi.notes,
          c.unit
        FROM order_items oi
        JOIN categories c ON c.id = oi.category_id
        WHERE oi.order_id = ?
        ORDER BY oi.id
      `, [order.id])
    })));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/washer/orders/:id/status', async (req, res) => {
  if (req.user.role !== 'washer') {
    return res.status(403).json({ success: false, error: 'Bu amal faqat yuvuvchi uchun' });
  }
  try {
    const { status } = req.body;
    const order = await db.get('SELECT id, status FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
    const nextStatus = {
      qabul_qilindi: 'yuvishda',
      yuvishda: 'quritishda',
      quritishda: 'qadoqlayapti'
    }[order.status];
    if (status !== nextStatus) {
      return res.status(400).json({ success: false, error: 'Buyurtmani keyingi yuvish bosqichiga o‘tkazing' });
    }
    await db.run(`
      UPDATE orders
      SET status = ?,
          courier_delivery_id = CASE
            WHEN ? = 'qadoqlayapti' THEN COALESCE(courier_delivery_id, courier_pickup_id)
            ELSE courier_delivery_id
          END
      WHERE id = ?
    `, [status, status, order.id]);
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/washer/orders/:id/measurements', async (req, res) => {
  if (req.user.role !== 'washer') {
    return res.status(403).json({ success: false, error: 'Gilam o‘lchamini faqat yuvuvchi saqlay oladi' });
  }
  try {
    const measurements = req.body.measurements;
    if (!Array.isArray(measurements) || measurements.length > 500) {
      return res.status(400).json({ success: false, error: 'O‘lchamlar ro‘yxati noto‘g‘ri' });
    }
    const order = await db.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
    if (order.status !== 'qadoqlayapti') {
      return res.status(409).json({ success: false, error: 'O‘lchamlarni faqat qadoqlash bosqichida saqlash mumkin' });
    }

    const items = await db.all(`
      SELECT oi.id, oi.order_id, oi.unit_price, oi.subtotal, oi.quantity, oi.area, c.unit
      FROM order_items oi
      JOIN categories c ON c.id = oi.category_id
      WHERE oi.order_id = ?
      ORDER BY oi.id
    `, [order.id]);
    if (measurements.length !== items.length) {
      return res.status(400).json({ success: false, error: 'Har bir buyum uchun o‘lcham va narxni yuboring' });
    }

    const byId = new Map();
    for (const measurement of measurements) {
      const id = Number(measurement && measurement.id);
      const length = Number(measurement && measurement.length);
      const width = Number(measurement && measurement.width);
      const unitPrice = Number(measurement && measurement.unit_price);
      if (!Number.isInteger(id) || !Number.isFinite(length) || !Number.isFinite(width) ||
          !Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1000000000 ||
          length < 0 || width < 0 || length > 100 || width > 100 || byId.has(id)) {
        return res.status(400).json({ success: false, error: 'O‘lcham yoki narx noto‘g‘ri; narx manfiy, o‘lcham 100 metrdan katta bo‘lmasin' });
      }
      byId.set(id, { length, width, unit_price: unitPrice });
    }
    if (items.some(item => !byId.has(item.id) ||
        (item.unit === 'kv_m' && (byId.get(item.id).length <= 0 || byId.get(item.id).width <= 0)) ||
        (item.unit !== 'kv_m' && (byId.get(item.id).length !== 0 || byId.get(item.id).width !== 0)))) {
      return res.status(400).json({ success: false, error: 'Gilamlarning uzunligi/enini va har bir buyum narxini kiriting' });
    }

    let totalArea = 0;
    let totalAmount = 0;
    await db.transaction(async transaction => {
      for (const item of items) {
        const measurement = byId.get(item.id);
        const area = measurement
          ? item.unit === 'kv_m'
            ? Math.round(measurement.length * measurement.width * Number(item.quantity || 1) * 100) / 100
            : 0
          : Number(item.area || 0);
        const subtotal = measurement
          ? Math.round(measurement.unit_price * (item.unit === 'kv_m' ? area : Number(item.quantity || 1)))
          : Number(item.subtotal);
        if (!Number.isFinite(area) || !Number.isSafeInteger(subtotal) || subtotal < 0) {
          throw new Error('O‘lcham bo‘yicha summa juda katta');
        }
        if (measurement) {
          await transaction.run(`
            UPDATE order_items SET length = ?, width = ?, area = ?, unit_price = ?, subtotal = ?
            WHERE id = ? AND order_id = ?
          `, [measurement.length, measurement.width, area, measurement.unit_price, subtotal, item.id, order.id]);
        }
        if (item.unit === 'kv_m') totalArea += area;
        totalAmount += subtotal;
        if (!Number.isFinite(totalArea) || !Number.isSafeInteger(totalAmount)) {
          throw new Error('Buyurtma o‘lchami yoki umumiy narxi juda katta');
        }
      }
      totalArea = Math.round(totalArea * 100) / 100;
      totalAmount = Math.round(totalAmount * 100) / 100;
      const finalAmount = Math.max(0, totalAmount - Number(order.discount || 0));
      if (finalAmount < Number(order.paid_amount || 0)) {
        throw new Error('Yangi o‘lcham bo‘yicha jami summa oldindan to‘langan summadan kam');
      }
      const paymentStatus = finalAmount > 0 && Number(order.paid_amount || 0) >= finalAmount
        ? 'tolandi'
        : Number(order.paid_amount || 0) > 0
          ? 'qisman'
          : 'kutilmoqda';
      await transaction.run(`
        UPDATE orders
        SET total_area = ?, total_amount = ?, final_amount = ?, payment_status = ?
        WHERE id = ?
      `, [totalArea, totalAmount, finalAmount, paymentStatus, order.id]);
    });
    const readyOrder = await db.get(
      'SELECT courier_delivery_id FROM orders WHERE id = ?',
      [order.id]
    );
    res.json({
      success: true,
      status: 'qadoqlayapti',
      courier_delivery_id: readyOrder.courier_delivery_id,
      total_area: totalArea,
      total_amount: totalAmount
    });
  } catch (error) {
    const isMeasurementError = [
      'Yangi o‘lcham bo‘yicha jami summa oldindan to‘langan summadan kam',
      'O‘lcham bo‘yicha summa juda katta',
      'Buyurtma o‘lchami yoki umumiy narxi juda katta'
    ].includes(error.message);
    res.status(isMeasurementError ? 400 : 500).json({ success: false, error: error.message });
  }
});

app.get('/api/sessions', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Faol qurilmalarni faqat egasi ko‘ra oladi' });
  }
  try {
    const sessions = await db.all(`
      SELECT s.token_hash AS session_id, s.user_id, s.created_at, s.expires_at, s.user_agent, s.ip_address,
        u.username, u.full_name, u.role
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > ?
      ORDER BY s.created_at DESC
    `, [Date.now()]);
    res.json({ success: true, data: sessions });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/sessions/:sessionId', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Faol qurilmalarni faqat egasi boshqara oladi' });
  }
  try {
    if (!/^[a-f0-9]{64}$/.test(req.params.sessionId)) {
      return res.status(400).json({ success: false, error: 'Sessiya raqami noto‘g‘ri' });
    }
    const removed = await db.run('DELETE FROM sessions WHERE token_hash = ?', [req.params.sessionId]);
    if (!removed.changes) return res.status(404).json({ success: false, error: 'Faol sessiya topilmadi' });
    res.json({ success: true, message: 'Qurilma tizimdan chiqarildi' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/sessions', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Faol qurilmalarni faqat egasi boshqara oladi' });
  }
  try {
    const removed = await db.run('DELETE FROM sessions WHERE user_id <> ?', [req.user.id]);
    res.json({ success: true, revoked: removed.changes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/users/:id/sessions', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Faol qurilmalarni faqat egasi boshqara oladi' });
  }
  try {
    const removed = await db.run('DELETE FROM sessions WHERE user_id = ?', [req.params.id]);
    res.json({ success: true, revoked: removed.changes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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
        SUM(CASE WHEN status IN ('yuvishda', 'quritishda', 'qadoqlayapti') THEN 1 ELSE 0 END) as washing_orders,
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
    const handoffs = await db.all(`
      SELECT h.assignment, h.notes, h.created_at,
        u1.full_name AS from_courier_name, u2.full_name AS to_courier_name
      FROM courier_handoffs h
      JOIN users u1 ON u1.id = h.from_courier_id
      JOIN users u2 ON u2.id = h.to_courier_id
      WHERE h.order_id = ?
      ORDER BY h.id DESC
    `, [order.id]);
    res.json({ success: true, data: { ...order, items, handoffs } });
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
      const qty = item.quantity === undefined || item.quantity === null || item.quantity === ''
        ? 1
        : Number(item.quantity);
      const categoryId = Number(item.category_id);
      const category = Number.isInteger(categoryId)
        ? await db.get('SELECT id, name, unit, price_per_unit FROM categories WHERE id = ?', [categoryId])
        : null;
      const len = req.user.role === 'courier' || !category || category.unit !== 'kv_m'
        ? 0
        : Number(item.length || 0);
      const wid = req.user.role === 'courier' || !category || category.unit !== 'kv_m'
        ? 0
        : Number(item.width || 0);
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
        subtotal = req.user.role === 'courier' && category.unit === 'kv_m'
          ? 0
          : Math.round(qty * price);
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
      const deliveryMeasurementsReady = order.status !== 'qadoqlayapti' || !await db.get(`
        SELECT oi.id
        FROM order_items oi
        JOIN categories c ON c.id = oi.category_id
        WHERE oi.order_id = ? AND c.unit = 'kv_m'
          AND (oi.length <= 0 OR oi.width <= 0 OR oi.area <= 0)
        LIMIT 1
      `, [orderId]);
      const canUpdateDelivery =
        order.courier_delivery_id === req.user.id &&
        ['yetkazilmoqda', 'yetkazildi'].includes(status) &&
        (status !== 'yetkazilmoqda' ||
          ['tayyor', 'qadoqlayapti'].includes(order.status) && deliveryMeasurementsReady) &&
        (status !== 'yetkazildi' || order.status === 'yetkazilmoqda');
      if (!canConfirmPickup && !canUpdateDelivery) {
        return res.status(403).json({
          success: false,
          error: 'Kuryer faqat o‘zi olgan buyurtmani sexga topshirilgan deb, tayyor buyurtmani esa yetkazish holatiga o‘tkaza oladi'
        });
      }
    }
    if (!['yangi', 'qabul_qilindi', 'yuvishda', 'quritishda', 'qadoqlayapti', 'tayyor', 'yetkazilmoqda', 'yetkazildi', 'bekor_qilindi'].includes(status)) {
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

    let dispatchNotification = null;
    let dispatchMessage = '';
    let ownerNotificationRows = [];
    const isCourierDispatch = req.user.role === 'courier' &&
      ['tayyor', 'qadoqlayapti'].includes(order.status) && status === 'yetkazilmoqda';
    if (isCourierDispatch) {
      const [owners, items] = await Promise.all([
        db.all("SELECT id FROM users WHERE role = 'owner' AND status = 'active'"),
        db.all('SELECT item_type, quantity, area FROM order_items WHERE order_id = ? ORDER BY id', [orderId])
      ]);
      const itemSummary = items.map(item => {
        const size = Number(item.area) > 0 ? ` — ${Number(item.area).toFixed(2)} m²` : '';
        return `${item.item_type} (${item.quantity} dona${size})`;
      }).join(', ');
      const notificationTitle = `${order.order_number}: dastavchik sexdan oldi`;
      const notificationMessage = `${req.user.full_name} buyurtmani sexdan olib, mijozga yetkazishga chiqdi. Buyumlar: ${itemSummary || 'ko‘rsatilmagan'}.`;
      ownerNotificationRows = owners.map(owner => [owner.id, orderId, notificationTitle, notificationMessage]);
      dispatchMessage =
        `🚚 <b>${telegram.escapeHtml(order.order_number)} — dastavchik sexdan oldi</b>\n` +
        `Dastavchik: ${telegram.escapeHtml(req.user.full_name)}\n` +
        `Buyumlar: ${telegram.escapeHtml(itemSummary || 'ko‘rsatilmagan')}\n` +
        `Holati: Yetkazilmoqda`;
    }

    await db.transaction(async transaction => {
      await transaction.run(`
        UPDATE orders
        SET status = ?, courier_notes = COALESCE(?, courier_notes),
            delivered_date = ?, paid_amount = ?, payment_status = ?
        WHERE id = ?
      `, [status, courier_notes || null, deliveredDate, updatedPaid, updatedPayStatus, orderId]);
      for (const notification of ownerNotificationRows) {
        await transaction.run(`
          INSERT INTO owner_notifications (user_id, order_id, title, message)
          VALUES (?, ?, ?, ?)
        `, notification);
      }
    });
    if (isCourierDispatch) dispatchNotification = await telegram.notifyOwner(dispatchMessage);

    // Telegramga yuborish
    const tgResultObj = await telegram.formatOrderMessage(orderId, 'status_change');
    let tgResult = null;
    if (tgResultObj && tgResultObj.text) {
      tgResult = await telegram.sendTelegramMessage(tgResultObj.text, 'HTML', tgResultObj.location);
    }

    const notificationFailures = dispatchNotification?.results?.filter(result => !result.success) || [];
    res.json({
      success: true,
      message: "Holat muvaffaqiyatli yangilandi",
      telegram: tgResult,
      notification_warning: notificationFailures.length
        ? 'Buyurtma holati saqlandi, lekin egaga Telegram xabari to‘liq yetkazilmadi'
        : null
    });
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

    const pickupProvided = Object.hasOwn(req.body, 'courier_pickup_id');
    const deliveryProvided = Object.hasOwn(req.body, 'courier_delivery_id');
    if (!pickupProvided && !deliveryProvided) {
      return res.status(400).json({ success: false, error: 'Kamida bitta kuryer maydonini yuboring' });
    }
    const pickupId = !pickupProvided || courier_pickup_id === '' || courier_pickup_id === null
      ? null
      : Number(courier_pickup_id);
    const deliveryId = !deliveryProvided || courier_delivery_id === '' || courier_delivery_id === null
      ? null
      : Number(courier_delivery_id);
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

    const fields = [];
    const params = [];
    if (pickupProvided) {
      fields.push('courier_pickup_id = ?');
      params.push(pickupId);
    }
    if (deliveryProvided) {
      fields.push('courier_delivery_id = ?');
      params.push(deliveryId);
    }
    params.push(req.params.id);
    await db.run(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`, params);

    const tgMsg = await telegram.formatOrderMessage(req.params.id, 'courier_assigned');
    if (tgMsg) await telegram.sendTelegramMessage(tgMsg.text, 'HTML', tgMsg.location);

    res.json({ success: true, message: "Dastavchik muvaffaqiyatli biriktirildi" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/couriers', async (req, res) => {
  try {
    const couriers = await db.all(
      "SELECT id, full_name FROM users WHERE role = 'courier' AND status = 'active' ORDER BY full_name"
    );
    res.json({ success: true, data: couriers });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/orders/:id/handoff', async (req, res) => {
  if (req.user.role !== 'courier') {
    return res.status(403).json({ success: false, error: 'Buyurtmani topshirish faqat kuryer uchun ruxsat etilgan' });
  }
  try {
    const assignment = req.body.assignment;
    const toCourierId = Number(req.body.to_courier_id);
    const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
    if (!['pickup', 'delivery'].includes(assignment) ||
        !Number.isInteger(toCourierId) || toCourierId < 1 ||
        (req.body.notes !== undefined && (typeof req.body.notes !== 'string' || notes.length > 500))) {
      return res.status(400).json({ success: false, error: 'Topshirish ma’lumotlari noto‘g‘ri' });
    }
    if (toCourierId === req.user.id) {
      return res.status(400).json({ success: false, error: 'Buyurtmani o‘zingizga topshira olmaysiz' });
    }

    const order = await db.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!order) return res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });
    const currentCourierId = assignment === 'pickup' ? order.courier_pickup_id : order.courier_delivery_id;
    const allowedStatuses = assignment === 'pickup'
      ? ['yangi', 'qabul_qilindi']
      : ['qabul_qilindi', 'yuvishda', 'quritishda', 'qadoqlayapti', 'tayyor', 'yetkazilmoqda'];
    if (currentCourierId !== req.user.id || !allowedStatuses.includes(order.status)) {
      return res.status(403).json({ success: false, error: 'Bu bosqichdagi buyurtmani topshirish huquqingiz yo‘q' });
    }

    const nextCourier = await db.get(
      "SELECT id, full_name, telegram_id FROM users WHERE id = ? AND role = 'courier' AND status = 'active'",
      [toCourierId]
    );
    if (!nextCourier) return res.status(400).json({ success: false, error: 'Faol kuryerni tanlang' });

    try {
      await db.transaction(async transaction => {
        const column = assignment === 'pickup' ? 'courier_pickup_id' : 'courier_delivery_id';
        const result = await transaction.run(
          `UPDATE orders SET ${column} = ? WHERE id = ? AND ${column} = ? AND status = ?`,
          [toCourierId, order.id, req.user.id, order.status]
        );
        if (result.changes !== 1) {
          const error = new Error('Buyurtma boshqa foydalanuvchi tomonidan o‘zgartirildi; yangilab qayta urinib ko‘ring');
          error.statusCode = 409;
          throw error;
        }
        await transaction.run(`
          INSERT INTO courier_handoffs (order_id, assignment, from_courier_id, to_courier_id, notes)
          VALUES (?, ?, ?, ?, ?)
        `, [order.id, assignment, req.user.id, toCourierId, notes || null]);
      });
    } catch (error) {
      if (error.statusCode === 409) {
        return res.status(409).json({ success: false, error: error.message });
      }
      throw error;
    }

    let notifications = [];
    let notificationWarning = null;
    try {
      const fromCourier = {
        id: req.user.id,
        full_name: req.user.full_name,
        telegram_id: (await db.get('SELECT telegram_id FROM users WHERE id = ?', [req.user.id]))?.telegram_id
      };
      notifications = await telegram.notifyCourierHandoff(order, assignment, fromCourier, nextCourier, notes);
    } catch (error) {
      notificationWarning = error.message;
      console.error('Buyurtma topshirish Telegram xabari yuborilmadi:', error.message);
    }
    const message = `Buyurtma ${nextCourier.full_name} kuryerga topshirildi`;
    res.json({ success: true, message, notifications, notification_warning: notificationWarning });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
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
        !['admin', 'courier', 'washer'].includes(role || 'courier')) {
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

app.post('/api/users/:id/reset-password', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Parolni faqat egasi tiklay oladi' });
  }
  try {
    const user = await db.get('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ success: false, error: 'Xodim topilmadi' });
    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, error: 'O‘z parolingizni profil oynasidan almashtiring' });
    }
    const temporaryPassword = crypto.randomBytes(18).toString('base64url');
    await db.transaction(async transaction => {
      await transaction.run('UPDATE users SET password = ? WHERE id = ?', [hashPassword(temporaryPassword), user.id]);
      await transaction.run('DELETE FROM sessions WHERE user_id = ?', [user.id]);
    });
    res.json({
      success: true,
      temporary_password: temporaryPassword,
      message: 'Yangi vaqtinchalik parol faqat hozir ko‘rsatiladi. Uni xodimga xavfsiz yetkazing.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/telegram/users', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Telegram hisoblarini faqat egasi ko‘ra oladi' });
  }
  try {
    const users = await db.all(`
      SELECT id, username, full_name, role, telegram_id
      FROM users
      WHERE status = 'active'
      ORDER BY role, full_name
    `);
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.patch('/api/telegram/users/:id', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Telegram hisoblarini faqat egasi boshqara oladi' });
  }
  try {
    const telegramId = req.body.telegram_id === null || req.body.telegram_id === ''
      ? null
      : String(req.body.telegram_id);
    if (telegramId !== null && !/^\d{1,20}$/.test(telegramId)) {
      return res.status(400).json({ success: false, error: 'Telegram ID faqat raqamlardan iborat bo‘lishi kerak' });
    }
    const user = await db.get('SELECT id FROM users WHERE id = ?', [req.params.id]);
    if (!user) return res.status(404).json({ success: false, error: 'Xodim topilmadi' });
    if (telegramId) {
      const duplicate = await db.get('SELECT id FROM users WHERE telegram_id = ? AND id <> ?', [telegramId, user.id]);
      if (duplicate) return res.status(409).json({ success: false, error: 'Bu Telegram ID boshqa xodimga bog‘langan' });
    }
    await db.run('UPDATE users SET telegram_id = ? WHERE id = ?', [telegramId, user.id]);
    res.json({ success: true, message: 'Telegram profili saqlandi' });
  } catch (error) {
    if (String(error.message).includes('users_telegram_id_unique_idx')) {
      return res.status(409).json({ success: false, error: 'Bu Telegram ID boshqa xodimga bog‘langan' });
    }
    res.status(500).json({ success: false, error: error.message });
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
    delete settings.telegram_webhook_secret;
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
    const { bot_token, group_chat_id, telegram_admin_id, company_name, company_phone, company_address, auto_send_telegram, order_number_start, app_url } = req.body;
    if (telegram_admin_id !== undefined && telegram_admin_id !== '' && !/^\d{1,20}$/.test(String(telegram_admin_id))) {
      return res.status(400).json({ success: false, error: 'Telegram ega/admin ID si faqat raqamlardan iborat bo‘lishi kerak' });
    }
    if (app_url !== undefined) {
      let parsedUrl;
      try {
        parsedUrl = new URL(String(app_url).trim());
      } catch {
        return res.status(400).json({ success: false, error: 'Ilova manzili noto‘g‘ri' });
      }
      if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password ||
          parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
        return res.status(400).json({ success: false, error: 'Ilova manzili HTTPS sayti bo‘lishi kerak (masalan https://osaf.vercel.app)' });
      }
    }
    if (order_number_start !== undefined) {
      const parsedStart = Number(order_number_start);
      if (!Number.isInteger(parsedStart) || parsedStart < 1 || parsedStart > 999999) {
        return res.status(400).json({ success: false, error: 'Buyurtma boshlang‘ich raqami 1 dan 999999 gacha bo‘lishi kerak' });
      }
      const currentMaxOrder = await db.get(
        "SELECT MAX(CAST(REPLACE(order_number, '#GLM-', '') AS INTEGER)) AS max_value FROM orders WHERE order_number LIKE '#GLM-%'"
      );
      const existingMaxValue = Number(currentMaxOrder?.max_value || 0);
      if (existingMaxValue > 0 && parsedStart <= existingMaxValue) {
        return res.status(400).json({ success: false, error: `Buyurtma boshlang‘ich raqami mavjud buyurtmalardan kichik bo‘lishi mumkin emas. Eng katta buyurtma raqami: #GLM-${existingMaxValue}` });
      }
      const nextCounterValue = Math.max(Number((await db.get('SELECT value FROM counters WHERE name = ?', ['order_number']))?.value || 0), parsedStart - 1);
      await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['order_number_start', String(parsedStart)]);
      await db.run('INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value', ['order_number', nextCounterValue]);
    }
    if (bot_token !== undefined) await telegram.setSetting('bot_token', bot_token);
    if (group_chat_id !== undefined) await telegram.setSetting('group_chat_id', group_chat_id);
    if (telegram_admin_id !== undefined) await telegram.setSetting('telegram_admin_id', String(telegram_admin_id));
    if (company_name !== undefined) await telegram.setSetting('company_name', company_name);
    if (company_phone !== undefined) await telegram.setSetting('company_phone', company_phone);
    if (company_address !== undefined) await telegram.setSetting('company_address', company_address);
    if (auto_send_telegram !== undefined) await telegram.setSetting('auto_send_telegram', String(auto_send_telegram));
    if (app_url !== undefined) await telegram.setSetting('app_url', String(app_url).trim().replace(/\/+$/, ''));

    res.json({ success: true, message: "Sozlamalar saqlandi" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/telegram/status', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Bot holatini faqat egasi ko‘ra oladi' });
  }
  try {
    const status = await telegram.getBotStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/telegram/setup', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Botni faqat egasi sozlay oladi' });
  }
  try {
    const result = await telegram.configureWebhook();
    res.json({ success: true, data: result, message: 'Telegram webhook muvaffaqiyatli ulandi' });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message });
  }
});

app.post('/api/telegram/test', async (req, res) => {
  if (req.user.role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Faqat egasi test xabar yubora oladi' });
  }
  try {
    const testMsg = `🚀 <b>OSAF GILAM YUVISH BOSHQARUV TIZIMI TEST XABARI</b>\n\nTelegram Bot va Guruh aloqasi muvaffaqiyatli ishlayapti!\nSana: ${new Date().toLocaleString('uz-UZ')}`;
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
    const batchId = `manual-${crypto.randomUUID()}`;
    const orderIds = await claimUnexportedOrders(batchId, req.user.id);
    if (!orderIds.length) {
      return res.status(204).json({ success: true, message: 'Yangi eksport qilinmagan buyurtmalar yo‘q', exported_orders: 0 });
    }
    try {
      const buffer = await reports.generateOrdersExcel({ orderIds });
      const delivery = await telegram.sendReportsToAdmins(
        [{ name: `OSAF_Buyurtmalar_${Date.now()}.xlsx`, buffer }],
        `OSAF Excel hisoboti: ${orderIds.length} ta yangi buyurtma.`
      );
      if (delivery.simulated) {
        await db.run(
          'INSERT INTO telegram_logs (chat_id, message, status) VALUES (?, ?, ?)',
          ['NOT_CONFIGURED', `Excel eksport qilindi: ${orderIds.length} ta buyurtma. Telegram qabul qiluvchi sozlanmagan.`, 'export_downloaded_telegram_not_configured']
        );
      }
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Gilam_Yuvish_Hisobot_${Date.now()}.xlsx"`);
      res.setHeader('X-Exported-Orders', String(orderIds.length));
      res.setHeader('X-Telegram-Sent', String(!delivery.simulated));
      return res.send(buffer);
    } catch (error) {
      await releaseExportClaim(batchId);
      throw error;
    }
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
