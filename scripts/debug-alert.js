// 调试基金提醒功能
require('dotenv').config();
const db = require('../src/db/db');

// 复制 server.js 中的函数
async function fetchFundNetValue(code) {
  const fetch = require('node-fetch');
  try {
    const sym = 'jj' + code;
    const url = `https://qt.gtimg.cn/q=s_${sym}`;
    const response = await fetch(url);
    const text = await response.text();

    if (text && text.indexOf('~') > -1) {
      const parts = text.split('~');
      let priceDate = '';
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] && /^\d{4}[-]?\d{2}[-]?\d{2}$/.test(parts[i])) {
          priceDate = parts[i].replace(/-/g, '');
          break;
        }
      }
      return {
        name: parts[1] ? parts[1].replace('[基金] ', '') : '',
        netValue: parseFloat(parts[3]) || 0,
        change: parseFloat(parts[5]) || 0,
        priceDate: priceDate
      };
    }
  } catch (e) {
    console.error('获取基金净值失败:', code, e.message);
  }
  return null;
}

async function debugAlert() {
  try {
    await db.initDatabase();
    console.log('✅ 数据库连接成功\n');

    // 1. 检查 Server酱 配置
    const configs = await db.getAllConfigs();
    const serverchanKey = process.env.SERVERCHAN_KEY || configs.serverchanKey || '';
    console.log('=== 1. Server酱 配置 ===');
    console.log('SERVERCHAN_KEY:', serverchanKey ? '已设置' : '未设置');
    if (!serverchanKey) {
      console.log('⚠️  警告: Server酱 Key 未设置，无法发送微信通知');
    }
    console.log('');

    // 2. 获取所有持仓
    const rows = await db.getPositions();
    console.log('=== 2. 所有持仓数据 ===');
    console.log('总持仓数:', rows.length);

    // 3. 筛选需要检查的基金
    const funds = rows.filter(r => r.isFund && r.alert && r.alert > 0 && r.code);
    console.log('设置了提醒的基金数:', funds.length);
    console.log('');

    if (funds.length === 0) {
      console.log('❌ 没有基金设置提醒阈值！请在前端页面为基金设置"涨跌提醒"值');
      console.log('\n提示:');
      console.log('  1. 在前端页面找到基金列');
      console.log('  2. 在"涨跌提醒"列输入一个数值（如 5 表示±5%提醒）');
      console.log('  3. 保存数据');
      process.exit(0);
    }

    // 4. 检查每只基金
    console.log('=== 3. 检查每只基金 ===\n');
    const alerts = [];

    for (const fund of funds) {
      console.log(`基金: ${fund.name || fund.code} (${fund.code})`);
      console.log(`  成本价: ${fund.cost}`);
      console.log(`  提醒阈值: ${fund.alert}%`);
      console.log(`  份额: ${fund.shares}`);

      // 获取基金数据
      const fundData = await fetchFundNetValue(fund.code);
      if (!fundData) {
        console.log('  ❌ 获取基金数据失败\n');
        continue;
      }

      console.log(`  基金名称: ${fundData.name}`);
      console.log(`  最新净值: ${fundData.netValue}`);
      console.log(`  涨跌幅: ${fundData.change}%`);
      console.log(`  净值日期: ${fundData.priceDate}`);

      if (fundData.netValue > 0 && fund.cost > 0) {
        const changePercent = ((fundData.netValue - fund.cost) / fund.cost) * 100;
        console.log(`  计算涨跌幅: ${changePercent.toFixed(2)}%`);
        console.log(`  绝对值: ${Math.abs(changePercent).toFixed(2)}%`);
        console.log(`  是否达到阈值: ${Math.abs(changePercent) >= fund.alert ? '✅ 是' : '❌ 否'}`);

        if (Math.abs(changePercent) >= fund.alert) {
          alerts.push({
            name: fund.name || fundData.name || fund.code,
            code: fund.code,
            cost: fund.cost,
            netValue: fundData.netValue,
            changePercent: changePercent,
            alert: fund.alert
          });
        }
      }
      console.log('');
    }

    // 5. 总结
    console.log('=== 4. 总结 ===');
    if (alerts.length > 0) {
      console.log(`✅ 有 ${alerts.length} 只基金达到提醒阈值:`);
      alerts.forEach(a => {
        console.log(`  - ${a.name}: ${a.changePercent >= 0 ? '+' : ''}${a.changePercent.toFixed(2)}% (阈值: ${a.alert}%)`);
      });
      if (!serverchanKey) {
        console.log('\n⚠️  但 Server酱 Key 未设置，无法发送微信通知');
      }
    } else {
      console.log('❌ 没有基金达到提醒阈值');
      console.log('\n可能的原因:');
      console.log('  1. 基金涨跌幅未达到设置的阈值');
      console.log('  2. 阈值设置过高');
      console.log('  3. 基金净值数据未更新');
    }

    process.exit(0);
  } catch (error) {
    console.error('调试失败:', error);
    process.exit(1);
  }
}

debugAlert();
