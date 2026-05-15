# 资产管理系统 - 后端

Node.js HTTP 服务，端口 4000。

## 核心文件
- `src/server.js` — 主入口，路由 + 定时任务
- `src/utils/fund-detail.js` — 基金详情（解析东方财富 pingzhongdata）
- `src/utils/fund-drawdown.js` — 基金回撤分析
- `src/db/db.js` — PostgreSQL 数据库操作

## 数据源
- 腾讯行情 `qt.gtimg.cn`
- 东方财富 `fund.eastmoney.com/pingzhongdata/{code}.js`
- 天天基金 `fundgz.1234567.com.cn`
- 新浪港股 `hq.sinajs.cn`

## 命令
- 启动: `node src/server.js`
- 注意修改代码后需重启服务，缓存 TTL 10分钟
