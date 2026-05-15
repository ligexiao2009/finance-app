/**
 * 基金涨跌提醒服务
 */
const db = require('../db/db');
const { fetchQuotesBatch } = require('../utils/quotes');
const { sendWechatMessage } = require('./wechat');

/** 格式化金额，添加千位分隔符 */
function formatMoney(amount) {
  if (typeof amount !== 'number') return '0.00';
  return amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function calculateFundAlertMetrics(fund, quoteData) {
  const netValue = quoteData.price;
  const todayChange = quoteData.change;
  const fundName = quoteData.name || fund.name || fund.code;

  if (!(netValue > 0 && fund.cost > 0 && fund.shares > 0)) return null;

  const changePercent = ((netValue - fund.cost) / fund.cost) * 100;
  const positionValue = fund.shares * netValue;
  const profitLoss = fund.shares * (netValue - fund.cost);
  const todayProfit = fund.shares * netValue * (todayChange / 100);

  return {
    name: fundName, code: fund.code, cost: fund.cost,
    netValue, changePercent, alert: fund.alert,
    shares: fund.shares, positionValue, profitLoss,
    todayChange, todayProfit,
  };
}

async function checkFundsAndAlert() {
  console.log('\n========== 开始检查基金涨跌提醒 ==========');

  try {
    const rows = await db.getPositions();
    const funds = rows.filter(r => r.isFund && r.code);
    console.log(`找到 ${funds.length} 只设置了提醒的基金`);

    if (funds.length === 0) {
      console.log('没有需要检查的基金');
      console.log('========== 检查完成 ==========\n');
      return;
    }

    const alerts = [];
    const lastBuyAlerts = [];

    const items = funds.map(fund => ({ code: fund.code, isFund: true }));
    const quotes = await fetchQuotesBatch(items);
    console.log(`批量获取 ${funds.length} 只基金数据完成`);

    for (const fund of funds) {
      const quoteKey = `${fund.code}:1`;
      const quoteData = quotes[quoteKey];
      if (!quoteData) continue;

      const metrics = calculateFundAlertMetrics(fund, quoteData);
      if (!metrics) continue;

      // 涨跌提醒阈值
      if (Math.abs(metrics.changePercent) >= metrics.alert) {
        alerts.push(metrics);
      }

      // 最近一次加仓变动提醒
      try {
        const tradeHistory = await db.getTradeHistoryByRowId(fund.id);
        if (tradeHistory && tradeHistory.length > 0) {
          const addRecords = tradeHistory
            .filter(record => record.type === 'add')
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

          if (addRecords.length > 0) {
            const lastAddRecord = addRecords[0];
            const lastAddNetValue = lastAddRecord.netValue || 0;
            if (lastAddNetValue > 0 && quoteData.price > 0) {
              const changeFromLastBuy = ((quoteData.price - lastAddNetValue) / lastAddNetValue) * 100;
              lastBuyAlerts.push({
                name: metrics.name, code: metrics.code,
                lastAddNetValue, currentNetValue: quoteData.price,
                changePercent: changeFromLastBuy,
                lastAddDate: lastAddRecord.createdAt ? new Date(lastAddRecord.createdAt).toLocaleDateString() : '未知',
              });
            }
          }
        }
      } catch (error) {
        console.log(`  获取交易历史失败: ${error.message}`);
      }
    }

    if (alerts.length > 0 || lastBuyAlerts.length > 0) {
      let title = '';
      let content = '';

      if (alerts.length > 0) {
        const totalTodayProfit = alerts.reduce((sum, a) => sum + a.todayProfit, 0);
        const totalPositionValue = alerts.reduce((sum, a) => sum + a.positionValue, 0);
        const totalProfitLoss = alerts.reduce((sum, a) => sum + a.profitLoss, 0);
        const todayReturnRate = totalPositionValue > 0 ? (totalTodayProfit / totalPositionValue) * 100 : 0;

        title = `【基金涨跌提醒】持仓¥${formatMoney(totalPositionValue)} 收益${todayReturnRate >= 0 ? '+' : ''}${todayReturnRate.toFixed(2)}%`;
        content = `## 基金涨跌提醒\n\n**汇总统计:**\n- 总持仓金额: ¥${formatMoney(totalPositionValue)}\n- 总持仓盈亏: ¥${formatMoney(totalProfitLoss)}\n- 今日总收益: ¥${formatMoney(totalTodayProfit)}\n- 今日收益率: ${todayReturnRate >= 0 ? '+' : ''}${todayReturnRate.toFixed(2)}%\n\n`;

        alerts.sort((a, b) => b.changePercent - a.changePercent);
        for (const a of alerts) {
          const isUp = a.changePercent >= 0;
          title += `${a.name} ${isUp ? '+' : ''}${a.changePercent.toFixed(2)}% `;
          content += `### ${isUp ? '🔴涨' : '🟢跌'} ${a.name} (${a.code})\n\n`;
          content += `- 涨跌幅: ${isUp ? '+' : ''}${a.changePercent.toFixed(2)}%\n`;
          content += `- 持仓金额: ¥${formatMoney(a.positionValue)}\n`;
          content += `- 持仓盈亏: ¥${formatMoney(a.profitLoss)}\n`;
          content += `- 今日涨幅: ${a.todayChange >= 0 ? '+' : ''}${a.todayChange.toFixed(2)}%\n`;
          content += `- 今日收益: ¥${formatMoney(a.todayProfit)}\n`;
        }
      }

      if (lastBuyAlerts.length > 0) {
        if (alerts.length === 0) {
          title = `【基金加仓变动提醒】${lastBuyAlerts.length}只基金`;
          content = `## 基金加仓变动提醒\n\n`;
        } else {
          content += `\n---\n\n## 基金加仓变动提醒\n\n`;
        }

        lastBuyAlerts.sort((a, b) => b.changePercent - a.changePercent);
        for (const alert of lastBuyAlerts) {
          const isUp = alert.changePercent >= 0;
          title += `${alert.name}${isUp ? '+' : ''}${alert.changePercent.toFixed(1)}% `;
          content += `### ${isUp ? '📈' : '📉'} ${alert.name} (${alert.code})\n\n`;
          content += `- 最近加仓净值: ${alert.lastAddNetValue.toFixed(4)}\n`;
          content += `- 当前净值: ${alert.currentNetValue.toFixed(4)}\n`;
          content += `- ${isUp ? '上涨' : '下跌'}幅度: ${isUp ? '+' : ''}${Math.abs(alert.changePercent).toFixed(2)}%\n`;
          content += `- 加仓日期: ${alert.lastAddDate}\n\n`;
        }
      }

      await sendWechatMessage(title.slice(0, 100), content);
    } else {
      console.log('没有基金达到提醒阈值');
    }
  } catch (error) {
    console.error('基金检查过程中发生错误:', error.message);
    await sendWechatMessage('【基金检查错误】', `## 基金检查发生错误\n\n错误信息: ${error.message}\n\n请检查服务器日志。`);
  }

  console.log('========== 检查完成 ==========\n');
}

module.exports = { checkFundsAndAlert, calculateFundAlertMetrics };
