const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');
const { toPostgresSchema, toPostgresSql } = require('../database-sql');
const { createPostgresAdapter, withPostgresTransaction } = require('../database-postgres');

test('PostgreSQL placeholders skip SQL strings and comments', () => {
  const sql = "SELECT '?' AS literal FROM users WHERE id = ? AND note = 'can''t ?' -- ?\nAND role = ?";
  assert.equal(
    toPostgresSql(sql),
    "SELECT '?' AS literal FROM users WHERE id = $1 AND note = 'can''t ?' -- ?\nAND role = $2"
  );
});

test('SQLite schema declarations are converted to PostgreSQL types', () => {
  const schema = `
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    name TEXT
  `;
  assert.equal(
    toPostgresSchema(schema),
    `
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    name TEXT
  `
  );
});

test('Vercel refuses to fall back to ephemeral SQLite without a PostgreSQL URL', () => {
  const result = spawnSync(process.execPath, ['-e', "require('./database')"], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      VERCEL: '1',
      POSTGRES_URL: '',
      DATABASE_URL: '',
      POSTGRES_PRISMA_URL: ''
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /doimiy PostgreSQL kerak/);
});

test('PostgreSQL adapter returns generated IDs from inserts', async () => {
  const calls = [];
  const adapter = createPostgresAdapter({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: 42 }], rowCount: 1 };
    }
  });
  const inserted = await adapter.run(
    'INSERT INTO orders (order_number) VALUES (?)',
    ['#GLM-1042']
  );
  assert.deepEqual(inserted, { lastID: 42, changes: 1 });
  assert.match(calls[0].sql, /\$1\) RETURNING id$/);
  assert.deepEqual(calls[0].params, ['#GLM-1042']);
});

test('PostgreSQL transactions commit successful work and roll back failures', async () => {
  for (const failure of [false, true]) {
    const statements = [];
    let released = false;
    const client = {
      async query(sql, params) {
        statements.push({ sql, params });
        if (sql.startsWith('INSERT') && failure) throw new Error('simulated insert failure');
        return { rows: [{ id: 7 }], rowCount: 1 };
      },
      release() { released = true; }
    };
    const pool = { connect: async () => client };
    if (failure) {
      await assert.rejects(
        withPostgresTransaction(pool, transaction =>
          transaction.run('INSERT INTO orders (order_number) VALUES (?)', ['#GLM-7'])
        ),
        /simulated insert failure/
      );
      assert.deepEqual(statements.map(entry => entry.sql), ['BEGIN', 'INSERT INTO orders (order_number) VALUES ($1) RETURNING id', 'ROLLBACK']);
    } else {
      const order = await withPostgresTransaction(pool, transaction =>
        transaction.run('INSERT INTO orders (order_number) VALUES (?)', ['#GLM-7'])
      );
      assert.equal(order.lastID, 7);
      assert.deepEqual(statements.map(entry => entry.sql), ['BEGIN', 'INSERT INTO orders (order_number) VALUES ($1) RETURNING id', 'COMMIT']);
    }
    assert.equal(released, true);
  }
});
