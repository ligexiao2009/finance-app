/**
 * 每日收益计算服务
 */
const db = require('../db/db');
const { fetchStockPrice, fetchFundNetValue } = require('../utils/quotes');

async function calculateAndSaveDailyProfit() {
  console.log('\n========== 开始计算每日收益 ==========');
  const allRows = await db.getPositions();
  const now = new Date();
  const dateStr = now.getFullYear().toString() + '-' +
    (now.getMonth() + 1).toString().padStart(2, '0') + '-' +
    now.getDate().toString().padStart(2, '0');
  const todayStr = now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0');
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.getFullYear().toString() +
    (yesterday.getMonth() + 1).toString().padStart(2, '0') +
    yesterday.getDate().toString().padStart(2, '0');
  const hour = now.getHours();
  const minute = now.getMinutes();
  const isTradingMorning = (hour > 9 || (hour === 9 && minute >= 30)) && hour < 15;

  // 按用户分组
  const userMap = {};
  for (const row of allRows) {
    const uid = row.user_id || row.userId || 'default';
    if (!userMap[uid]) userMap[uid] = [];
    userMap[uid].push(row);
  }

  for (const [userId, rows] of Object.entries(userMap)) {
    let stockToday = 0, fundToday = 0;
    const details = [];
    const stocks = rows.filter(r => !r.isFund && r.code);
    const funds = rows.filter(r => r.isFund && r.code);

    const hkdRate = parseFloat(await db.getConfig('hkd_cny_rate')) || 0.92;
    const usdRate = parseFloat(await db.getConfig('crypto_fx')) || 7.2;

    for (const stock of stocks) {
      const stockData = await fetchStockPrice(stock.code);
      if (stockData && stockData.price > 0 && stock.shares > 0) {
        let price = stockData.price;
        if (stock.code.length === 5) price *= hkdRate;
        const mkt = stock.shares * price;
        const prevMkt = (1 + stockData.change / 100) !== 0 ? mkt / (1 + stockData.change / 100) : mkt;
        const today = prevMkt * (stockData.change / 100);
        stockToday += today;
        details.push({ code: stock.code, name: stock.name || stock.code, type: 'stock', change: stockData.change, profit: Math.round(today) });
      }
    }

    for (const fund of funds) {
      const fundData = await fetchFundNetValue(fund.code);
      if (fundData && fundData.netValue > 0 && fund.shares > 0) {
        let adjustedPriceDate = fundData.priceDate;
        if (fund.isOverseas && adjustedPriceDate && adjustedPriceDate.length === 8) {
          const year = parseInt(adjustedPriceDate.substr(0, 4));
          const month = parseInt(adjustedPriceDate.substr(4, 2)) - 1;
          const day = parseInt(adjustedPriceDate.substr(6, 2));
          const date = new Date(year, month, day);
          date.setDate(date.getDate() + 1);
          adjustedPriceDate = `${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
        }
        let isTodayUpdated = false;
        if (adjustedPriceDate === todayStr) isTodayUpdated = true;
        else if (adjustedPriceDate === yesterdayStr) isTodayUpdated = !isTradingMorning && hour < 15;

        if (isTodayUpdated) {
          const mkt = fund.shares * fundData.netValue;
          const prevMkt = (1 + fundData.change / 100) !== 0 ? mkt / (1 + fundData.change / 100) : mkt;
          const today = prevMkt * (fundData.change / 100);
          fundToday += today;
          details.push({ code: fund.code, name: fund.name || fund.code, type: 'fund', change: fundData.change, profit: Math.round(today) });
        }
      }
    }

    const profitRecord = {
      date: dateStr,
      stockToday: Math.round(stockToday),
      fundToday: Math.round(fundToday),
      totalToday: Math.round(stockToday + fundToday),
      details: JSON.stringify(details),
      userId,
    };

    await db.createDailyProfit(profitRecord);
    console.log(`用户 ${userId}: 股票 ¥${profitRecord.stockToday}, 基金 ¥${profitRecord.fundToday}, 合计 ¥${profitRecord.totalToday}`);
  }

  console.log('========== 收益计算完成 ==========\n');
}

module.exports = { calculateAndSaveDailyProfit };
