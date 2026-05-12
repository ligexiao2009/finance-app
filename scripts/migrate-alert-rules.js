/**
 * 迁移脚本：更新 alert_rules 表，添加 'both' 方向支持
 * 运行方式：node scripts/migrate-alert-rules.js
 */

require('dotenv').config();
const { Pool } = require('pg');

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('supabase.co') 
      ? { rejectUnauthorized: false } 
      : false,
  });

  try {
    console.log('开始迁移 alert_rules 表...');

    // 删除旧的约束
    await pool.query(`ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_direction_check`);
    console.log('已删除旧约束');

    // 添加新的约束
    await pool.query(`
      ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_direction_check 
      CHECK (direction IN ('up', 'down', 'both'))
    `);
    console.log('已添加新约束');

    console.log('迁移完成！');
  } catch (error) {
    console.error('迁移失败:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
