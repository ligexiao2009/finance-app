/**
 * 基金最大回撤计算模块
 * 通过天天基金API获取历史净值数据，计算最大回撤
 */

const fetch = require('node-fetch');

// 数据缓存
const navCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10分钟缓存

function formatFundDate(value) {
  return new Intl.DateTimeFormat('sv-SE').format(new Date(value));
}

function subtractDaysFromDateString(dateString, days) {
  if (!dateString) return '';
  const anchorDate = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(anchorDate.getTime())) return '';
  anchorDate.setDate(anchorDate.getDate() - days);
  return anchorDate.toISOString().slice(0, 10);
}

function subtractYearsFromDateString(dateString, years) {
  if (!dateString) return '';
  const anchorDate = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(anchorDate.getTime())) return '';
  anchorDate.setFullYear(anchorDate.getFullYear() - years);
  return anchorDate.toISOString().slice(0, 10);
}

// ==================== 获取基金名称 ====================
async function fetchFundName(fundCode) {
  try {
    // 使用腾讯财经接口获取基金名称
    const sym = 'jj' + fundCode;
    const url = `https://qt.gtimg.cn/q=s_${sym}`;
    const response = await fetch(url);

    // 解码 GBK 编码
    const buffer = await response.arrayBuffer();
    const text = new TextDecoder('gb18030').decode(buffer);

    if (text && text.indexOf('~') > -1) {
      const parts = text.split('~');
      const name = parts[1] || '';
      return name.replace('[基金] ', '');
    }
    return '';
  } catch (error) {
    console.error(`获取基金 ${fundCode} 名称失败:`, error.message);
    return '';
  }
}

// ==================== 获取基金历史净值 (使用 pingzhongdata 接口) ====================
async function fetchFundHistoryNav(fundCode, days = 365) {
  const cacheKey = `nav:${fundCode}`;
  const now = Date.now();

  // 检查缓存
  const cached = navCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    console.log(`[缓存命中] 基金 ${fundCode} 历史净值`);
  } else {
    // 从 API 获取完整历史数据
    try {
      const url = `http://fund.eastmoney.com/pingzhongdata/${fundCode}.js`;
      const response = await fetch(url);
      const text = await response.text();

      const unitMatch = text.match(/Data_netWorthTrend\s*=\s*(\[.*?\]);/s);
      if (!unitMatch) {
        console.error(`解析基金 ${fundCode} 净值数据失败: 未找到 Data_netWorthTrend`);
        return [];
      }

      const unitData = JSON.parse(unitMatch[1]);
      const accumMatch = text.match(/Data_ACWorthTrend\s*=\s*(\[\[.*?\]\]);/s);
      const accumData = accumMatch ? JSON.parse(accumMatch[1]) : [];

      const unitNavList = unitData
        .map(item => ({
          date: formatFundDate(item.x),
          unitNav: Number(item.y),
          equityReturn: Number(item.equityReturn)
        }))
        .filter(item => item.date && Number.isFinite(item.unitNav));

      const accumNavMap = new Map(
        accumData
          .map(item => ({
            date: formatFundDate(item[0]),
            accumNav: Number(item[1])
          }))
          .filter(item => item.date && Number.isFinite(item.accumNav))
          .map(item => [item.date, item.accumNav])
      );

      let adjustedNav = 1;
      const fullNavList = unitNavList.map((item, index) => {
        if (index === 0) {
          adjustedNav = 1;
        } else if (Number.isFinite(item.equityReturn)) {
          adjustedNav *= (1 + item.equityReturn / 100);
        } else if (Number.isFinite(item.unitNav) && Number.isFinite(unitNavList[index - 1]?.unitNav) && unitNavList[index - 1].unitNav > 0) {
          adjustedNav *= (item.unitNav / unitNavList[index - 1].unitNav);
        } else if (Number.isFinite(accumNavMap.get(item.date)) && Number.isFinite(accumNavMap.get(unitNavList[index - 1]?.date))) {
          const prevAccumNav = accumNavMap.get(unitNavList[index - 1].date);
          const currentAccumNav = accumNavMap.get(item.date);
          if (prevAccumNav > 0) adjustedNav *= (currentAccumNav / prevAccumNav);
        }

        return {
          date: item.date,
          nav: adjustedNav,
          unitNav: item.unitNav,
          accumNav: accumNavMap.get(item.date) ?? null,
          equityReturn: Number.isFinite(item.equityReturn) ? item.equityReturn : null
        };
      });

      // 存入缓存
      navCache.set(cacheKey, {
        data: fullNavList,
        expiresAt: now + CACHE_TTL_MS
      });

      console.log(`[缓存更新] 基金 ${fundCode} 历史净值 (${fullNavList.length} 条, ${unitNavList.some(item => Number.isFinite(item.equityReturn)) ? '日收益复权' : accumNavMap.size ? '累计净值' : '单位净值'}口径)`);
    } catch (error) {
      console.error(`获取基金 ${fundCode} 历史净值失败:`, error.message);
      return [];
    }
  }

  const fullNavList = navCache.get(cacheKey).data;

  // 根据请求的天数过滤数据
  if (days > 0) {
    const latestDateStr = fullNavList[fullNavList.length - 1]?.date;
    const cutoffDateStr = subtractDaysFromDateString(latestDateStr, days);
    if (!cutoffDateStr) return fullNavList;
    return fullNavList.filter(item => item.date >= cutoffDateStr);
  }

  return fullNavList;
}

// ==================== 计算最大回撤 ====================
function calculateMaxDrawdown(navList) {
  if (!navList || navList.length < 2) {
    return null;
  }

  let maxDrawdown = 0;          // 最大回撤
  let maxDrawdownPercent = 0;   // 最大回撤百分比
  let peak = navList[0].nav;    // 峰值净值
  let peakDate = navList[0].date; // 峰值日期
  let troughDate = '';          // 谷值日期

  let startPeakDate = navList[0].date;
  let startTroughDate = navList[0].date;
  let peakNavAtDrawdown = navList[0].nav; // 最大回撤发生时的峰值净值

  for (let i = 1; i < navList.length; i++) {
    const currentNav = navList[i].nav;

    // 更新峰值
    if (currentNav > peak) {
      peak = currentNav;
      peakDate = navList[i].date;
    }

    // 计算当前回撤
    const drawdown = peak - currentNav;
    const drawdownPercent = (drawdown / peak) * 100;

    // 更新最大回撤
    if (drawdownPercent > maxDrawdownPercent) {
      maxDrawdownPercent = drawdownPercent;
      maxDrawdown = drawdown;
      startPeakDate = peakDate;
      startTroughDate = navList[i].date;
      peakNavAtDrawdown = peak; // 记录此时的峰值净值
    }
  }

  // 计算修复区间：从最低点回到前期高点所需的时间和幅度
  let recoveryDate = null;    // 修复日期（回到前期高点的日期）
  let recoveryDays = 0;       // 修复天数
  let recovered = false;      // 是否已经修复
  let currentRecoveryPercent = 0; // 当前已反弹百分比（从最低点到最新）
  let remainingRecoveryPercent = 0; // 剩余需要反弹百分比（从最新到前期高点）

  // 找到最低点的索引
  const troughIndex = navList.findIndex(n => n.date === startTroughDate);
  if (troughIndex !== -1) {
    const troughNav = navList[troughIndex].nav;
    const latestNav = navList[navList.length - 1].nav;

    // 从最低点之后开始查找是否已修复
    for (let i = troughIndex + 1; i < navList.length; i++) {
      if (navList[i].nav >= peakNavAtDrawdown) {
        recoveryDate = navList[i].date;
        recovered = true;
        // 计算修复天数（交易日）
        recoveryDays = i - troughIndex;
        break;
      }
    }

    // 计算反弹百分比（无论是否已修复）
    if (troughNav > 0) {
      currentRecoveryPercent = ((latestNav - troughNav) / troughNav) * 100;
    }
    if (latestNav > 0 && latestNav < peakNavAtDrawdown) {
      remainingRecoveryPercent = ((peakNavAtDrawdown - latestNav) / latestNav) * 100;
    }
  }

  return {
    maxDrawdown: maxDrawdown.toFixed(4),
    maxDrawdownPercent: maxDrawdownPercent.toFixed(2),
    peakDate: startPeakDate,
    troughDate: startTroughDate,
    peakNav: peakNavAtDrawdown.toFixed(4), // 最大回撤时的峰值净值
    // 修复区间数据
    recovered,
    recoveryDate,
    recoveryDays,
    currentRecoveryPercent: currentRecoveryPercent.toFixed(2),
    remainingRecoveryPercent: remainingRecoveryPercent.toFixed(2),
    dataPoints: navList.length
  };
}

// ==================== 计算区间收益 ====================
function calculateReturn(navList) {
  if (!navList || navList.length < 2) {
    return null;
  }

  const startNav = navList[0].nav;
  const endNav = navList[navList.length - 1].nav;
  const returnPercent = ((endNav - startNav) / startNav) * 100;

  return {
    startDate: navList[0].date,
    endDate: navList[navList.length - 1].date,
    startNav: startNav,
    endNav: endNav,
    returnPercent: returnPercent.toFixed(2)
  };
}

function calculateAnnualizedReturn(navList) {
  if (!navList || navList.length < 2) return null;

  const latestItem = navList[navList.length - 1];
  const latestDate = latestItem?.date;
  const latestNav = latestItem?.nav;
  if (!latestDate || !Number.isFinite(latestNav) || latestNav <= 0) return null;

  const periods = [5, 3, 2];
  for (const years of periods) {
    const cutoffDate = subtractYearsFromDateString(latestDate, years);
    if (!cutoffDate) continue;
    const startIndex = navList.findIndex(item => item.date >= cutoffDate);
    if (startIndex < 0) continue;

    const startItem = navList[startIndex];
    const startNav = startItem?.nav;
    if (!Number.isFinite(startNav) || startNav <= 0) continue;

    const startDateObj = new Date(`${startItem.date}T00:00:00`);
    const endDateObj = new Date(`${latestDate}T00:00:00`);
    const actualDays = Math.round((endDateObj - startDateObj) / (24 * 60 * 60 * 1000));
    const minimumDays = years * 365 - 10;
    if (actualDays < minimumDays) continue;

    const annualizedReturn = (Math.pow(latestNav / startNav, 365 / actualDays) - 1) * 100;
    if (!Number.isFinite(annualizedReturn)) continue;

    return {
      label: `近${years}年年化`,
      years,
      startDate: startItem.date,
      endDate: latestDate,
      returnPercent: annualizedReturn.toFixed(2)
    };
  }

  return null;
}

// ==================== 综合分析 ====================
async function analyzeFund(fundCode, days = 365, costBasis = null) {
  console.log(`\n========== 分析基金 ${fundCode} ==========`);
  console.log(`获取最近 ${days} 天净值数据...`);

  // 并行获取净值数据和基金名称
  const [navList, fundName] = await Promise.all([
    fetchFundHistoryNav(fundCode, days),
    fetchFundName(fundCode)
  ]);

  if (navList.length === 0) {
    console.log('获取净值数据失败');
    return { success: false, error: '获取净值数据失败', fundCode };
  }

  console.log(`成功获取 ${navList.length} 条净值记录`);

  const maxDrawdown = calculateMaxDrawdown(navList);
  const returnData = calculateReturn(navList);
  const annualizedReturn = calculateAnnualizedReturn(navList);
  if (returnData) {
    returnData.annualizedReturn = annualizedReturn;
  }

  // 计算持仓成本相对于期初净值的涨跌幅
  let costChangePercent = null;
  if (costBasis && costBasis > 0 && navList.length > 0) {
    const startNav = navList[0].unitNav || navList[0].nav;
    costChangePercent = ((costBasis - startNav) / startNav) * 100;
  }

  const result = {
    success: true,
    fundCode,
    fundName,
    costBasis, // 持仓成本
    costChangePercent, // 持仓成本相对于期初的涨跌幅
    dataRange: {
      startDate: navList[0].date,
      endDate: navList[navList.length - 1].date,
      dataPoints: navList.length
    },
    maxDrawdown,
    returnData,
    annualizedReturn,
    // 返回净值列表用于绘图
    navList: navList.map(n => ({ date: n.date, nav: n.nav, unitNav: n.unitNav, accumNav: n.accumNav, equityReturn: n.equityReturn }))
  };

  console.log(`\n分析结果:`);
  console.log(`  数据区间：${result.dataRange.startDate} ~ ${result.dataRange.endDate}`);
  console.log(`  区间收益：${returnData.returnPercent}%`);
  if (annualizedReturn) {
    console.log(`  ${annualizedReturn.label}：${annualizedReturn.returnPercent}%`);
  }
  console.log(`  最大回撤：${maxDrawdown.maxDrawdownPercent}%`);
  console.log(`  回撤区间：${maxDrawdown.peakDate} -> ${maxDrawdown.troughDate}`);
  if (costBasis) {
    console.log(`  持仓成本：${costBasis} (${costChangePercent.toFixed(2)}%)`);
  }
  console.log('========== 分析完成 ==========\n');

  return result;
}

// ==================== 批量分析多只基金 ====================
async function analyzeMultipleFunds(fundCodes, days = 365, costBasisMap = {}) {
  const results = [];

  for (const code of fundCodes) {
    const costBasis = costBasisMap[code] || null;
    const result = await analyzeFund(code, days, costBasis);
    results.push(result);
    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return results;
}

module.exports = {
  fetchFundHistoryNav,
  calculateMaxDrawdown,
  calculateReturn,
  analyzeFund,
  analyzeMultipleFunds
};
