const { toPostgresSql } = require('./database-sql');

function createPostgresAdapter(queryable) {
  return {
    get: async (sql, params = []) => {
      const result = await queryable.query(toPostgresSql(sql), params);
      return result.rows[0];
    },
    all: async (sql, params = []) => {
      const result = await queryable.query(toPostgresSql(sql), params);
      return result.rows;
    },
    run: async (sql, params = []) => {
      const insert = /^\s*INSERT\s+INTO\s+(users|categories|customers|orders|order_items|transactions|telegram_logs)\b/i.test(sql);
      const hasReturning = /\bRETURNING\b/i.test(sql);
      const query = insert && !hasReturning
        ? `${sql.trim().replace(/;$/, '')} RETURNING id`
        : sql;
      const result = await queryable.query(toPostgresSql(query), params);
      return { lastID: result.rows[0]?.id, changes: result.rowCount };
    }
  };
}

async function withPostgresTransaction(connectionPool, operation) {
  const client = await connectionPool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(createPostgresAdapter(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'PostgreSQL transaction and rollback both failed');
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createPostgresAdapter, withPostgresTransaction };
