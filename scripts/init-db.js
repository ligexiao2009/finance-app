#!/usr/bin/env node

// Initialize PostgreSQL database tables
const db = require('../src/db/db');

async function main() {
  console.log('🚀 Starting database initialization...');

  try {
    // Initialize tables
    await db.initDatabase();
    console.log('✅ Database tables created successfully');

    // Insert default config if not exists
    const existingConfig = await db.getAllConfigs();
    if (!existingConfig.serverchanKey) {
      await db.setConfig('serverchanKey', 'YOUR_SERVERCHAN_SEND_KEY_HERE');
      console.log('✅ Default config inserted');
    }
    if (!existingConfig.alertTime) {
      await db.setConfig('alertTime', '0 31 23 * * *');
      console.log('✅ Default alert time set');
    }

    // List all tables
    const tables = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    console.log(`📊 Available tables (${tables.rows.length}):`);
    tables.rows.forEach(row => console.log(`   - ${row.table_name}`));

    // Show row counts
    const positionsCount = await db.query('SELECT COUNT(*) FROM positions');
    const pendingCount = await db.query('SELECT COUNT(*) FROM pending_trades');
    const historyCount = await db.query('SELECT COUNT(*) FROM trade_history');
    const profitsCount = await db.query('SELECT COUNT(*) FROM daily_profits');
    const configsCount = await db.query('SELECT COUNT(*) FROM configs');

    console.log('\n📈 Current data counts:');
    console.log(`   - Positions: ${positionsCount.rows[0].count}`);
    console.log(`   - Pending trades: ${pendingCount.rows[0].count}`);
    console.log(`   - Trade history: ${historyCount.rows[0].count}`);
    console.log(`   - Daily profits: ${profitsCount.rows[0].count}`);
    console.log(`   - Configs: ${configsCount.rows[0].count}`);

    console.log('\n🎉 Database initialization completed successfully!');
    console.log('\nNext steps:');
    console.log('   1. Run: node scripts/migrate-data.js (to migrate JSON data to PostgreSQL)');
    console.log('   2. Run: node src/server.js (to start the server)');
    console.log('\nNote: Make sure DATABASE_URL or DB_* environment variables are set.');

  } catch (error) {
    console.error('❌ Database initialization failed:');
    console.error(error.message);

    if (error.code === 'ECONNREFUSED') {
      console.error('\n🔧 Connection failed. Check:');
      console.error('   - Database server is running');
      console.error('   - Connection string is correct');
      console.error('   - Network/firewall settings');
      console.error('\nFor Supabase: Make sure you allow connections from your IP');
    } else if (error.code === '3D000') {
      console.error('\n🔧 Database does not exist. Create it first.');
      console.error('   For local: createdb stockdb');
      console.error('   For Supabase: Check project database name');
    } else if (error.code === '28P01') {
      console.error('\n🔧 Authentication failed. Check username/password.');
    }

    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = main;
