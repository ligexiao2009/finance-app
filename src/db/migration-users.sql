-- 多用户支持迁移脚本

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(200) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 各表加 user_id
ALTER TABLE positions ADD COLUMN IF NOT EXISTS user_id VARCHAR(50) DEFAULT 'default';
ALTER TABLE pending_trades ADD COLUMN IF NOT EXISTS user_id VARCHAR(50) DEFAULT 'default';
ALTER TABLE trade_history ADD COLUMN IF NOT EXISTS user_id VARCHAR(50) DEFAULT 'default';
ALTER TABLE daily_profits ADD COLUMN IF NOT EXISTS user_id VARCHAR(50) DEFAULT 'default';
ALTER TABLE asset_records ADD COLUMN IF NOT EXISTS user_id VARCHAR(50) DEFAULT 'default';
ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS user_id VARCHAR(50) DEFAULT 'default';

-- 每日收益加明细
ALTER TABLE daily_profits ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '[]';

-- 每日收益按用户去重
ALTER TABLE daily_profits DROP CONSTRAINT IF EXISTS daily_profits_date_key;
ALTER TABLE daily_profits ADD CONSTRAINT daily_profits_date_user_unique UNIQUE (date, user_id);
