// 修复基金代码（补前导零）
require('dotenv').config();
const db = require('../src/db/db');

// 基金代码映射（根据名称补全正确的代码）
const codeFixMap = {
  '永赢半导体产业智选混合发起C': '015968',
  '华宝海外新能源汽车股票发起式(QDII)C': '017145',
  '华宝纳斯达克精选股票(QDII)C': '017437',
  '鹏华碳中和主题混合C': '016531',
  '永赢先锋半导体智选混合发起C': '025209',
  '广发中证港股通非银ETF发起式联接C': '020501',
  '广发中证香港创新药ETF发起式联接(QDII)C': '019671',
  '易方达中证红利ETF联接C': '009052',
  '永赢先进制造智选混合发起C': '018125',
  '永赢信息产业智选混合发起C': '023754',
  '易方达恒生红利低波ETF联接C': '021458',
  '易方达恒生科技ETF联接(QDII)C': '013309',
  '南方中证1000ETF发起联接C': '011861',
  '华夏国证自由现金流ETF发起式联接C': '023918',
};

async function fixCodes() {
  try {
    await db.initDatabase();
    const rows = await db.getPositions();

    console.log('=== 开始修复基金代码 ===\n');

    let fixCount = 0;

    for (const row of rows) {
      if (!row.isFund) {
        console.log(`跳过股票: ${row.name} (${row.code})`);
        continue;
      }

      const correctCode = codeFixMap[row.name];
      if (correctCode && row.code !== correctCode) {
        console.log(`修复: ${row.name}`);
        console.log(`  原代码: ${row.code} → 新代码: ${correctCode}`);

        await db.updatePosition(row.id, { code: correctCode });
        fixCount++;
        console.log('  ✓ 已更新\n');
      } else if (correctCode && row.code === correctCode) {
        console.log(`正确: ${row.name} (${row.code})\n`);
      } else {
        console.log(`未知: ${row.name} (${row.code}) - 没有找到映射\n`);
      }
    }

    console.log(`\n=== 修复完成 ===`);
    console.log(`共修复 ${fixCount} 条记录`);

    // 验证修复结果
    console.log('\n=== 验证修复结果 ===\n');
    const fixedRows = await db.getPositions();
    fixedRows.forEach(r => {
      if (r.isFund) {
        console.log(`${r.name}: ${r.code}`);
      }
    });

    process.exit(0);
  } catch (error) {
    console.error('修复失败:', error);
    process.exit(1);
  }
}

fixCodes();
