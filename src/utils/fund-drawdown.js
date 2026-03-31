/**
 * 基金最大回撤计算模块
 * 通过天天基金API获取历史净值数据，计算最大回撤
 */

const fetch = require('node-fetch');

// ==================== 获取基金名称 ====================
async function fetchFundName(fundCode) {
  try {
    const url = `http://fundgz.1234567.com.cn/js/${fundCode}.js`;
    const response = await fetch(url);
    const text = await response.text();
    // 解析JSONP: jsonpgz({"name":"xxx",...});
    // 使用更精确的正则，只匹配花括号内的内容
    const jsonMatch = text.match(/jsonpgz\((\{.*?\})\s*\);?/s);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      return data.name || '';
    }
    return '';
  } catch (error) {
    console.error(`获取基金 ${fundCode} 名称失败:`, error.message);
    return '';
  }
}

// ==================== 获取基金历史净值 ====================
async function fetchFundHistoryNav(fundCode, days = 365) {
  const endDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  const startDateObj = new Date(startDate.slice(0, 4), parseInt(startDate.slice(4, 6)) - 1, startDate.slice(6, 8));
  
  // 天天基金API每页最多40条，需要分页获取
  const allNavList = [];
  let page = 1;
  const perPage = 40;
  
  try {
    while (true) {
      const url = `http://fund.eastmoney.com/f10/F10DataApi.aspx?type=lsjz&code=${fundCode}&page=${page}&sdate=${startDate}&edate=${endDate}&per=${perPage}`;
      const response = await fetch(url);
      const html = await response.text();
      const navList = parseFundNavHtml(html);
      
      if (navList.length === 0) break; // 没有更多数据
      
      // 过滤掉早于startDate的数据
      const filteredList = navList.filter(item => {
        const itemDate = new Date(item.date.slice(0, 4), parseInt(item.date.slice(5, 7)) - 1, item.date.slice(8, 10));
        return itemDate >= startDateObj;
      });
      
      allNavList.push(...filteredList);
      
      if (navList.length < perPage) break; // 最后一页
      
      // 如果最后一条数据已经早于startDate，停止分页
      const lastItem = navList[navList.length - 1];
      const lastDate = new Date(lastItem.date.slice(0, 4), parseInt(lastItem.date.slice(5, 7)) - 1, lastItem.date.slice(8, 10));
      if (lastDate < startDateObj) break;
      
      page++;
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // 去重并按日期升序排列
    const uniqueMap = new Map();
    for (const item of allNavList) {
      if (!uniqueMap.has(item.date)) {
        uniqueMap.set(item.date, item);
      }
    }
    return Array.from(uniqueMap.values()).sort((a, b) => a.date.localeCompare(b.date));
    
  } catch (error) {
    console.error(`获取基金 ${fundCode} 历史净值失败:`, error.message);
    return [];
  }
}

// 解析HTML表格获取净值数据
function parseFundNavHtml(html) {
  const navList = [];
  // 匹配表格行：<tr><td>日期</td><td class='tor bold'>单位净值</td><td>累计净值</td><td class='tor bold red'>日增长率</td>...</tr>
  const rowRegex = /<tr><td>(\d{4}-\d{2}-\d{2})<\/td><td[^>]*>([\d.]+)<\/td><td[^>]*>([\d.]+)<\/td>/g;
  
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    navList.push({
      date: match[1],
      nav: parseFloat(match[2]),        // 单位净值
      accumulatedNav: parseFloat(match[3]) // 累计净值
    });
  }
  
  // 按日期升序排列
  return navList.sort((a, b) => a.date.localeCompare(b.date));
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
    }
  }

  return {
    maxDrawdown: maxDrawdown.toFixed(4),
    maxDrawdownPercent: maxDrawdownPercent.toFixed(2),
    peakDate: startPeakDate,
    troughDate: startTroughDate,
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

// ==================== 综合分析 ====================
async function analyzeFund(fundCode, days = 365) {
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
  
  const result = {
    success: true,
    fundCode,
    fundName,
    dataRange: {
      startDate: navList[0].date,
      endDate: navList[navList.length - 1].date,
      dataPoints: navList.length
    },
    maxDrawdown,
    returnData
  };
  
  console.log(`\n分析结果:`);
  console.log(`  数据区间: ${result.dataRange.startDate} ~ ${result.dataRange.endDate}`);
  console.log(`  区间收益: ${returnData.returnPercent}%`);
  console.log(`  最大回撤: ${maxDrawdown.maxDrawdownPercent}%`);
  console.log(`  回撤区间: ${maxDrawdown.peakDate} -> ${maxDrawdown.troughDate}`);
  console.log('========== 分析完成 ==========\n');
  
  return result;
}

// ==================== 批量分析多只基金 ====================
async function analyzeMultipleFunds(fundCodes, days = 365) {
  const results = [];
  
  for (const code of fundCodes) {
    const result = await analyzeFund(code, days);
    results.push(result);
    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 500));
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
