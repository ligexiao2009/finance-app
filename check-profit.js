// 检查数据库中的收益数据
require('dotenv').config();
const db = require('./db');

async function checkProfitData() {
  try {
    await db.initDatabase();
    console.log('数据库连接成功\n');

    // 检查 daily_profits 表
    const profits = await db.getDailyProfits();
    console.log('=== daily_profits 表数据 ===');
    console.log('记录数量:', profits.length);
    console.log('原始数据:');
    console.log(JSON.stringify(profits, null, 2));

    console.log('\n=== 检查字段名 ===');
    if (profits.length > 0) {
      console.log('第一条记录的字段:', Object.keys(profits[0]));
    }

    process.exit(0);
  } catch (error) {
    console.error('错误:', error);
    process.exit(1);
  }
}

checkProfitData();