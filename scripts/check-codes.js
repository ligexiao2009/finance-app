// 检查基金代码
require('dotenv').config();
const db = require('../src/db/db');

async function checkCodes() {
  try {
    await db.initDatabase();
    const rows = await db.getPositions();

    console.log('=== 当前数据库中的持仓 ===\n');
    rows.forEach((r, i) => {
      console.log(`${i + 1}. ${r.name}`);
      console.log(`   代码: ${r.code} (长度: ${r.code.length})`);
      console.log(`   类型: ${r.isFund ? '基金' : '股票'}`);
      console.log('');
    });

    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

checkCodes();
