/**
 * 自动确认待确认交易服务
 */
const db = require('../db/db');
const { fetchFundNetValue } = require('../utils/quotes');

async function autoConfirmPendingTrades(invalidateCache, invalidateCacheByPrefix) {
  console.log('\n========== 开始自动确认待确认交易 ==========');
  const pendingTrades = await db.getPendingTrades();

  if (pendingTrades.length === 0) {
    console.log('没有待确认交易');
    console.log('========== 确认完成 ==========\n');
    return;
  }

  const now = new Date();
  const nowBeijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayStr = nowBeijing.toISOString().slice(0, 10);
  const yesterdayBeijing = new Date(nowBeijing);
  yesterdayBeijing.setDate(yesterdayBeijing.getDate() - 1);
  const yesterdayStr = yesterdayBeijing.toISOString().slice(0, 10);

  console.log(`今天(北京): ${todayStr}, 昨天(北京): ${yesterdayStr}`);
  console.log(`待确认交易数量: ${pendingTrades.length}`);

  let confirmedCount = 0;

  for (const trade of pendingTrades) {
    const tradeDateUTC = new Date(trade.createdAt);
    const tradeDateBeijing = new Date(tradeDateUTC.getTime() + 8 * 60 * 60 * 1000);
    const tradeDateStr = tradeDateBeijing.toISOString().slice(0, 10);

    let shouldConfirm = false;
    if (tradeDateStr === yesterdayStr && trade.isBefore15) shouldConfirm = true;
    else if (tradeDateStr < yesterdayStr) shouldConfirm = true;

    if (!shouldConfirm) continue;

    const row = await db.getPosition(trade.rowId);
    if (!row) continue;

    const fundData = await fetchFundNetValue(trade.code);
    if (!fundData || !fundData.netValue || fundData.netValue <= 0) continue;

    const tradeType = trade.type || 'add';
    if (tradeType === 'reduce') {
      const reduceShares = parseFloat(Number(trade.shares || 0).toFixed(2));
      if (!(reduceShares > 0) || reduceShares > (row.shares || 0)) continue;

      const remainShares = (row.shares || 0) - reduceShares;
      const redeemAmount = reduceShares * fundData.netValue;
      const updatedShares = parseFloat(remainShares.toFixed(2));

      await db.updatePosition(row.id, { shares: updatedShares, cost: row.cost });
      await db.createTradeRecord({
        id: trade.id, rowId: trade.rowId, type: 'reduce',
        amount: parseFloat(redeemAmount.toFixed(2)), shares: reduceShares,
        netValue: parseFloat(fundData.netValue.toFixed(4)),
        isBefore15: trade.isBefore15, createdAt: trade.createdAt, localDate: tradeDateStr,
      });
    } else {
      const newShares = trade.amount / fundData.netValue;
      const totalShares = (row.shares || 0) + newShares;
      const totalCost = ((row.shares || 0) * (row.cost || 0)) + trade.amount;
      const newCost = totalCost / totalShares;

      const updatedShares = parseFloat(totalShares.toFixed(2));
      const updatedCost = parseFloat(newCost.toFixed(4));
      const updatedPlanBuy = row.planBuy && row.planBuy > 0 ? Math.max(0, row.planBuy - trade.amount) : row.planBuy;

      await db.updatePosition(row.id, { shares: updatedShares, cost: updatedCost, planBuy: updatedPlanBuy });
      await db.createTradeRecord({
        id: trade.id, rowId: trade.rowId, type: 'add',
        amount: trade.amount, shares: parseFloat(newShares.toFixed(2)),
        netValue: parseFloat(fundData.netValue.toFixed(4)),
        isBefore15: trade.isBefore15, createdAt: trade.createdAt, localDate: tradeDateStr,
      });
    }

    await db.deletePendingTrade(trade.id);
    confirmedCount++;
    console.log(`  ✓ 确认成功: ${trade.name} (${trade.code})`);
  }

  if (confirmedCount > 0) {
    invalidateCache('app-settings', 'data', 'pending-trades', 'trade-history');
    invalidateCacheByPrefix('trade-history:');
    invalidateCacheByPrefix('quotes:');
    console.log(`\n自动确认完成！共确认 ${confirmedCount} 笔交易`);
  } else {
    console.log(`\n没有需要确认的交易`);
  }

  console.log('========== 确认完成 ==========\n');
}

module.exports = { autoConfirmPendingTrades };
