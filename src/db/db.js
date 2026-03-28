// Database connection and utility functions for PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');

// Database configuration
let poolConfig;
if (process.env.DATABASE_URL) {
  // Use connection string (e.g., from Supabase)
  poolConfig = {
    connectionString: process.env.DATABASE_URL,
    max: 20, // maximum number of clients in the pool
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : false,
  };
} else {
  // Use individual environment variables (for local development)
  poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'yangyang',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: 20, // maximum number of clients in the pool
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 10000,
  };
}

const pool = new Pool(poolConfig);

// Test connection on startup
pool.on('connect', () => {
  console.log('PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Utility function to execute queries
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log(`Executed query: ${text}`, { duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Query error:', { text, params, error: error.message });
    throw error;
  }
}

// Convert snake_case to camelCase for database rows
function snakeToCamel(obj) {
  if (!obj) return obj;

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    // Convert snake_case to camelCase
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

    // Convert numeric strings to numbers, EXCEPT for code fields (keep leading zeros)
    if (camelKey !== 'code' && typeof value === 'string' && !isNaN(value) && value !== '') {
      result[camelKey] = parseFloat(value);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

// Convert camelCase to snake_case for database queries
function camelToSnake(obj) {
  if (!obj) return obj;

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    // Convert camelCase to snake_case
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    result[snakeKey] = value;
  }
  return result;
}

// Initialize database tables
async function initDatabase() {
  try {
    console.log('Initializing database tables...');

    // Read and execute schema.sql
    const fs = require('fs');
    const path = require('path');
    const schemaPath = path.join(__dirname, 'schema.sql');

    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      // Split by semicolon to execute statements one by one
      const statements = schemaSql.split(';').filter(stmt => stmt.trim());

      let successCount = 0;
      let errorCount = 0;

      for (const statement of statements) {
        if (statement.trim()) {
          try {
            await query(statement);
            successCount++;
          } catch (error) {
            errorCount++;
            // Log but continue - many errors are due to tables/objects already existing
            console.warn(`  Statement failed (${error.message.substring(0, 50)}...): ${statement.substring(0, 100)}...`);
          }
        }
      }
      console.log(`Database tables initialization completed: ${successCount} statements succeeded, ${errorCount} failed (tables likely already exist)`);
    } else {
      console.warn('schema.sql not found, skipping table initialization');
    }
  } catch (error) {
    console.error('Failed to initialize database (tables may already exist):', error.message);
    // Don't throw - allow server to start even if tables already exist
  }
}

// ==================== 配置表操作 ====================
async function getConfig(key) {
  const res = await query('SELECT value FROM configs WHERE key = $1', [key]);
  return res.rows[0]?.value || null;
}

async function setConfig(key, value) {
  await query(
    `INSERT INTO configs (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
    [key, value]
  );
}

async function getAllConfigs() {
  const res = await query('SELECT key, value FROM configs');
  const configs = {};
  res.rows.forEach(row => {
    configs[row.key] = row.value;
  });
  return configs;
}

// ==================== 持仓表操作 ====================
async function getPositions() {
  const res = await query('SELECT * FROM positions ORDER BY created_at DESC');
  // Convert snake_case database fields to camelCase for frontend
  return res.rows.map(row => snakeToCamel(row));
}

async function getPosition(id) {
  const res = await query('SELECT * FROM positions WHERE id = $1', [id]);
  return res.rows[0] ? snakeToCamel(res.rows[0]) : null;
}

async function getPositionByCode(code, isFund) {
  const res = await query(
    'SELECT * FROM positions WHERE code = $1 AND is_fund = $2',
    [code, isFund]
  );
  return res.rows[0] ? snakeToCamel(res.rows[0]) : null;
}

async function createPosition(position) {
  const {
    id, code, name, shares = 0, cost = 0, isFund = false,
    isOverseas = false, planBuy = 0, alert = null, targetPrice = null
  } = position;

  await query(
    `INSERT INTO positions (id, code, name, shares, cost, is_fund, is_overseas, plan_buy, alert, target_price)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, code, name, shares, cost, isFund, isOverseas, planBuy, alert, targetPrice]
  );
  return position;
}

async function updatePosition(id, updates) {
  const fields = [];
  const values = [];
  let paramCount = 1;

  // Build dynamic update query
  for (const [key, value] of Object.entries(updates)) {
    // Convert camelCase to snake_case
    const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    fields.push(`${dbKey} = $${paramCount}`);
    values.push(value);
    paramCount++;
  }

  if (fields.length === 0) return;

  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id);

  const queryText = `UPDATE positions SET ${fields.join(', ')} WHERE id = $${paramCount}`;
  await query(queryText, values);
}

async function deletePosition(id) {
  await query('DELETE FROM positions WHERE id = $1', [id]);
}

async function deletePositionByCode(code, isFund) {
  await query('DELETE FROM positions WHERE code = $1 AND is_fund = $2', [code, isFund]);
}

// ==================== 待确认交易表操作 ====================
async function getPendingTrades() {
  const res = await query('SELECT * FROM pending_trades ORDER BY created_at DESC');
  return res.rows.map(row => snakeToCamel(row));
}

async function getPendingTrade(id) {
  const res = await query('SELECT * FROM pending_trades WHERE id = $1', [id]);
  return res.rows[0] ? snakeToCamel(res.rows[0]) : null;
}

async function getPendingTradesByRowId(rowId) {
  const res = await query('SELECT * FROM pending_trades WHERE row_id = $1 ORDER BY created_at DESC', [rowId]);
  return res.rows.map(row => snakeToCamel(row));
}

async function createPendingTrade(trade) {
  const {
    id, rowId, code, name, amount, isBefore15 = true, createdAt
  } = trade;

  await query(
    `INSERT INTO pending_trades (id, row_id, code, name, amount, is_before_15, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, rowId, code, name, amount, isBefore15, createdAt]
  );
  return trade;
}

async function deletePendingTrade(id) {
  await query('DELETE FROM pending_trades WHERE id = $1', [id]);
}

async function deleteAllPendingTrades() {
  await query('DELETE FROM pending_trades');
}

// ==================== 交易历史表操作 ====================
async function getTradeHistory() {
  const res = await query(`
    SELECT row_id, json_agg(
      json_build_object(
        'id', id,
        'type', type,
        'amount', amount,
        'shares', shares,
        'netValue', net_value,
        'isBefore15', is_before_15,
        'createdAt', created_at,
        'localDate', local_date
      ) ORDER BY created_at DESC
    ) as records
    FROM trade_history
    GROUP BY row_id
  `);

  const history = {};
  res.rows.forEach(row => {
    history[row.row_id] = row.records;
  });
  return history;
}

async function getTradeHistoryByRowId(rowId) {
  const res = await query(`
    SELECT * FROM trade_history
    WHERE row_id = $1
    ORDER BY created_at DESC
  `, [rowId]);
  return res.rows.map(row => snakeToCamel(row));
}

async function createTradeRecord(record) {
  const {
    id, rowId, type, amount, shares, netValue, isBefore15 = true, createdAt, localDate
  } = record;

  await query(
    `INSERT INTO trade_history (id, row_id, type, amount, shares, net_value, is_before_15, created_at, local_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, rowId, type, amount, shares, netValue, isBefore15, createdAt, localDate]
  );
  return record;
}

async function deleteTradeRecord(id) {
  await query('DELETE FROM trade_history WHERE id = $1', [id]);
}

// ==================== 每日收益表操作 ====================
async function getDailyProfits() {
  const res = await query('SELECT * FROM daily_profits ORDER BY date DESC');
  // Convert snake_case database fields to camelCase for frontend
  return res.rows.map(row => {
    const converted = snakeToCamel(row);
    // Convert numeric strings to numbers
    if (typeof converted.stockToday === 'string') {
      converted.stockToday = parseFloat(converted.stockToday);
    }
    if (typeof converted.fundToday === 'string') {
      converted.fundToday = parseFloat(converted.fundToday);
    }
    if (typeof converted.totalToday === 'string') {
      converted.totalToday = parseFloat(converted.totalToday);
    }
    // Format date as YYYY-MM-DD string
    if (converted.date) {
      const d = new Date(converted.date);
      converted.date = d.getFullYear() + '-' +
                      (d.getMonth() + 1).toString().padStart(2, '0') + '-' +
                      d.getDate().toString().padStart(2, '0');
    }
    return converted;
  });
}

async function getDailyProfitByDate(date) {
  const res = await query('SELECT * FROM daily_profits WHERE date = $1', [date]);
  return res.rows[0] || null;
}

async function createDailyProfit(record) {
  const { date, stockToday, fundToday, totalToday } = record;

  await query(
    `INSERT INTO daily_profits (date, stock_today, fund_today, total_today)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (date) DO UPDATE SET
       stock_today = EXCLUDED.stock_today,
       fund_today = EXCLUDED.fund_today,
       total_today = EXCLUDED.total_today,
       created_at = CURRENT_TIMESTAMP`,
    [date, stockToday, fundToday, totalToday]
  );
  return record;
}

async function deleteDailyProfit(date) {
  await query('DELETE FROM daily_profits WHERE date = $1', [date]);
}

module.exports = {
  // Database connection
  pool,
  query,
  initDatabase,

  // Config operations
  getConfig,
  setConfig,
  getAllConfigs,

  // Position operations
  getPositions,
  getPosition,
  getPositionByCode,
  createPosition,
  updatePosition,
  deletePosition,
  deletePositionByCode,

  // Pending trades operations
  getPendingTrades,
  getPendingTrade,
  getPendingTradesByRowId,
  createPendingTrade,
  deletePendingTrade,
  deleteAllPendingTrades,

  // Trade history operations
  getTradeHistory,
  getTradeHistoryByRowId,
  createTradeRecord,
  deleteTradeRecord,

  // Daily profits operations
  getDailyProfits,
  getDailyProfitByDate,
  createDailyProfit,
  deleteDailyProfit,
};
