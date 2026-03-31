-- PostgreSQL Schema for Stock Management System
-- Run this script to create all tables

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==================== 配置表 ====================
CREATE TABLE IF NOT EXISTS configs (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==================== 持仓表 ====================
CREATE TABLE IF NOT EXISTS positions (
    id VARCHAR(50) PRIMARY KEY,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    shares DECIMAL(15, 4) NOT NULL DEFAULT 0,
    cost DECIMAL(15, 4) NOT NULL DEFAULT 0,
    is_fund BOOLEAN NOT NULL DEFAULT false,
    is_overseas BOOLEAN NOT NULL DEFAULT false,
    plan_buy DECIMAL(15, 2) NOT NULL DEFAULT 0,
    alert DECIMAL(5, 2),
    target_price DECIMAL(15, 4),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引优化查询
CREATE INDEX IF NOT EXISTS idx_positions_code ON positions(code);
CREATE INDEX IF NOT EXISTS idx_positions_is_fund ON positions(is_fund);

-- ==================== 待确认交易表 ====================
CREATE TABLE IF NOT EXISTS pending_trades (
    id VARCHAR(50) PRIMARY KEY,
    row_id VARCHAR(50) NOT NULL,
    code VARCHAR(20) NOT NULL,
    name VARCHAR(100) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    is_before_15 BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL,
    FOREIGN KEY (row_id) REFERENCES positions(id) ON DELETE CASCADE
);

-- 索引优化查询
CREATE INDEX IF NOT EXISTS idx_pending_trades_row_id ON pending_trades(row_id);
CREATE INDEX IF NOT EXISTS idx_pending_trades_created_at ON pending_trades(created_at);

-- ==================== 交易历史表 ====================
CREATE TABLE IF NOT EXISTS trade_history (
    id VARCHAR(50) PRIMARY KEY,
    row_id VARCHAR(50) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('add', 'reduce')),
    amount DECIMAL(15, 2) NOT NULL,
    shares DECIMAL(15, 4) NOT NULL,
    net_value DECIMAL(15, 4) NOT NULL,
    is_before_15 BOOLEAN DEFAULT true,
    created_at TIMESTAMP NOT NULL,
    local_date DATE,
    FOREIGN KEY (row_id) REFERENCES positions(id) ON DELETE CASCADE
);

-- 索引优化查询
CREATE INDEX IF NOT EXISTS idx_trade_history_row_id ON trade_history(row_id);
CREATE INDEX IF NOT EXISTS idx_trade_history_created_at ON trade_history(created_at);
CREATE INDEX IF NOT EXISTS idx_trade_history_local_date ON trade_history(local_date);

-- ==================== 每日收益表 ====================
CREATE TABLE IF NOT EXISTS daily_profits (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL UNIQUE,
    stock_today DECIMAL(15, 2) NOT NULL DEFAULT 0,
    fund_today DECIMAL(15, 2) NOT NULL DEFAULT 0,
    total_today DECIMAL(15, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引优化查询
CREATE INDEX IF NOT EXISTS idx_daily_profits_date ON daily_profits(date);

-- ==================== 示例数据插入 ====================
-- INSERT INTO configs (key, value) VALUES
-- ('serverchanKey', 'YOUR_SERVERCHAN_SEND_KEY_HERE'),
-- ('alertTime', '0 31 23 * * *');

-- ==================== 视图和函数 ====================
-- 查看每日收益统计视图
CREATE OR REPLACE VIEW daily_profits_summary AS
SELECT
    date,
    stock_today,
    fund_today,
    total_today,
    created_at
FROM daily_profits
ORDER BY date DESC;

-- 查看持仓市值估算视图
CREATE OR REPLACE VIEW positions_summary AS
SELECT
    p.*,
    (p.shares * p.cost) as estimated_value
FROM positions p
ORDER BY p.code;

-- ==================== 股票涨跌幅提醒规则表 ====================
CREATE TABLE IF NOT EXISTS alert_rules (
    id VARCHAR(50) PRIMARY KEY,
    position_id VARCHAR(50) NOT NULL,
    direction VARCHAR(5) NOT NULL CHECK (direction IN ('up', 'down', 'both')),
    threshold DECIMAL(5, 2) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    triggered_today BOOLEAN NOT NULL DEFAULT false,
    trigger_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE CASCADE
);

-- 索引优化查询
CREATE INDEX IF NOT EXISTS idx_alert_rules_position_id ON alert_rules(position_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);