const fetch = require('node-fetch');
const db = require('../db/db');

const FUND_DIRECTORY_CACHE_TTL_MS = Number(process.env.FUND_DIRECTORY_CACHE_TTL_MS || 24 * 60 * 60 * 1000);

let codeFixMap = {};
let normalizedCodeFixMap = {};
let fundDirectoryCache = {
  fetchedAt: 0,
  entries: [],
};

const FUND_COMPANY_PREFIXES = [
  '易方达', '南方', '华夏', '广发', '富国', '汇添富', '嘉实', '招商', '博时', '工银瑞信',
  '景顺长城', '兴证全球', '中欧', '鹏华', '天弘', '建信', '交银施罗德', '银华', '华安', '国泰',
  '大成', '农银汇理', '民生加银', '前海开源', '万家', '华宝', '平安', '中银', '国投瑞银', '国联安',
  '摩根', '摩根士丹利', '中信保诚', '诺安', '融通', '信达澳亚', '创金合信', '永赢', '华富', '浦银安盛'
];

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function normalizeFundOcrText(text) {
  if (!text) return '';

  return text
    .replace(/\r/g, '')
    .replace(/[“”"‘’']/g, '')
    .replace(/[＋]/g, '+')
    .replace(/[—–－]/g, '-')
    .replace(/[｜|]/g, ' ')
    .replace(/[。]/g, '.')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map(line => line
      .replace(/\s+/g, ' ')
      .replace(/占 比/g, '占比')
      .replace(/资 产/g, '资产')
      .replace(/日 收益/g, '日收益')
      .replace(/持 有 收益/g, '持有收益')
      .replace(/累 计 收益/g, '累计收益')
      .replace(/QDIIDC/gi, 'QDII')
      .replace(/QDIDC/gi, 'QDII')
      .replace(/QDII[Cc]/gi, 'QDII')
      .replace(/ETF 联 接/gi, 'ETF联接')
      .replace(/港股 通/g, '港股通')
      .trim()
    )
    .filter(Boolean)
    .join('\n');
}

function normalizeOcrNumericToken(token) {
  if (!token) return '';

  let value = String(token).trim();
  if (!value) return '';

  value = value
    .replace(/[oO]/g, '0')
    .replace(/[sS]/g, '5')
    .replace(/[lI]/g, '1')
    .replace(/[。．]/g, '.')
    .replace(/[，]/g, ',')
    .replace(/\s+/g, '');

  const signMatch = value.match(/^[+-]/);
  const sign = signMatch ? signMatch[0] : '';
  const unsigned = sign ? value.slice(1) : value;
  const lastDot = unsigned.lastIndexOf('.');
  const lastComma = unsigned.lastIndexOf(',');
  const decimalIndex = Math.max(lastDot, lastComma);

  let integerPart = unsigned;
  let decimalPart = '';
  if (decimalIndex >= 0) {
    integerPart = unsigned.slice(0, decimalIndex);
    decimalPart = unsigned.slice(decimalIndex + 1).replace(/[^\d]/g, '');
  }

  integerPart = integerPart.replace(/[^\d]/g, '');

  if (!integerPart && !decimalPart) {
    return '';
  }

  if (!integerPart) {
    integerPart = '0';
  }

  if (decimalPart) {
    return `${sign}${integerPart}.${decimalPart}`;
  }
  return `${sign}${integerPart}`;
}

function extractDecimalTokens(line) {
  if (!line) return [];

  const rawTokens = line
    .replace(/[“”"‘’']/g, '')
    .replace(/[二]/g, '-')
    .match(/[+-]?[\d.,OoSsIl]{1,20}/g) || [];

  return rawTokens
    .map(normalizeOcrNumericToken)
    .filter(token => /^\d+\.\d{2,4}$/.test(token) || /^[+-]\d+\.\d{2,4}$/.test(token));
}

function toNumber(value) {
  if (value == null) return null;
  const cleaned = normalizeOcrNumericToken(String(value)).replace(/,/g, '');
  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : null;
}

function parsePercentToken(token) {
  if (!token) return null;
  const cleaned = normalizeOcrNumericToken(String(token).replace(/%/g, ''));
  if (!cleaned) return null;

  let value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;

  if (!cleaned.includes('.') && Math.abs(value) >= 100 && Math.abs(value) <= 999) {
    value = value / 100;
  }

  return Math.round(value * 100) / 100;
}

function estimateDailyProfit(positionValue, changePercent) {
  if (!Number.isFinite(positionValue) || !Number.isFinite(changePercent)) {
    return null;
  }

  return Math.round(positionValue * (changePercent / 100) * 100) / 100;
}

function isDailyProfitSuspicious(positionValue, dailyProfit, changePercent) {
  if (!Number.isFinite(positionValue) || !Number.isFinite(dailyProfit) || !Number.isFinite(changePercent)) {
    return false;
  }

  const impliedPercent = positionValue === 0 ? 0 : (dailyProfit / positionValue) * 100;
  return Math.abs(impliedPercent - changePercent) > 0.12;
}

function deriveHoldingFromQuote(positionValue, profitLoss, netValue) {
  if (!Number.isFinite(positionValue) || positionValue <= 0 || !Number.isFinite(netValue) || netValue <= 0) {
    return null;
  }

  const shares = positionValue / netValue;
  if (!Number.isFinite(shares) || shares <= 0) {
    return null;
  }

  let cost = null;
  if (Number.isFinite(profitLoss)) {
    const totalCost = positionValue - profitLoss;
    cost = totalCost / shares;
  }

  return {
    shares: Math.round(shares * 100) / 100,
    cost: Number.isFinite(cost) ? Math.round(cost * 10000) / 10000 : null,
    netValue: Math.round(netValue * 10000) / 10000,
  };
}

function extractFundClassSuffix(name) {
  const normalized = String(name || '').replace(/\s+/g, '').trim();
  const match = normalized.match(/([A-C])$/i);
  return match ? match[1].toUpperCase() : '';
}

function normalizeFundNameForLookup(name, options = {}) {
  const { stripClassSuffix = false } = options;
  let normalized = String(name || '')
    .replace(/\s+/g, '')
    .replace(/[（(].*?[）)]/g, '')
    .replace(/[（(][A-Z0-9]+$/gi, '')
    .replace(/已?清仓/g, '')
    .replace(/持有/g, '')
    .replace(/QDIIDC/gi, 'QDII')
    .replace(/QDIDC/gi, 'QDII')
    .replace(/联接/g, '')
    .replace(/ETF/g, '')
    .replace(/LOF/g, '')
    .replace(/指数增强/g, '指数')
    .replace(/基金/g, '')
    .replace(/[|｜]/g, '')
    .trim();

  if (stripClassSuffix) {
    normalized = normalized.replace(/[A-C]$/i, '');
  }

  return normalized;
}

function cleanupFundDisplayName(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/QDIIDC/gi, 'QDII')
    .replace(/QDIDC/gi, 'QDII')
    .replace(/[（(]QDII$/i, '')
    .replace(/[（(][A-Z0-9]+$/gi, '')
    .trim();
}

function resolveFundCodeByName(name) {
  if (!name) return null;

  if (codeFixMap[name]) {
    return codeFixMap[name];
  }

  const normalizedName = normalizeFundNameForLookup(name);
  const strippedNormalizedName = normalizeFundNameForLookup(name, { stripClassSuffix: true });
  if (!normalizedName) {
    return null;
  }

  if (normalizedCodeFixMap[normalizedName]) {
    return normalizedCodeFixMap[normalizedName];
  }

  if (strippedNormalizedName && normalizedCodeFixMap[strippedNormalizedName]) {
    return normalizedCodeFixMap[strippedNormalizedName];
  }

  const candidates = Object.entries(normalizedCodeFixMap).filter(([candidate]) =>
    candidate.includes(normalizedName)
    || normalizedName.includes(candidate)
    || (strippedNormalizedName && (candidate.includes(strippedNormalizedName) || strippedNormalizedName.includes(candidate)))
  );

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => {
    const lengthDelta = Math.abs(a[0].length - normalizedName.length) - Math.abs(b[0].length - normalizedName.length);
    if (lengthDelta !== 0) return lengthDelta;
    return b[0].length - a[0].length;
  });

  return candidates[0][1];
}

function splitFundNameKeywords(name) {
  const normalizedName = normalizeFundNameForLookup(name);
  if (!normalizedName) return [];

  const parts = normalizedName.match(/[\u4e00-\u9fa5]+|\d+/g) || [];
  const keywords = new Set();

  parts.forEach(part => {
    if (part.length >= 2) {
      keywords.add(part);
    } else if (/^\d+$/.test(part)) {
      keywords.add(part);
    }
  });

  return Array.from(keywords);
}

function extractFundCompanyPrefix(name) {
  const normalizedName = normalizeFundNameForLookup(name);
  return FUND_COMPANY_PREFIXES.find(prefix => normalizedName.startsWith(prefix)) || '';
}

function computeFundNameMatchScore(queryName, candidateName) {
  const query = normalizeFundNameForLookup(queryName);
  const candidate = normalizeFundNameForLookup(candidateName);
  const queryClass = extractFundClassSuffix(queryName);
  const candidateClass = extractFundClassSuffix(candidateName);
  let score = 0;

  if (!query || !candidate) return -Infinity;
  if (query === candidate) return 10000;

  if (queryClass && candidateClass) {
    if (queryClass !== candidateClass) {
      return -Infinity;
    }
  }

  const queryCompany = extractFundCompanyPrefix(query);
  const candidateCompany = extractFundCompanyPrefix(candidate);
  if (queryCompany && candidateCompany && queryCompany !== candidateCompany) {
    return -Infinity;
  }

  if (queryClass && candidateClass && queryClass === candidateClass) {
    score += 1200;
  }
  if (queryCompany && candidateCompany && queryCompany === candidateCompany) {
    score += 1500;
  }
  if (candidate.includes(query) || query.includes(candidate)) {
    score += 2500 - Math.abs(candidate.length - query.length) * 10;
  }

  const queryKeywords = splitFundNameKeywords(query);
  const candidateKeywords = splitFundNameKeywords(candidate);
  const candidateKeywordSet = new Set(candidateKeywords);
  const matchedKeywords = queryKeywords.filter(keyword => candidateKeywordSet.has(keyword));
  score += matchedKeywords.length * 400;

  if (queryKeywords.length > 0 && matchedKeywords.length === queryKeywords.length) {
    score += 1200;
  }

  const queryChars = new Set(query.split(''));
  const candidateChars = new Set(candidate.split(''));
  let overlap = 0;
  queryChars.forEach(char => {
    if (candidateChars.has(char)) overlap++;
  });
  score += overlap * 40;

  if (query.slice(0, 2) && candidate.startsWith(query.slice(0, 2))) {
    score += 120;
  }

  const numericQuery = (query.match(/\d+/g) || []).join('');
  const numericCandidate = (candidate.match(/\d+/g) || []).join('');
  if (numericQuery && numericQuery === numericCandidate) {
    score += 300;
  }

  return score - Math.abs(candidate.length - query.length) * 5;
}

async function fetchFundDirectory() {
  const now = Date.now();
  if (fundDirectoryCache.entries.length > 0 && (now - fundDirectoryCache.fetchedAt) < FUND_DIRECTORY_CACHE_TTL_MS) {
    return fundDirectoryCache.entries;
  }

  const response = await fetch('http://fund.eastmoney.com/js/fundcode_search.js');
  if (!response.ok) {
    throw new Error(`基金目录接口响应错误: ${response.status}`);
  }

  const rawText = await response.text();
  const text = String(rawText || '').replace(/^\uFEFF/, '').trim();

  let arrayText = '';
  const match = text.match(/var\s+r\s*=\s*(\[[\s\S]*?\])\s*;?\s*$/);
  if (match) {
    arrayText = match[1];
  } else {
    const startIndex = text.indexOf('[');
    const endIndex = text.lastIndexOf(']');
    if (startIndex >= 0 && endIndex > startIndex) {
      arrayText = text.slice(startIndex, endIndex + 1);
    }
  }

  if (!arrayText) {
    throw new Error('基金目录接口格式无法解析');
  }

  let parsed;
  try {
    parsed = JSON.parse(arrayText);
  } catch (error) {
    throw new Error(`基金目录 JSON 解析失败: ${error.message}`);
  }

  const entries = parsed.map(item => ({
    code: item[0],
    shortPinyin: item[1],
    name: item[2],
    category: item[3],
    fullPinyin: item[4],
    normalizedName: normalizeFundNameForLookup(item[2]),
  })).filter(item => item.code && item.name);

  fundDirectoryCache = {
    fetchedAt: now,
    entries,
  };

  console.log(`已加载外部基金目录，共 ${entries.length} 条记录`);
  return entries;
}

async function resolveFundCodeFromDirectory(name) {
  const normalizedName = normalizeFundNameForLookup(name);
  if (!normalizedName) return null;

  const entries = await fetchFundDirectory();
  const scored = entries
    .map(entry => ({
      ...entry,
      score: computeFundNameMatchScore(normalizedName, entry.name),
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (!scored.length) {
    return null;
  }

  const best = scored[0];
  if (best.score < 1400) {
    return null;
  }

  console.log(`外部基金目录匹配: "${name}" -> "${best.name}" (${best.code}), score=${best.score}`);
  return best.code;
}

function parseAlipayFundTable(text) {
  const normalizedText = normalizeFundOcrText(text);
  const lines = normalizedText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const funds = [];
  let currentFund = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/[\u4e00-\u9fa5]{2,}.*(ETF|联接|基金|混合|股票|债券|指数)/)) {
      if (currentFund) {
        funds.push(currentFund);
      }

      const name = cleanupFundDisplayName(line);
      currentFund = {
        name,
        code: null,
        shares: null,
        cost: null,
        netValue: null,
        profitLoss: null,
        positionValue: null,
        dailyProfit: null,
        cumulativeProfit: null,
        isFund: true,
        estimated: false,
        isCleared: false
      };

      const codeInName = name.match(/(\d{6})/);
      if (codeInName) {
        currentFund.code = codeInName[1];
      }

      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const decimals = extractDecimalTokens(nextLine);

        if (decimals.length >= 3) {
          currentFund.positionValue = toNumber(decimals[0]);
          if (decimals.length >= 4) {
            currentFund.dailyProfit = toNumber(decimals[1]);
            currentFund.profitLoss = toNumber(decimals[2]);
            currentFund.cumulativeProfit = toNumber(decimals[3]);
          } else {
            currentFund.dailyProfit = null;
            currentFund.profitLoss = toNumber(decimals[1]);
            currentFund.cumulativeProfit = toNumber(decimals[2]);
          }

          i++;
        }
      }
    }

    if (line.includes('清仓') && currentFund) {
      currentFund.isCleared = true;
      currentFund.positionValue = 0;
      currentFund.shares = 0;
      currentFund.cost = null;
      currentFund.netValue = null;
    }

    if (line.includes('占比') && currentFund) {
      const percentages = line.match(/[+-]?[\d.,OoSsIl]+%/g);
      if (percentages && percentages.length >= 2) {
        const positionPercentValue = parsePercentToken(percentages[0]);
        const changePercentValue = parsePercentToken(percentages[1]);

        currentFund.positionPercent = positionPercentValue != null ? `${positionPercentValue.toFixed(2)}%` : percentages[0];
        currentFund.changePercent = changePercentValue != null ? `${changePercentValue >= 0 ? '+' : ''}${changePercentValue.toFixed(2)}%` : percentages[1];

        const numericChangePercent = changePercentValue;
        if (currentFund.dailyProfit == null || isDailyProfitSuspicious(currentFund.positionValue, currentFund.dailyProfit, numericChangePercent)) {
          currentFund.dailyProfitRaw = currentFund.dailyProfit;
          currentFund.dailyProfit = estimateDailyProfit(currentFund.positionValue, numericChangePercent);
          currentFund.dailyProfitEstimated = currentFund.dailyProfit != null;
        }
      }
    }

    if (!currentFund?.code) {
      const codeMatch = line.match(/\b(\d{6})\b/);
      if (codeMatch && currentFund) {
        currentFund.code = codeMatch[1];
      } else if (currentFund?.name) {
        currentFund.code = resolveFundCodeByName(currentFund.name);
      }
    }
  }

  if (currentFund) {
    funds.push(currentFund);
  }

  funds.forEach(fund => {
    if (!fund.isCleared && !fund.positionValue && fund.cumulativeProfit && fund.cumulativeProfit > 0) {
      fund.positionValue = Math.round(fund.cumulativeProfit / 0.2 * 100) / 100;
      fund.estimated = true;
    }
  });

  funds.forEach(fund => {
    if (!fund.code && fund.name) {
      fund.code = resolveFundCodeByName(fund.name);
    }
    if (fund.code) {
      console.log(`为基金"${fund.name}"使用映射代码: ${fund.code}`);
    }
  });

  console.log('支付宝表格解析结果:', funds);
  return funds;
}

async function enrichParsedFunds(funds, fetchQuotesBatch) {
  if (!Array.isArray(funds) || funds.length === 0) {
    return funds;
  }

  const quoteCandidates = funds.filter(fund => fund?.code && fund?.positionValue > 0);
  if (!quoteCandidates.length) {
    return funds;
  }

  let quotes = {};
  try {
    quotes = await fetchQuotesBatch(quoteCandidates.map(fund => ({ code: fund.code, isFund: true })));
  } catch (error) {
    console.error('补充基金净值失败:', error.message);
  }

  for (const fund of funds) {
    if (fund?.isCleared || !(fund?.code && fund.positionValue > 0)) {
      continue;
    }

    const quote = quotes[`${fund.code}:1`];
    const quoteNetValue = quote?.price;
    const derived = deriveHoldingFromQuote(fund.positionValue, fund.profitLoss, quoteNetValue);

    if (derived) {
      fund.netValue = derived.netValue;
      fund.shares = derived.shares;
      fund.cost = derived.cost;
      fund.holdingDerived = true;
      continue;
    }

    try {
      const existingPosition = await db.getPositionByCode(fund.code, true);
      if (existingPosition?.shares > 0 && existingPosition?.cost > 0) {
        fund.shares = existingPosition.shares;
        fund.cost = existingPosition.cost;
        fund.netValue = existingPosition.shares ? Math.round((fund.positionValue / existingPosition.shares) * 10000) / 10000 : null;
        fund.holdingDerived = false;
      }
    } catch (error) {
      console.error(`读取基金 ${fund.code} 现有持仓失败:`, error.message);
    }
  }

  return funds;
}

async function resolveMissingFundCodes(funds) {
  if (!Array.isArray(funds) || funds.length === 0) {
    return funds;
  }

  for (const fund of funds) {
    if (fund?.code || !fund?.name) {
      continue;
    }

    const localCode = resolveFundCodeByName(fund.name);
    if (localCode) {
      fund.code = localCode;
      continue;
    }

    try {
      fund.code = await resolveFundCodeFromDirectory(fund.name);
    } catch (error) {
      console.error(`外部基金目录匹配失败(${fund.name}):`, error.message);
    }
  }

  return funds;
}

function parseFundScreenshotText(text) {
  const normalizedText = normalizeFundOcrText(text);
  console.log('解析截图文本:', normalizedText);

  const alipayFunds = parseAlipayFundTable(normalizedText);
  if (alipayFunds.length > 0) {
    console.log('支付宝表格格式解析成功，找到', alipayFunds.length, '只基金');
    return {
      isMultiple: alipayFunds.length > 1,
      funds: alipayFunds,
      fundCount: alipayFunds.length,
      source: 'alipay'
    };
  }

  const result = {
    code: null,
    name: null,
    shares: null,
    cost: null,
    netValue: null,
    profitLoss: null,
    positionValue: null
  };

  const codeMatch = normalizedText.match(/\b(\d{6})\b/);
  if (codeMatch) {
    result.code = codeMatch[1];
  }

  const nameMatch = normalizedText.match(/[\u4e00-\u9fa5]{2,}(?:混合|股票|债券|指数|ETF|联接|基金)?/);
  if (nameMatch) {
    result.name = nameMatch[0].trim();
  }

  const sharesMatch = normalizedText.match(/(?:持有份额|份额)[\s:：]*([\d,.]+)(?:份)?/);
  if (sharesMatch) {
    result.shares = parseFloat(sharesMatch[1].replace(/,/g, ''));
  } else {
    const sharesAltMatch = normalizedText.match(/([\d,.]+)\s*份/);
    if (sharesAltMatch) {
      result.shares = parseFloat(sharesAltMatch[1].replace(/,/g, ''));
    }
  }

  const costMatch = normalizedText.match(/(?:持有成本|成本)[\s:：]*([\d,.]+)/);
  if (costMatch) {
    result.cost = parseFloat(costMatch[1].replace(/,/g, ''));
  }

  const netValueMatch = normalizedText.match(/(?:最新净值|净值)[\s:：]*([\d,.]+)/);
  if (netValueMatch) {
    result.netValue = parseFloat(netValueMatch[1].replace(/,/g, ''));
  }

  const profitMatch = normalizedText.match(/(?:持有收益|收益)[\s:：]*([+-]?[\d,.]+)/);
  if (profitMatch) {
    result.profitLoss = parseFloat(profitMatch[1].replace(/,/g, ''));
  }

  const positionValueMatch = normalizedText.match(/(?:持仓金额|金额)[\s:：]*([\d,.]+)/);
  if (positionValueMatch) {
    result.positionValue = parseFloat(positionValueMatch[1].replace(/,/g, ''));
  }

  console.log('单基金解析结果:', result);
  return result;
}

async function runTesseractOCR(imageBuffer) {
  const { createWorker } = require('tesseract.js');
  let worker = null;

  try {
    worker = await createWorker('chi_sim+eng');
    const { data: { text } } = await worker.recognize(imageBuffer);
    return text;
  } catch (error) {
    const message = String(error?.message || error || '');
    if (message.includes('TESSDATA_PREFIX') || message.includes('Failed loading language')) {
      throw new Error('Tesseract 中文语言包未正确安装');
    }
    throw error;
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch (_) {
      }
    }
  }
}

async function loadCodeFixMap() {
  try {
    const result = await db.query(
      'SELECT name, code FROM positions WHERE is_fund = true AND code IS NOT NULL AND name IS NOT NULL'
    );

    codeFixMap = {};
    normalizedCodeFixMap = {};
    result.rows.forEach(row => {
      codeFixMap[row.name] = row.code;
      const normalizedName = normalizeFundNameForLookup(row.name);
      if (normalizedName && !normalizedCodeFixMap[normalizedName]) {
        normalizedCodeFixMap[normalizedName] = row.code;
      }
    });

    console.log(`已加载基金代码映射，共 ${Object.keys(codeFixMap).length} 条记录`);
  } catch (error) {
    console.error('加载基金代码映射失败:', error);
    codeFixMap = {};
    normalizedCodeFixMap = {};
  }
}

async function handleFundScreenshotRoutes(req, res, { fetchQuotesBatch }) {
  if (req.method !== 'POST' || req.url !== '/api/upload-fund-screenshot') {
    return false;
  }

  try {
    const { imageBase64 } = await readJsonBody(req);
    if (!imageBase64) {
      sendJson(res, 400, { success: false, error: '缺少图片数据' });
      return true;
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');

    const ocrSource = 'tesseract';
    const ocrText = await runTesseractOCR(imageBuffer);

    console.log(`OCR识别结果(${ocrSource}):`, ocrText);

    let correctedText = normalizeFundOcrText(ocrText);
    const amountRegex = /20,(\d{3}\.\d{2})/g;
    const matches = [];
    let match;
    while ((match = amountRegex.exec(correctedText)) !== null) {
      matches.push({
        original: match[0],
        corrected: `26,${match[1]}`,
        index: match.index
      });
    }

    for (let i = matches.length - 1; i >= 0; i--) {
      const { original, corrected, index } = matches[i];
      const contextStart = Math.max(0, index - 30);
      const contextEnd = Math.min(correctedText.length, index + original.length + 30);
      const context = correctedText.slice(contextStart, contextEnd).toLowerCase();

      const fundKeywords = ['持仓', '金额', '市值', '成本', '净值', '收益', '盈亏', '占比'];
      const hasFundContext = fundKeywords.some(keyword => context.includes(keyword));

      if (hasFundContext) {
        correctedText = correctedText.slice(0, index) + corrected + correctedText.slice(index + original.length);
        console.log(`校正金额: ${original} -> ${corrected} (上下文: ${context})`);
      }
    }

    const fundInfo = parseFundScreenshotText(correctedText);

    if (fundInfo?.funds?.length) {
      await resolveMissingFundCodes(fundInfo.funds);
      await enrichParsedFunds(fundInfo.funds, fetchQuotesBatch);
    } else if (fundInfo?.code && fundInfo.positionValue > 0) {
      await enrichParsedFunds([fundInfo], fetchQuotesBatch);
    } else if (fundInfo?.name) {
      await resolveMissingFundCodes([fundInfo]);
      if (fundInfo.code && fundInfo.positionValue > 0) {
        await enrichParsedFunds([fundInfo], fetchQuotesBatch);
      }
    }

    sendJson(res, 200, {
      success: true,
      text: correctedText,
      fundInfo,
      ocrSource
    });
  } catch (error) {
    console.error('处理基金截图失败:', error);
    sendJson(res, 500, { success: false, error: error.message });
  }

  return true;
}

module.exports = {
  handleFundScreenshotRoutes,
  loadCodeFixMap,
};
