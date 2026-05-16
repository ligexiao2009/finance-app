# 后端 Node.js 常用法速查

## 项目结构
```
src/
  server.js          # 主入口
  middleware/        # 中间件（auth, common）
  routes/            # 路由模块
  services/          # 业务服务
  utils/             # 工具（fund-detail, stock-detail, fund-drawdown）
  db/                # 数据库（db.js, schema.sql, migration-users.sql）
```

## 数据源
| 接口 | 用途 |
|------|------|
| `qt.gtimg.cn` | A股/港股/美股/基金实时行情 |
| `fund.eastmoney.com/pingzhongdata` | 基金净值、收益、持仓、基金经理 |
| `fundf10.eastmoney.com/FundArchivesDatas.aspx` | 基金重仓股明细（含占比） |
| `web.ifzq.gtimg.cn/appstock/app/fqkline/get` | 前复权 K 线 |
| `web.ifzq.gtimg.cn/appstock/app/minute/query` | 分时图分钟线 |
| `push2.eastmoney.com` | PE/PB（Node 端连不上） |

## 常用模式
| 模式 | 示例 |
|------|------|
| JWT 认证 | `jwt.sign(payload, secret, {expiresIn:'30d'})` |
| bcrypt 密码 | `bcrypt.hash(pw, 10)` / `bcrypt.compare(pw, hash)` |
| PG 查询 | `await db.query('SELECT * FROM t WHERE id=$1', [id])` |
| 并行请求 | `const [a, b, c] = await Promise.all([...])` |

## 常见坑
- `snakeToCamel` 会把纯数字字符串转 number，id/code/categoryId 要排除
- PG DECIMAL 返回 string，需 `parseFloat` 转 number
- 日期用本地时间 `getFullYear/getMonth/getDate`，别用 `toISOString()`（UTC）
- 美股腾讯行情前缀是 `us`，港股 `hk`，A股 `sh/sz`
- PG 连接需 `SET timezone = 'Asia/Shanghai'`
- `require` 会缓存模块，改完代码需重启
- `node-fetch` 已废弃，Node 18+ 内置 `fetch`
