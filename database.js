// database.js - PostgreSQL on Vercel, SQLite for local development and tests
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { hashPassword } = require('./auth');
const { toPostgresSchema } = require('./database-sql');
const { createPostgresAdapter, withPostgresTransaction } = require('./database-postgres');

const dbPath = process.env.CARPET_DB_PATH || path.join(__dirname, 'carpet_system.db');
const connectionString = process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL;
const isPostgres = Boolean(connectionString);
if (process.env.VERCEL === '1' && !isPostgres) {
  throw new Error('Vercel muhitida doimiy PostgreSQL kerak. POSTGRES_URL yoki DATABASE_URL sozlang.');
}

let rawDb;
let pool;
const sqliteTransactionContext = new AsyncLocalStorage();
let sqliteQueryQueue = Promise.resolve();
if (isPostgres) {
  const { Pool, types } = require('pg');
  const poolMax = Number(process.env.PG_POOL_MAX || 1);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 10) {
    throw new Error('PG_POOL_MAX 1 dan 10 gacha butun son bo‘lishi kerak.');
  }
  if (process.env.VERCEL === '1' && process.env.PGSSLMODE === 'disable') {
    throw new Error('Vercel PostgreSQL ulanishi TLS bilan himoyalangan bo‘lishi kerak.');
  }
  const postgresUrl = new URL(connectionString);
  if (process.env.PGSSLMODE === 'disable') postgresUrl.searchParams.delete('sslmode');
  else postgresUrl.searchParams.set('sslmode', 'verify-full');
  types.setTypeParser(20, value => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : value;
  });
  types.setTypeParser(1082, value => value);
  types.setTypeParser(1114, value => value);
  types.setTypeParser(1184, value => value);
  pool = new Pool({
    connectionString: postgresUrl.toString(),
    max: poolMax,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: true }
  });
  pool.on('error', error => console.error('PostgreSQL pool error:', error));
} else {
  const sqlite3 = require('sqlite3').verbose();
  rawDb = new sqlite3.Database(dbPath);
}

const postgresDb = isPostgres ? createPostgresAdapter(pool) : null;

async function withSqliteQuery(operation) {
  if (sqliteTransactionContext.getStore()) return operation();
  const previous = sqliteQueryQueue;
  let release;
  sqliteQueryQueue = new Promise(resolve => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function sqliteExec(sql) {
  return new Promise((resolve, reject) => {
    rawDb.exec(sql, err => err ? reject(err) : resolve());
  });
}

// Qulay Promise wrapper
const db = {
  get: async (sql, params = []) => {
    if (isPostgres) return postgresDb.get(sql, params);
    return withSqliteQuery(() => new Promise((resolve, reject) => {
      rawDb.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    }));
  },
  all: async (sql, params = []) => {
    if (isPostgres) return postgresDb.all(sql, params);
    return withSqliteQuery(() => new Promise((resolve, reject) => {
      rawDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    }));
  },
  run: async (sql, params = []) => {
    if (isPostgres) return postgresDb.run(sql, params);
    return withSqliteQuery(() => new Promise((resolve, reject) => {
      rawDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    }));
  },
  exec: async sql => {
    if (isPostgres) {
      await pool.query(toPostgresSchema(sql));
      return;
    }
    return withSqliteQuery(() => sqliteExec(sql));
  },
  transaction: async operation => {
    if (!isPostgres) {
      return withSqliteQuery(async () => {
        await sqliteExec('BEGIN IMMEDIATE');
        try {
          const result = await sqliteTransactionContext.run(true, () => operation(db));
          await sqliteExec('COMMIT');
          return result;
        } catch (error) {
          await sqliteExec('ROLLBACK');
          throw error;
        }
      });
    }
    return withPostgresTransaction(pool, operation);
  },
  close: async () => {
    if (isPostgres) await pool.end();
    else await new Promise((resolve, reject) => rawDb.close(err => err ? reject(err) : resolve()));
  },
  driver: isPostgres ? 'postgres' : 'sqlite'
};

// Sxemalarni yaratish va boshlang'ich ma'lumotlarni kiritish
async function initDb() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL,
      phone TEXT,
      car_model TEXT,
      car_number TEXT,
      telegram_id TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      price_per_unit REAL NOT NULL,
      description TEXT,
      icon TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      phone2 TEXT,
      address TEXT NOT NULL,
      landmark TEXT,
      telegram_id TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL,
      courier_pickup_id INTEGER,
      courier_delivery_id INTEGER,
      status TEXT NOT NULL DEFAULT 'yangi',
      total_area REAL DEFAULT 0,
      total_items INTEGER DEFAULT 0,
      total_amount REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      final_amount REAL DEFAULT 0,
      paid_amount REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'naqd',
      payment_status TEXT DEFAULT 'kutilmoqda',
      pickup_date TEXT,
      target_delivery_date TEXT,
      delivered_date TEXT,
      courier_notes TEXT,
      admin_notes TEXT,
      latitude REAL,
      longitude REAL,
      location_address TEXT,
      defect_tags TEXT,
      rating INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      barcode TEXT,
      length REAL DEFAULT 0,
      width REAL DEFAULT 0,
      area REAL DEFAULT 0,
      quantity INTEGER DEFAULT 1,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      notes TEXT,
      status TEXT DEFAULT 'yangi'
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT DEFAULT 'naqd',
      description TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS telegram_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      chat_id TEXT,
      message TEXT,
      status TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS courier_handoffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      assignment TEXT NOT NULL,
      from_courier_id INTEGER NOT NULL,
      to_courier_id INTEGER NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS order_exports (
      order_id INTEGER PRIMARY KEY,
      batch_id TEXT NOT NULL,
      exported_by INTEGER,
      exported_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS telegram_updates (
      update_id BIGINT PRIMARY KEY,
      handled_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS login_captchas (
      challenge_id TEXT PRIMARY KEY,
      ip_hash TEXT NOT NULL,
      answer_hash TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at BIGINT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS login_attempts (
      ip_hash TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      first_attempt BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `);

  if (isPostgres) {
    await db.exec(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS latitude REAL;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS longitude REAL;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_address TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS defect_tags TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS categories_name_unique_idx ON categories(name);
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id TEXT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_unique_idx ON users(telegram_id) WHERE telegram_id IS NOT NULL AND telegram_id <> '';
      CREATE INDEX IF NOT EXISTS courier_handoffs_order_id_idx ON courier_handoffs(order_id);
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
    `);
  } else {
    const orderColumns = await db.all('PRAGMA table_info(orders)');
    const existingColumns = new Set(orderColumns.map(column => column.name));
    for (const [name, type] of [
      ['latitude', 'REAL'],
      ['longitude', 'REAL'],
      ['location_address', 'TEXT'],
      ['defect_tags', 'TEXT']
    ]) {
      if (!existingColumns.has(name)) {
        await db.run(`ALTER TABLE orders ADD COLUMN ${name} ${type}`);
      }
    }
    const userColumns = await db.all('PRAGMA table_info(users)');
    if (!userColumns.some(column => column.name === 'telegram_id')) {
      await db.run('ALTER TABLE users ADD COLUMN telegram_id TEXT');
    }
    const sessionColumns = await db.all('PRAGMA table_info(sessions)');
    const existingSessionColumns = new Set(sessionColumns.map(column => column.name));
    if (!existingSessionColumns.has('user_agent')) await db.run('ALTER TABLE sessions ADD COLUMN user_agent TEXT');
    if (!existingSessionColumns.has('ip_address')) await db.run('ALTER TABLE sessions ADD COLUMN ip_address TEXT');
    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS categories_name_unique_idx ON categories(name);
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
      CREATE UNIQUE INDEX IF NOT EXISTS users_telegram_id_unique_idx ON users(telegram_id) WHERE telegram_id IS NOT NULL AND telegram_id <> '';
      CREATE INDEX IF NOT EXISTS courier_handoffs_order_id_idx ON courier_handoffs(order_id);
    `);
  }

  const checkUsers = await db.get('SELECT count(*) as count FROM users');
  const maxOrderNumber = await db.get(
    "SELECT MAX(CAST(REPLACE(order_number, '#GLM-', '') AS INTEGER)) AS max_order_number FROM orders WHERE order_number LIKE '#GLM-%'"
  );
  const orderNumberSetting = await db.get('SELECT value FROM settings WHERE key = ?', ['order_number_start']);
  const orderNumberStart = Number(orderNumberSetting?.value || '1000');
  const defaultCounterValue = Math.max(
    Number(maxOrderNumber?.max_order_number || 0),
    Number.isFinite(orderNumberStart) && orderNumberStart > 0 ? orderNumberStart - 1 : 999
  );
  await db.run(
    'INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value',
    ['order_number', defaultCounterValue]
  );
  if (checkUsers && checkUsers.count === 0 && process.env.NODE_ENV === 'test') {
    const credentials = [];
    const createAccount = async (username, fullName, role, phone, carModel, carNumber) => {
      const password = crypto.randomBytes(18).toString('base64url');
      credentials.push(`${username}: ${password}`);
      await db.run(`
        INSERT INTO users (username, password, full_name, role, phone, car_model, car_number)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [username, hashPassword(password), fullName, role, phone, carModel, carNumber]);
    };

    // Foydalanuvchilar
    await createAccount('ega', 'Akmal Rahimov (Ega Admin)', 'owner', '+998 90 123 45 67', 'Malibu 2', '01 A 777 AA');
    await createAccount('operator', 'Dilshod Karimov (Admin Operator)', 'admin', '+998 93 234 56 78', null, null);
    await createAccount('kuryer1', 'Jasur Rustamov (Dastavchik #1)', 'courier', '+998 97 345 67 89', 'Damas', '01 888 CBA');
    await createAccount('kuryer2', 'Azizbek Normatov (Dastavchik #2)', 'courier', '+998 94 456 78 90', 'Labo', '01 555 XYZ');

    console.log(`\nBoshlang'ich akkaunt parollari (ularni xavfsiz joyda saqlang):\n${credentials.join('\n')}\n`);

    // Kategoriyalar
    const cats = [
      ['Standart Gilam', 'kv_m', 15000, 'Kvadrat metr hisobida tozalash va yuvish', '🧶'],
      ['Jun va Ipak Gilam (Premium)', 'kv_m', 25000, 'Ehtiyotkorlik bilan maxsus shampunlarda yuvish', '✨'],
      ['Adyol (1 kishilik)', 'dona', 35000, 'Dona hisobida chuqur antibakterial tozalash', '🛏️'],
      ['Adyol (2 kishilik / Og\'ir)', 'dona', 45000, 'Yumshoq parvarish va quritish', '🛋️'],
      ['Gilamcha (Yo\'lakcha / Oshxona)', 'dona', 20000, 'Kichik o\'lchamdagi gilamcha va oyoq osti', '🚪'],
      ['Parda va Tyul', 'kv_m', 12000, 'Dazmollash va nozik tozalash', '🪟'],
      ['Yostiq tozalash', 'dona', 25000, 'Par tozalash va yangi g\'ilof', '🪶']
    ];
    for (const cat of cats) {
      await db.run('INSERT INTO categories (name, unit, price_per_unit, description, icon) VALUES (?, ?, ?, ?, ?)', cat);
    }

    // Sozlamalar
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['bot_token', '']);
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['group_chat_id', '']);
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', ['company_name', 'OSAF GILAM YUVISH MARKAZI']);
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', ['company_phone', '+998 71 200 55 44']);
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', ['company_address', 'Toshkent sh., Chilonzor tumani, 19-mavze']);
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', ['auto_send_telegram', 'false']);
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', ['order_number_start', '1000']);

    // Namuna mijozlar
    const c1 = await db.run(`INSERT INTO customers (full_name, phone, phone2, address, landmark) VALUES (?, ?, ?, ?, ?)`,
      ['Jamshid Aliyev', '+998 90 911 22 33', '+998 71 277 88 99', 'Chilonzor-9, 14-uy, 28-xonadon', 'Rayhon milliy taomlari orqasi']);
    const c2 = await db.run(`INSERT INTO customers (full_name, phone, phone2, address, landmark) VALUES (?, ?, ?, ?, ?)`,
      ['Zilola Karimova', '+998 93 555 44 33', '', 'Yunusobod-13, 5-uy, 12-xonadon', 'Mega Planet yonida']);
    const c3 = await db.run(`INSERT INTO customers (full_name, phone, phone2, address, landmark) VALUES (?, ?, ?, ?, ?)`,
      ['Bobur Saidov', '+998 97 777 88 99', '', 'Mirzo Ulug\'bek, TTZ-2, 45-uy', 'Diyora to\'yxonasi ro\'parasida']);
    const c4 = await db.run(`INSERT INTO customers (full_name, phone, phone2, address, landmark) VALUES (?, ?, ?, ?, ?)`,
      ['Nodira Xolmatova', '+998 91 333 22 11', '', 'Yakkasaroy tumani, Shota Rustaveli 45', 'Birodarlik qabristoni yaqinida']);

    // Namuna buyurtmalar
    const o1 = await db.run(`
      INSERT INTO orders (
        order_number, customer_id, courier_pickup_id, courier_delivery_id, status, 
        total_area, total_items, total_amount, discount, final_amount, paid_amount, 
        payment_method, payment_status, pickup_date, target_delivery_date, delivered_date, courier_notes, admin_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ['#GLM-1001', c1.lastID, 3, 3, 'yuvishda', 18.5, 3, 292500, 12500, 280000, 100000, 'naqd', 'qisman', '2026-10-01 10:30', '2026-10-04', null, '3-qavat lift yoq', 'Qahva dog\'i bor, ehtiyotkorlik bilan ketkizilsin']);
    
    await db.run(`INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o1.lastID, 1, 'Standart Gilam', '#GLM1001-1', 4.0, 3.0, 12.0, 1, 15000, 180000, 'Qizil naqshli, qahva dog\'i']);
    await db.run(`INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o1.lastID, 1, 'Standart Gilam', '#GLM1001-2', 2.5, 2.6, 6.5, 1, 15000, 97500, 'Zal gilami']);
    await db.run(`INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o1.lastID, 5, 'Gilamcha (Yo\'lakcha)', '#GLM1001-3', 0, 0, 0, 1, 20000, 20000, 'Yo\'lakcha']);

    const o2 = await db.run(`
      INSERT INTO orders (
        order_number, customer_id, courier_pickup_id, courier_delivery_id, status, 
        total_area, total_items, total_amount, discount, final_amount, paid_amount, 
        payment_method, payment_status, pickup_date, target_delivery_date, delivered_date, courier_notes, admin_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ['#GLM-1002', c2.lastID, 4, 4, 'yetkazilmoqda', 15.0, 2, 270000, 0, 270000, 0, 'click', 'kutilmoqda', '2026-09-29 14:00', '2026-10-02', null, 'Eshik kodi: 45k', 'Kechki 18:00 dan keyin yetkazilsin']);

    await db.run(`INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o2.lastID, 2, 'Jun va Ipak Gilam (Premium)', '#GLM1002-1', 5.0, 3.0, 15.0, 1, 25000, 375000, 'Qimmatbaho eron gilami']);
    await db.run(`INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o2.lastID, 4, 'Adyol (2 kishilik)', '#GLM1002-2', 0, 0, 0, 1, 45000, 45000, 'Sinteponli adyol']);

    const o3 = await db.run(`
      INSERT INTO orders (
        order_number, customer_id, courier_pickup_id, courier_delivery_id, status, 
        total_area, total_items, total_amount, discount, final_amount, paid_amount, 
        payment_method, payment_status, pickup_date, target_delivery_date, courier_notes, admin_notes
      ) VALUES (?, ?, ?, ?, 'yangi', 8.0, 2, 165000, 0, 165000, 0, 'naqd', 'kutilmoqda', '2026-10-02 09:15', '2026-10-05', ?, ?)
    `, ['#GLM-1003', c3.lastID, 3, null, "Mijoz uydan olib ketishni so'radi", "Bugun kuryer borib olishi kerak"]);
    await db.run(`INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o3.lastID, 1, 'Standart Gilam', '#GLM1003-1', 4.0, 2.0, 8.0, 1, 15000, 120000, 'Bolalar xonasi']);
    await db.run(`INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o3.lastID, 3, 'Adyol (1 kishilik)', '#GLM1003-2', 0, 0, 0, 1, 35000, 35000, 'Moviy rangli']);

    const o4 = await db.run(`
      INSERT INTO orders (
        order_number, customer_id, courier_pickup_id, courier_delivery_id, status, 
        total_area, total_items, total_amount, discount, final_amount, paid_amount, 
        payment_method, payment_status, pickup_date, target_delivery_date, delivered_date, courier_notes, admin_notes
      ) VALUES (?, ?, ?, ?, 'yetkazildi', 20.0, 2, 335000, 15000, 320000, 320000, 'payme', 'tolandi', '2026-09-25 11:00', '2026-09-28', '2026-09-28 16:40', ?, ?)
    `, ['#GLM-1004', c4.lastID, 4, 4, "Mijoz juda minnatdor bo'ldi", 'Muntazam mijoz']);
    await db.run(`INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o4.lastID, 1, 'Standart Gilam', '#GLM1004-1', 5.0, 4.0, 20.0, 1, 15000, 300000, 'Mehmonxona gilami']);
    await db.run(`INSERT INTO order_items (order_id, category_id, item_type, barcode, length, width, area, quantity, unit_price, subtotal, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o4.lastID, 3, 'Adyol (1 kishilik)', '#GLM1004-2', 0, 0, 0, 1, 35000, 35000, 'Qishki jun adyol']);

    // Kassa
    await db.run(`INSERT INTO transactions (order_id, type, category, amount, payment_method, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
      [o1.lastID, 'kirim', 'buyurtma_tolovi', 100000, 'naqd', "#GLM-1001 avans to'lovi", 1]);
    await db.run(`INSERT INTO transactions (order_id, type, category, amount, payment_method, description, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
      [o4.lastID, 'kirim', 'buyurtma_tolovi', 320000, 'payme', "#GLM-1004 to'liq to'lovi", 1]);
    await db.run(`INSERT INTO transactions (order_id, type, category, amount, payment_method, description, created_by) VALUES (null, ?, ?, ?, ?, ?, ?)`, 
      ['chiqim', 'kimyoviy_vosita', 180000, 'naqd', "Ersağ gilam shampuni va dog' ketkazgich sotib olindi", 1]);
    await db.run(`INSERT INTO transactions (order_id, type, category, amount, payment_method, description, created_by) VALUES (null, ?, ?, ?, ?, ?, ?)`, 
      ['chiqim', 'yoqilgi', 100000, 'naqd', "Damas gaz va benzin xarajati (Kuryer 1)", 1]);
  }

  if (checkUsers && checkUsers.count === 0 && process.env.NODE_ENV !== 'test') {
    const configuredUsername = process.env.OWNER_USERNAME?.trim();
    const configuredPassword = process.env.OWNER_PASSWORD;
    if (process.env.VERCEL === '1' &&
        (!configuredUsername || configuredUsername.length > 40 ||
         typeof configuredPassword !== 'string' || configuredPassword.length < 8 || configuredPassword.length > 256)) {
      throw new Error('Yangi Vercel bazasini boshlash uchun OWNER_USERNAME va kamida 8 belgili OWNER_PASSWORD sozlang.');
    }

    const username = configuredUsername || 'ega';
    const password = configuredPassword || crypto.randomBytes(24).toString('base64url');
    await db.run(`
      INSERT INTO users (username, password, full_name, role)
      VALUES (?, ?, ?, 'owner')
      ON CONFLICT(username) DO NOTHING
    `, [username, hashPassword(password), username]);
    if (!configuredPassword) {
      console.warn(`Bo‘sh lokal baza uchun egasi akkaunti yaratildi. Login: ${username}; vaqtinchalik parol: ${password}`);
    }
  }

  const latestOrder = await db.get('SELECT COALESCE(MAX(id), 0) AS id FROM orders');
  await db.run(`
    UPDATE counters
    SET value = CASE WHEN value < ? THEN ? ELSE value END
    WHERE name = ?
  `, [(latestOrder?.id || 0) + 1000, (latestOrder?.id || 0) + 1000, 'order_number']);

  const categoryCount = await db.get('SELECT count(*) as count FROM categories');
  if (!categoryCount || categoryCount.count === 0) {
    const categories = [
      ['Standart Gilam', 'kv_m', 15000, 'Kvadrat metr hisobida tozalash va yuvish', '🧶'],
      ['Jun va Ipak Gilam (Premium)', 'kv_m', 25000, 'Ehtiyotkorlik bilan maxsus shampunlarda yuvish', '✨'],
      ['Adyol (1 kishilik)', 'dona', 35000, 'Dona hisobida chuqur antibakterial tozalash', '🛏️'],
      ['Adyol (2 kishilik / Og\'ir)', 'dona', 45000, 'Yumshoq parvarish va quritish', '🛋️'],
      ['Gilamcha (Yo\'lakcha / Oshxona)', 'dona', 20000, 'Kichik o\'lchamdagi gilamcha va oyoq osti', '🚪'],
      ['Parda va Tyul', 'kv_m', 12000, 'Dazmollash va nozik tozalash', '🪟'],
      ['Yostiq tozalash', 'dona', 25000, 'Par tozalash va yangi g\'ilof', '🪶']
    ];
    for (const category of categories) {
      await db.run(
        'INSERT INTO categories (name, unit, price_per_unit, description, icon) VALUES (?, ?, ?, ?, ?) ON CONFLICT(name) DO NOTHING',
        category
      );
    }
  }

  for (const [key, value] of [
    ['bot_token', ''],
    ['group_chat_id', ''],
    ['company_name', 'OSAF GILAM YUVISH MARKAZI'],
    ['company_phone', ''],
    ['company_address', ''],
    ['auto_send_telegram', 'false']
  ]) {
    await db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING',
      [key, value]
    );
  }
  await db.run(
    'UPDATE settings SET value = ? WHERE key = ? AND value = ?',
    ['OSAF GILAM YUVISH MARKAZI', 'company_name', 'TOZA GILAM PROFESSIONAL YUVISH MARKAZI']
  );

  const legacyDefaults = {
    ega: 'admin123',
    operator: '123456',
    kuryer1: '123456',
    kuryer2: '123456'
  };
  const legacyUsers = await db.all('SELECT id, username, password FROM users');
  const rotatedCredentials = [];
  for (const user of legacyUsers) {
    if (user.password.startsWith('scrypt$')) continue;
    let password = user.password;
    if (legacyDefaults[user.username] === password) {
      password = crypto.randomBytes(18).toString('base64url');
      rotatedCredentials.push(`${user.username}: ${password}`);
    }
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashPassword(password), user.id]);
  }
  if (rotatedCredentials.length) {
    console.warn(`Eski standart parollar xavfsiz tasodifiy parollarga almashtirildi. Saqlab qo'ying:\n${rotatedCredentials.join('\n')}`);
  }

}

module.exports = {
  db,
  initDb,
  isPostgres,
  createPostgresAdapter,
  withPostgresTransaction
};
