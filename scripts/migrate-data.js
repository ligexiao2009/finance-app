#!/usr/bin/env node

// Migrate JSON data to PostgreSQL
const fs = require('fs');
const path = require('path');
const db = require('../src/db/db');
const dataDir = path.join(__dirname, '..', 'data');
const configDir = path.join(__dirname, '..', 'config');
console.log('ENV:', process.env.DATABASE_URL);
async function migratePositions() {
  const dataFile = path.join(dataDir, 'data.json');
  if (!fs.existsSync(dataFile)) {
    console.log('📁 data.json not found, skipping positions migration');
    return 0;
  }

  const jsonData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const rows = jsonData.rows || [];

  console.log(`📊 Migrating ${rows.length} positions...`);

  let migrated = 0;
  for (const row of rows) {
    try {
      // Check if position already exists
      const existing = await db.getPosition(row.id);
      if (existing) {
        console.log(`   ⚠️  Position ${row.code} (${row.name}) already exists, skipping`);
        continue;
      }

      await db.createPosition({
        id: row.id,
        code: row.code,
        name: row.name,
        shares: row.shares,
        cost: row.cost,
        isFund: row.isFund || false,
        isOverseas: row.isOverseas || false,
        planBuy: row.planBuy || 0,
        alert: row.alert || null,
        targetPrice: row.targetPrice || null,
      });
      migrated++;
      console.log(`   ✅ ${row.code}: ${row.name}`);
    } catch (error) {
      console.error(`   ❌ Error migrating ${row.code}: ${error.message}`);
    }
  }

  console.log(`✅ Migrated ${migrated} positions`);
  return migrated;
}

async function migratePendingTrades() {
  const dataFile = path.join(dataDir, 'pending-trades.json');
  if (!fs.existsSync(dataFile)) {
    console.log('📁 pending-trades.json not found, skipping pending trades migration');
    return 0;
  }

  const jsonData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const trades = jsonData.trades || [];

  console.log(`📊 Migrating ${trades.length} pending trades...`);

  let migrated = 0;
  for (const trade of trades) {
    try {
      // Check if trade already exists
      const existing = await db.getPendingTrade(trade.id);
      if (existing) {
        console.log(`   ⚠️  Pending trade ${trade.id} already exists, skipping`);
        continue;
      }

      await db.createPendingTrade({
        id: trade.id,
        rowId: trade.rowId,
        code: trade.code,
        name: trade.name,
        amount: trade.amount,
        isBefore15: trade.isBefore15 || true,
        createdAt: trade.createdAt,
      });
      migrated++;
      console.log(`   ✅ ${trade.code}: ${trade.name} (${trade.amount})`);
    } catch (error) {
      console.error(`   ❌ Error migrating pending trade ${trade.id}: ${error.message}`);
    }
  }

  console.log(`✅ Migrated ${migrated} pending trades`);
  return migrated;
}

async function migrateTradeHistory() {
  const dataFile = path.join(dataDir, 'trade-history.json');
  if (!fs.existsSync(dataFile)) {
    console.log('📁 trade-history.json not found, skipping trade history migration');
    return 0;
  }

  const jsonData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const history = jsonData.history || {};

  console.log(`📊 Migrating trade history...`);

  let migrated = 0;
  for (const [rowId, records] of Object.entries(history)) {
    console.log(`   📋 Row ${rowId}: ${records.length} records`);

    for (const record of records) {
      try {
        // Check if record already exists
        // Note: We don't have a getTradeRecordById function, so we'll just try to insert
        await db.createTradeRecord({
          id: record.id,
          rowId: rowId,
          type: record.type,
          amount: record.amount,
          shares: record.shares,
          netValue: record.netValue,
          isBefore15: record.isBefore15 || true,
          createdAt: record.createdAt,
          localDate: record.localDate || null,
        });
        migrated++;
      } catch (error) {
        // If it's a duplicate key error, skip it
        if (error.code === '23505') {
          // console.log(`   ⚠️  Record ${record.id} already exists, skipping`);
        } else {
          console.error(`   ❌ Error migrating trade record ${record.id}: ${error.message}`);
        }
      }
    }
  }

  console.log(`✅ Migrated ${migrated} trade history records`);
  return migrated;
}

async function migrateDailyProfits() {
  const dataFile = path.join(dataDir, 'daily-profit.json');
  if (!fs.existsSync(dataFile)) {
    console.log('📁 daily-profit.json not found, skipping daily profits migration');
    return 0;
  }

  const jsonData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const records = jsonData.records || [];

  console.log(`📊 Migrating ${records.length} daily profit records...`);

  let migrated = 0;
  for (const record of records) {
    try {
      // Check if record already exists
      const existing = await db.getDailyProfitByDate(record.date);
      if (existing) {
        console.log(`   ⚠️  Daily profit for ${record.date} already exists, updating`);
      }

      await db.createDailyProfit({
        date: record.date,
        stockToday: record.stockToday || 0,
        fundToday: record.fundToday || 0,
        totalToday: record.totalToday || 0,
      });
      migrated++;
      console.log(`   ✅ ${record.date}: ¥${record.totalToday}`);
    } catch (error) {
      console.error(`   ❌ Error migrating daily profit ${record.date}: ${error.message}`);
    }
  }

  console.log(`✅ Migrated ${migrated} daily profit records`);
  return migrated;
}

async function migrateConfig() {
  const dataFile = path.join(configDir, 'config.json');
  if (!fs.existsSync(dataFile)) {
    console.log('📁 config.json not found, skipping config migration');
    return 0;
  }

  const config = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

  console.log('📊 Migrating config...');

  let migrated = 0;
  for (const [key, value] of Object.entries(config)) {
    try {
      await db.setConfig(key, value);
      migrated++;
      console.log(`   ✅ ${key}: ${key === 'serverchanKey' ? '***' : value}`);
    } catch (error) {
      console.error(`   ❌ Error migrating config ${key}: ${error.message}`);
    }
  }

  console.log(`✅ Migrated ${migrated} config entries`);
  return migrated;
}

async function main() {
  console.log('🚀 Starting data migration from JSON to PostgreSQL...');

  try {
    // Test database connection first
    await db.query('SELECT 1');
    console.log('✅ Database connection verified');

    const results = {
      positions: 0,
      pendingTrades: 0,
      tradeHistory: 0,
      dailyProfits: 0,
      config: 0,
    };

    results.positions = await migratePositions();
    results.pendingTrades = await migratePendingTrades();
    results.tradeHistory = await migrateTradeHistory();
    results.dailyProfits = await migrateDailyProfits();
    results.config = await migrateConfig();

    console.log('\n🎉 Data migration completed!');
    console.log('\n📊 Migration summary:');
    console.log(`   - Positions: ${results.positions}`);
    console.log(`   - Pending trades: ${results.pendingTrades}`);
    console.log(`   - Trade history: ${results.tradeHistory}`);
    console.log(`   - Daily profits: ${results.dailyProfits}`);
    console.log(`   - Config entries: ${results.config}`);

    console.log('\n💡 Next steps:');
    console.log('   1. Backup JSON files (optional)');
    console.log('   2. Update server.js to use PostgreSQL');
    console.log('   3. Test all functionality');
    console.log('   4. Consider removing JSON files after verification');

  } catch (error) {
    console.error('❌ Migration failed:');
    console.error(error.message);

    if (error.code === 'ECONNREFUSED') {
      console.error('\n🔧 Database connection failed. Check:');
      console.error('   - Database is running');
      console.error('   - Connection settings are correct');
      console.error('   - Run: node scripts/init-db.js (to create tables first)');
    }

    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  migratePositions,
  migratePendingTrades,
  migrateTradeHistory,
  migrateDailyProfits,
  migrateConfig,
  main,
};
