// Reset local database: clear all tables, then execute data SQL files
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'yangyang',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const DATA_DIR = path.join(__dirname, '..', 'src', 'db', 'data');

async function main() {
  console.log('Connecting to local database...');

  // Step 1: Clear all tables (order respects foreign keys)
  // Use TRUNCATE CASCADE to handle foreign keys automatically
  console.log('Clearing all tables...');
  await pool.query('TRUNCATE TABLE pending_trades, trade_history, alert_rules, daily_profits, configs, positions CASCADE');
  console.log('All tables cleared.');

  // Step 2: Execute each SQL file
  const files = [
    'positions_rows.sql',
    'configs_rows.sql',
    'daily_profits_rows.sql',
    'alert_rules_rows.sql',
    'trade_history_rows.sql',
  ];

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    if (fs.existsSync(filePath)) {
      const sql = fs.readFileSync(filePath, 'utf8');
      console.log(`Executing ${file}...`);
      try {
        await pool.query(sql);
        console.log(`  Done.`);
      } catch (err) {
        console.error(`  Error executing ${file}:`, err.message);
      }
    } else {
      console.warn(`  ${file} not found, skipping.`);
    }
  }

  console.log('Database reset complete.');
  await pool.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
