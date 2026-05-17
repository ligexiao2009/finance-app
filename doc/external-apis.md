# 后端外部数据源 API 参考

## 一、腾讯财经 (gtimg.cn)

### 1.1 A股/港股实时行情

```
GET https://qt.gtimg.cn/q=s_sh600036,s_sz000001,s_hk00700
```

返回 GB18030 编码文本，每只股票一行 `v_s_xxx="字段~列表"` 格式。

**示例：**
```
curl "https://qt.gtimg.cn/q=s_sh600036"
# v_s_sh600036="1~招商银行~600036~42.500~..."

字段: 代码 | 名称 | 现价 | 涨跌额 | 涨跌幅 | 成交量 | 成交额 | ... | 市值
```

### 1.2 A股分时图

```
GET https://web.ifzq.gtimg.cn/appstock/app/minute/query?code=sh600036
```

**返回：** JSON，`data[code].data.data` 数组，每行 `"时间 价格 成交量 成交额"`

**示例：**
```json
{"code":0,"data":{"sh600036":{"data":{"data":["0930 42.50 12345 52478250","0931 42.52 8900 37818800",...]}}}}
```

### 1.3 A股/港股 K线（前复权）

```
GET https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?_var=kline_day&param=sh600036,day,,,365,qfq
```

**返回：** `kline_day={...}` JSONP，`data[code].qfqday` 数组 `[日期, 开, 收, 高, 低, 量]`

**示例：**
```json
{"code":0,"data":{"sh600036":{"qfqday":[["2026-05-15","42.10","42.50","42.80","41.90","50000000"],...]}}}
```

### 1.4 指数行情

```
GET https://qt.gtimg.cn/q=s_sh000001,s_sz399001,s_sz399006,s_hkHSTECH
```

- `sh000001` — 上证指数
- `sz399001` — 深证成指
- `sz399006` — 创业板指
- `hkHSTECH` — 恒生科技

---

## 二、新浪财经 (sina.com.cn)

### 2.1 美股实时行情

```
GET https://hq.sinajs.cn/list=gb_aapl
Referer: https://finance.sina.com.cn
```

**返回：** GBK 编码文本

**示例：**
```
var hq_str_gb_aapl="苹果,300.2300,0.68,2026-05-16 09:38:39,2.0200,297.9000,303.2000,296.5200,...";

字段: 名称 | 最新价 | 涨跌幅% | 时间 | 涨跌额 | 开盘 | 最高 | 最低 | 52周高 | 52周低 | 成交量 | ... | 市值
```

### 2.2 美股分时图（1分钟K线）

```
GET https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getMinK?symbol=aapl&type=1&num=400
Referer: https://finance.sina.com.cn
```

**返回：** JSON 数组

**示例：**
```json
[{"d":"2026-05-16 09:35:00","o":"297.90","h":"298.50","l":"297.50","c":"298.20","v":"500000"}]
```

### 2.3 美股K线（日线）

```
GET https://stock.finance.sina.com.cn/usstock/api/json_v2.php/US_MinKService.getDailyK?symbol=aapl&type=daily&num=365
Referer: https://finance.sina.com.cn
```

**示例：**
```json
[{"d":"1984-09-07","o":"26.50","h":"26.87","l":"26.25","c":"26.50","v":"2981600"},...]
```

---

## 三、天天基金 (eastmoney.com / 1234567.com.cn)

### 3.1 基金盘中估值

```
GET http://fundgz.1234567.com.cn/js/005827.js
```

**返回：** JSONP `jsonpgz({...})`

**示例：**
```json
jsonpgz({"fundcode":"005827","name":"易方达蓝筹精选混合","jzrq":"2026-05-15","dwjz":"1.8765","gsz":"1.8900","gszzl":"0.72","gztime":"2026-05-16 14:30"})
```

| 字段 | 含义 |
|------|------|
| jzrq | 净值日期 |
| dwjz | 单位净值 |
| gsz | 估算值 |
| gszzl | 估算涨跌幅% |
| gztime | 估算时间 |

### 3.2 基金历史净值

```
GET http://fund.eastmoney.com/pingzhongdata/005827.js
```

**返回：** JS 脚本，变量 `Data_netWorthTrend` 包含净值数组

**关键变量：**
- `Data_netWorthTrend` — `[{y: 净值*10000, date: "YYYY-MM-DD"}]`
- `Data_ACWorthTrend` — `[{y: 累计净值*10000, date}]`
- `Data_rateInSimilarPersent` — 同类排名百分比

### 3.3 基金重仓股

```
GET https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=005827&topline=10
Referer: https://fund.eastmoney.com
```

**返回：** HTML 片段，`var apidata={...}` 包含持仓

### 3.4 基金代码搜索

```
GET http://fund.eastmoney.com/js/fundcode_search.js
```

**返回：** JS 脚本，`var r = [["005827","易方达蓝筹精选混合","",""]]`

---

## 四、Gate.io（加密货币）

### 4.1 加密币行情

```
GET https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT
```

**返回：** JSON

**示例：**
```json
[{"currency_pair":"BTC_USDT","last":"105234.5","change_percentage":"2.35","base_volume":"12345","high_24h":"106000","low_24h":"103500"}]
```

---

## 附录：代码索引

| 文件 | 负责 |
|------|------|
| `src/utils/stock-detail.js` | A股/港股/美股：行情、K线、分时 |
| `src/utils/quotes.js` | 批量行情 |
| `src/utils/kline.js` | A股/港股K线（备选源） |
| `src/utils/fund-detail.js` | 基金详情、净值、持仓 |
| `src/utils/fund-drawdown.js` | 基金回撤计算 |
| `src/routes/fund.js` | 基金盘中估值 API |
| `src/routes/market.js` | 指数行情、加密币行情 |
| `src/routes/fund-screenshot.js` | 基金代码搜索 |
