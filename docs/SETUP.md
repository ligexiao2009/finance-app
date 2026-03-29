# 环境变量设置完成

## ✅ 已完成

1. **创建 `.env` 文件**
   - 包含 Supabase 数据库连接字符串
   - 包含 Server酱 配置
   - 包含定时任务时间配置

2. **安装依赖**
   - `dotenv` 包已安装
   - 自动加载环境变量

3. **更新代码**
   - `server.js` 开头添加 `require('dotenv').config()`
   - `initConfig()` 函数优先使用环境变量
   - `setupCronJob()` 函数优先使用环境变量
   - 更新提示信息从 `config.json` 改为 `.env`

4. **数据库配置**
   - `db.js` 已支持环境变量
   - 自动检测 Supabase 域名并启用 SSL

## 🔧 当前问题

**Supabase 数据库连接失败**
```
Error: getaddrinfo ENOTFOUND db.fymaaoluyrqubyzeltba.supabase.co
```

### 可能原因：
1. **域名错误** - 检查 Supabase 项目设置中的正确连接字符串
2. **网络/DNS 问题** - 检查网络连接和 DNS 解析
3. **Supabase 项目状态** - 确认项目未暂停或删除
4. **IP 白名单** - 需要在 Supabase 中允许当前 IP 地址访问

### 检查步骤：
```bash
# 1. 检查域名解析
nslookup db.fymaaoluyrqubyzeltba.supabase.co

# 2. 检查网络连接
ping -c 3 db.fymaaoluyrqubyzeltba.supabase.co

# 3. 测试数据库连接
DATABASE_URL="postgresql://postgres:AJYySPoOcrbu92@db.fymaaoluyrqubyzeltba.supabase.co:5432/postgres" node test-db.js

# 4. 检查 Supabase 控制台
# 登录 https://supabase.com/dashboard 查看项目状态
```

## 📝 使用说明

### 启动服务器：
```bash
# 方法1：直接运行（环境变量已设置）
node src/server.js

# 方法2：临时设置环境变量
DATABASE_URL="your_connection_string" node src/server.js
```

### 测试环境变量：
```bash
node -e "require('dotenv').config(); console.log(process.env.DATABASE_URL ? '✅ 环境变量已加载' : '❌ 环境变量未加载')"
```

### 迁移现有数据：
```bash
# 1. 初始化数据库表
node scripts/init-db.js

# 2. 迁移 JSON 数据到 PostgreSQL
node scripts/migrate-data.js
```

## 🔐 安全提醒

1. **`.env` 文件已添加到 `.gitignore`** - 不会提交到版本控制
2. **连接字符串包含密码** - 不要分享或公开
3. **Pages 测试说明** - 推送到 `dev` 分支后会重新触发 GitHub Pages 部署
4. **如需重置密码** - 到 Supabase 控制台重置

## 📞 故障排除

如果连接问题持续：

1. **检查 Supabase 连接信息**：
   - 登录 Supabase 控制台
   - 进入项目 → Settings → Database
   - 获取正确的连接字符串

2. **更新 `.env` 文件**：
   ```bash
   # 编辑 .env 文件
   nano .env

   # 更新 DATABASE_URL
   DATABASE_URL="新的连接字符串"
   ```

3. **测试连接**：
   ```bash
   # 重新测试
   node test-db.js
   ```

## 🎯 下一步

1. 解决数据库连接问题
2. 初始化数据库表：`node scripts/init-db.js`
3. 迁移数据：`node scripts/migrate-data.js`
4. 启动服务器：`node src/server.js`
5. 测试 API：`curl http://localhost:3000/api/data`
