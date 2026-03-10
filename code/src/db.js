import mysql from 'mysql2/promise';

// MySQL 连接配置
const DB_CONFIG = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'root',
    database: process.env.MYSQL_DATABASE || 'kiro_api',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: '+08:00',
    dateStrings: true  // 返回日期字符串而不是 Date 对象，避免时区转换问题
};

let pool = null;

/**
 * 初始化数据库连接池
 */
export async function initDatabase() {
    if (pool) return pool;

    pool = mysql.createPool(DB_CONFIG);

    // 创建凭据表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            profile_arn VARCHAR(512),
            client_id VARCHAR(255),
            client_secret TEXT,
            auth_method VARCHAR(50) DEFAULT 'social',
            provider VARCHAR(50) DEFAULT 'Google',
            region VARCHAR(50) DEFAULT 'us-east-1',
            expires_at VARCHAR(50),
            is_active TINYINT DEFAULT 1,
            usage_data JSON,
            usage_updated_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 添加 provider 列（如果不存在）
    try {
        await pool.execute(`ALTER TABLE credentials ADD COLUMN provider VARCHAR(50) DEFAULT 'Google' AFTER auth_method`);
    } catch (e) {
        // 列已存在，忽略错误
    }

    // 创建错误凭据表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS error_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            original_id INT,
            name VARCHAR(255) NOT NULL,
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            profile_arn VARCHAR(512),
            client_id VARCHAR(255),
            client_secret TEXT,
            auth_method VARCHAR(50) DEFAULT 'social',
            region VARCHAR(50) DEFAULT 'us-east-1',
            expires_at VARCHAR(50),
            error_message TEXT,
            error_count INT DEFAULT 1,
            last_error_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建用户表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id INT PRIMARY KEY AUTO_INCREMENT,
            username VARCHAR(255) NOT NULL UNIQUE,
            password_hash VARCHAR(255) NOT NULL,
            is_admin TINYINT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建 API 密钥表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS api_keys (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            name VARCHAR(255) NOT NULL,
            key_value VARCHAR(255) NOT NULL,
            key_hash VARCHAR(255) NOT NULL UNIQUE,
            key_prefix VARCHAR(50) NOT NULL,
            is_active TINYINT DEFAULT 1,
            last_used_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            daily_limit INT DEFAULT 0,
            monthly_limit INT DEFAULT 0,
            total_limit INT DEFAULT 0,
            concurrent_limit INT DEFAULT 0,
            rate_limit INT DEFAULT 0,
            daily_cost_limit DECIMAL(10,2) DEFAULT 0,
            monthly_cost_limit DECIMAL(10,2) DEFAULT 0,
            total_cost_limit DECIMAL(10,2) DEFAULT 0,
            expires_in_days INT DEFAULT 0,
            email VARCHAR(255) DEFAULT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_email (email)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建 API 日志表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS api_logs (
            id INT PRIMARY KEY AUTO_INCREMENT,
            request_id VARCHAR(100) NOT NULL,
            api_key_id INT,
            api_key_prefix VARCHAR(50),
            credential_id INT,
            credential_name VARCHAR(255),
            channel VARCHAR(50) DEFAULT NULL,
            ip_address VARCHAR(50),
            user_agent TEXT,
            method VARCHAR(10) DEFAULT 'POST',
            path VARCHAR(255) DEFAULT '/v1/messages',
            model VARCHAR(100),
            stream TINYINT DEFAULT 0,
            input_tokens INT DEFAULT 0,
            output_tokens INT DEFAULT 0,
            request_messages MEDIUMTEXT,
            response_content MEDIUMTEXT,
            status_code INT DEFAULT 200,
            error_message TEXT,
            duration_ms INT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_created_at (created_at),
            INDEX idx_api_key_id (api_key_id),
            INDEX idx_ip_address (ip_address),
            INDEX idx_request_id (request_id),
            INDEX idx_channel (channel)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 为已有 api_logs 表添加 channel 列（忽略已存在的错误）
    try {
        await pool.execute(`ALTER TABLE api_logs ADD COLUMN channel VARCHAR(50) DEFAULT NULL`);
        await pool.execute(`ALTER TABLE api_logs ADD INDEX idx_channel (channel)`);
    } catch (e) {
        // 列或索引已存在，忽略
    }

    // 创建 Gemini Antigravity 凭证表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS gemini_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255),
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            project_id VARCHAR(255),
            expires_at VARCHAR(50),
            is_active TINYINT DEFAULT 1,
            usage_data JSON,
            usage_updated_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建 Gemini 错误凭证表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS gemini_error_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            original_id INT,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            access_token TEXT NOT NULL,
            refresh_token TEXT,
            project_id VARCHAR(255),
            expires_at VARCHAR(50),
            error_message TEXT,
            error_count INT DEFAULT 1,
            last_error_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建 Orchids 凭证表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS orchids_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255),
            client_jwt TEXT NOT NULL,
            clerk_session_id VARCHAR(255),
            user_id VARCHAR(255),
            expires_at VARCHAR(50),
            is_active TINYINT DEFAULT 1,
            weight INT DEFAULT 1,
            request_count BIGINT DEFAULT 0,
            success_count BIGINT DEFAULT 0,
            failure_count BIGINT DEFAULT 0,
            last_used_at DATETIME,
            usage_data JSON,
            usage_updated_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 添加 Orchids 凭证表新字段（迁移兼容）
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN weight INT DEFAULT 1 AFTER is_active`);
    } catch (e) { /* 字段可能已存在 */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN request_count BIGINT DEFAULT 0 AFTER weight`);
    } catch (e) { /* 字段可能已存在 */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN success_count BIGINT DEFAULT 0 AFTER request_count`);
    } catch (e) { /* 字段可能已存在 */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN failure_count BIGINT DEFAULT 0 AFTER success_count`);
    } catch (e) { /* 字段可能已存在 */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN last_used_at DATETIME AFTER failure_count`);
    } catch (e) { /* 字段可能已存在 */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN plan VARCHAR(50) DEFAULT NULL AFTER usage_updated_at`);
    } catch (e) { /* 字段可能已存在 */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN credits INT DEFAULT NULL AFTER plan`);
    } catch (e) { /* 字段可能已存在 */ }
    try {
        await pool.execute(`ALTER TABLE orchids_credentials ADD COLUMN credits_updated_at DATETIME DEFAULT NULL AFTER credits`);
    } catch (e) { /* 字段可能已存在 */ }

    // 创建 Orchids 错误凭证表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS orchids_error_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            original_id INT,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            client_jwt TEXT NOT NULL,
            clerk_session_id VARCHAR(255),
            user_id VARCHAR(255),
            expires_at VARCHAR(50),
            error_message TEXT,
            error_count INT DEFAULT 1,
            last_error_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建 Warp 凭证表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS warp_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255),
            refresh_token TEXT NOT NULL,
            access_token TEXT,
            token_expires_at DATETIME,
            is_active TINYINT DEFAULT 1,
            use_count INT DEFAULT 0,
            last_used_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            quota_limit INT DEFAULT 0,
            quota_used INT DEFAULT 0,
            quota_updated_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // 添加用量字段（如果不存在）
    try {
        await pool.execute(`ALTER TABLE warp_credentials ADD COLUMN quota_limit INT DEFAULT 0`);
    } catch (e) { /* 字段已存在 */ }
    try {
        await pool.execute(`ALTER TABLE warp_credentials ADD COLUMN quota_used INT DEFAULT 0`);
    } catch (e) { /* 字段已存在 */ }
    try {
        await pool.execute(`ALTER TABLE warp_credentials ADD COLUMN quota_updated_at DATETIME`);
    } catch (e) { /* 字段已存在 */ }

    // 创建 Warp 请求统计表（不记录消息内容）
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS warp_request_stats (
            id INT PRIMARY KEY AUTO_INCREMENT,
            credential_id INT NOT NULL,
            api_key_id INT,
            endpoint VARCHAR(100) NOT NULL,
            model VARCHAR(100) NOT NULL,
            is_stream TINYINT DEFAULT 0,
            input_tokens INT DEFAULT 0,
            output_tokens INT DEFAULT 0,
            total_tokens INT DEFAULT 0,
            duration_ms INT DEFAULT 0,
            status VARCHAR(20) DEFAULT 'success',
            error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_credential_id (credential_id),
            INDEX idx_api_key_id (api_key_id),
            INDEX idx_created_at (created_at),
            INDEX idx_model (model)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建 Warp 错误凭证表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS warp_error_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            original_id INT,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            refresh_token TEXT NOT NULL,
            access_token TEXT,
            error_message TEXT,
            error_count INT DEFAULT 1,
            last_error_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建试用申请表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS trial_applications (
            id INT PRIMARY KEY AUTO_INCREMENT,
            xianyu_name VARCHAR(255) NOT NULL,
            order_screenshot MEDIUMTEXT,
            source VARCHAR(100),
            email VARCHAR(255) NOT NULL,
            status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
            api_key VARCHAR(255),
            api_key_expires_at DATETIME,
            cost_limit DECIMAL(10,2) DEFAULT 50.00,
            reject_reason TEXT,
            reviewed_by INT,
            reviewed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_email (email),
            INDEX idx_status (status),
            INDEX idx_xianyu_name (xianyu_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 修改 order_screenshot 字段为 MEDIUMTEXT（如果表已存在且字段是 TEXT）
    try {
        await pool.execute(`ALTER TABLE trial_applications MODIFY COLUMN order_screenshot MEDIUMTEXT`);
    } catch (e) {
        // 忽略错误
    }

    // 创建套餐管理表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS packages (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(100) NOT NULL,
            description TEXT,
            daily_limit INT DEFAULT 0,
            monthly_limit INT DEFAULT 0,
            total_limit INT DEFAULT 0,
            concurrent_limit INT DEFAULT 0,
            rate_limit INT DEFAULT 0,
            daily_cost_limit DECIMAL(10,2) DEFAULT 0,
            monthly_cost_limit DECIMAL(10,2) DEFAULT 0,
            total_cost_limit DECIMAL(10,2) DEFAULT 0,
            expires_in_days INT DEFAULT 0,
            price DECIMAL(10,2) DEFAULT 0,
            sort_order INT DEFAULT 0,
            is_active TINYINT DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_is_active (is_active),
            INDEX idx_sort_order (sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建站点设置表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS site_settings (
            id INT PRIMARY KEY DEFAULT 1,
            site_name VARCHAR(50) DEFAULT 'Kiro',
            site_logo VARCHAR(10) DEFAULT 'K',
            site_subtitle VARCHAR(100) DEFAULT 'Account Manager',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 确保站点设置表有默认记录
    try {
        await pool.execute(`INSERT IGNORE INTO site_settings (id, site_name, site_logo, site_subtitle) VALUES (1, 'Kiro', 'K', 'Account Manager')`);
    } catch (e) {
        // 忽略错误
    }

    // 创建 Vertex AI 凭证表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS vertex_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            project_id VARCHAR(255) NOT NULL,
            client_email VARCHAR(255) NOT NULL,
            private_key TEXT NOT NULL,
            region VARCHAR(50) DEFAULT 'global',
            is_active TINYINT DEFAULT 1,
            use_count INT DEFAULT 0,
            last_used_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建模型定价配置表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS model_pricing (
            id INT PRIMARY KEY AUTO_INCREMENT,
            model_name VARCHAR(255) NOT NULL UNIQUE,
            display_name VARCHAR(255),
            provider VARCHAR(50) DEFAULT 'anthropic',
            input_price DECIMAL(10, 4) NOT NULL COMMENT '输入价格（美元/百万tokens）',
            output_price DECIMAL(10, 4) NOT NULL COMMENT '输出价格（美元/百万tokens）',
            is_active TINYINT DEFAULT 1,
            sort_order INT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建 Amazon Bedrock 凭证表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS bedrock_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            auth_type VARCHAR(20) DEFAULT 'iam',
            access_key_id VARCHAR(255),
            secret_access_key TEXT,
            session_token TEXT,
            bearer_token TEXT,
            region VARCHAR(50) DEFAULT 'us-east-1',
            is_active TINYINT DEFAULT 1,
            use_count INT DEFAULT 0,
            last_used_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 迁移: 为 bedrock_credentials 表添加新字段（如果不存在）
    try {
        await pool.execute(`ALTER TABLE bedrock_credentials ADD COLUMN auth_type VARCHAR(20) DEFAULT 'iam' AFTER name`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE bedrock_credentials ADD COLUMN bearer_token TEXT AFTER session_token`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE bedrock_credentials MODIFY COLUMN access_key_id VARCHAR(255) NULL`);
    } catch (e) { /* 忽略 */ }
    try {
        await pool.execute(`ALTER TABLE bedrock_credentials MODIFY COLUMN secret_access_key TEXT NULL`);
    } catch (e) { /* 忽略 */ }
    // 迁移: 为 bedrock_credentials 表添加 token 统计字段
    try {
        await pool.execute(`ALTER TABLE bedrock_credentials ADD COLUMN input_tokens BIGINT DEFAULT 0 AFTER use_count`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE bedrock_credentials ADD COLUMN output_tokens BIGINT DEFAULT 0 AFTER input_tokens`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE bedrock_credentials ADD COLUMN total_cost DECIMAL(20, 8) DEFAULT 0 AFTER output_tokens`);
    } catch (e) { /* 列已存在 */ }

    // 创建 AMI 凭证表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS ami_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            session_cookie TEXT NOT NULL,
            project_id VARCHAR(255),
            chat_id VARCHAR(255),
            note TEXT,
            status VARCHAR(50) DEFAULT 'active',
            is_active TINYINT DEFAULT 1,
            use_count INT DEFAULT 0,
            last_used_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // AMI 凭证表：追加 token 统计列
    try { await pool.execute('ALTER TABLE ami_credentials ADD COLUMN input_tokens BIGINT DEFAULT 0'); } catch (e) { /* 列已存在 */ }
    try { await pool.execute('ALTER TABLE ami_credentials ADD COLUMN output_tokens BIGINT DEFAULT 0'); } catch (e) { /* 列已存在 */ }
    try { await pool.execute('ALTER TABLE ami_credentials ADD COLUMN total_cost DECIMAL(12,6) DEFAULT 0'); } catch (e) { /* 列已存在 */ }
    // AMI 凭证表：追加账户状态字段
    try { await pool.execute('ALTER TABLE ami_credentials ADD COLUMN is_paid TINYINT DEFAULT 0'); } catch (e) { /* 列已存在 */ }
    try { await pool.execute('ALTER TABLE ami_credentials ADD COLUMN daily_usage BIGINT DEFAULT 0'); } catch (e) { /* 列已存在 */ }
    try { await pool.execute('ALTER TABLE ami_credentials ADD COLUMN token_expires_hours DECIMAL(8,1) DEFAULT 0'); } catch (e) { /* 列已存在 */ }
    try { await pool.execute('ALTER TABLE ami_credentials ADD COLUMN last_check_at DATETIME'); } catch (e) { /* 列已存在 */ }

    // 创建 Codex 凭证表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS codex_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL UNIQUE,
            email VARCHAR(255),
            account_id VARCHAR(255),
            access_token TEXT,
            refresh_token TEXT NOT NULL,
            id_token TEXT,
            expires_at DATETIME,
            note TEXT,
            status VARCHAR(50) DEFAULT 'active',
            is_active TINYINT DEFAULT 1,
            use_count INT DEFAULT 0,
            last_used_at DATETIME,
            error_count INT DEFAULT 0,
            last_error_at DATETIME,
            last_error_message TEXT,
            usage_percent DECIMAL(5,2) DEFAULT NULL,
            usage_reset_at DATETIME DEFAULT NULL,
            plan_type VARCHAR(50) DEFAULT NULL,
            usage_updated_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 迁移: 为 codex_credentials 表添加用量字段（如果不存在）
    try {
        await pool.execute(`ALTER TABLE codex_credentials ADD COLUMN usage_percent DECIMAL(5,2) DEFAULT NULL`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE codex_credentials ADD COLUMN usage_reset_at DATETIME DEFAULT NULL`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE codex_credentials ADD COLUMN plan_type VARCHAR(50) DEFAULT NULL`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE codex_credentials ADD COLUMN usage_updated_at DATETIME DEFAULT NULL`);
    } catch (e) { /* 列已存在 */ }
    // 迁移: 双窗口配额字段（5h + Weekly）
    try {
        await pool.execute(`ALTER TABLE codex_credentials ADD COLUMN primary_usage_percent DECIMAL(5,2) DEFAULT NULL`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE codex_credentials ADD COLUMN primary_reset_at BIGINT DEFAULT NULL`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE codex_credentials ADD COLUMN secondary_usage_percent DECIMAL(5,2) DEFAULT NULL`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE codex_credentials ADD COLUMN secondary_reset_at BIGINT DEFAULT NULL`);
    } catch (e) { /* 列已存在 */ }
    try {
        await pool.execute(`ALTER TABLE codex_credentials ADD COLUMN quota_error TEXT DEFAULT NULL`);
    } catch (e) { /* 列已存在 */ }

    // 创建工具调用日志表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS tool_call_logs (
            id INT PRIMARY KEY AUTO_INCREMENT,
            request_id VARCHAR(100),
            credential_id INT,
            credential_name VARCHAR(255),
            tool_name VARCHAR(100) NOT NULL,
            tool_use_id VARCHAR(100),
            input_size INT DEFAULT 0,
            log_level VARCHAR(20) DEFAULT 'INFO',
            message TEXT,
            input_preview TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_created_at (created_at),
            INDEX idx_tool_name (tool_name),
            INDEX idx_log_level (log_level),
            INDEX idx_credential_id (credential_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建满血号池表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS full_accounts (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(255) NOT NULL,
            type ENUM('digitalocean', 'aws', 'gcp', 'azure', 'other') NOT NULL,
            credentials JSON NOT NULL,
            remark TEXT,
            is_active TINYINT DEFAULT 1,
            models JSON,
            last_tested_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_type (type),
            INDEX idx_is_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建模型映射表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS model_mappings (
            id INT PRIMARY KEY AUTO_INCREMENT,
            source_model VARCHAR(255) NOT NULL COMMENT '请求的模型名称，如 claude-opus-4.5',
            target_model VARCHAR(255) NOT NULL COMMENT '实际调用的模型ID',
            provider VARCHAR(50) DEFAULT 'digitalocean' COMMENT '提供商',
            is_active TINYINT DEFAULT 1,
            priority INT DEFAULT 0 COMMENT '优先级，数字越大优先级越高',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uk_source_provider (source_model, provider),
            INDEX idx_provider (provider),
            INDEX idx_is_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 为已有 api_keys 表添加 email 列（忽略已存在的错误）
    try {
        await pool.execute(`ALTER TABLE api_keys ADD COLUMN email VARCHAR(255) DEFAULT NULL`);
        await pool.execute(`ALTER TABLE api_keys ADD INDEX idx_email (email)`);
    } catch (e) {
        // 列或索引已存在，忽略
    }

    // 创建兑换码表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS redemption_codes (
            id INT PRIMARY KEY AUTO_INCREMENT,
            code VARCHAR(32) NOT NULL UNIQUE,
            package_id INT NOT NULL,
            status ENUM('unused', 'used', 'expired', 'disabled') DEFAULT 'unused',
            redeemed_by_key_id INT,
            redeemed_at DATETIME,
            redeemed_ip VARCHAR(45),
            note TEXT,
            created_by INT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME,
            INDEX idx_code (code),
            INDEX idx_status (status),
            INDEX idx_package_id (package_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建通道配置表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS channels (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(100) NOT NULL UNIQUE COMMENT '通道标识，对应 api_logs.channel',
            display_name VARCHAR(100) COMMENT '显示名称',
            api_path VARCHAR(255) COMMENT 'API 路径，如 /v1/messages',
            description TEXT COMMENT '通道说明',
            is_active TINYINT(1) DEFAULT 1,
            sort_order INT DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建通道支持模型表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS channel_models (
            id INT PRIMARY KEY AUTO_INCREMENT,
            channel_id INT NOT NULL,
            model_name VARCHAR(255) NOT NULL COMMENT '模型名称',
            input_price DECIMAL(10,4) DEFAULT 0 COMMENT '输入价格($/百万tokens)',
            output_price DECIMAL(10,4) DEFAULT 0 COMMENT '输出价格($/百万tokens)',
            is_active TINYINT(1) DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_channel_id (channel_id),
            UNIQUE KEY uk_channel_model (channel_id, model_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建 Grok 凭证表（SSO Token 池）
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS grok_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            token TEXT NOT NULL COMMENT 'SSO Token（不含 sso= 前缀）',
            token_hash VARCHAR(64) NOT NULL UNIQUE COMMENT 'Token 的 SHA256 哈希，用于去重',
            pool VARCHAR(20) DEFAULT 'ssoBasic' COMMENT 'Token 池: ssoBasic / ssoSuper',
            status VARCHAR(20) DEFAULT 'active' COMMENT '状态: active / cooling / expired / disabled',
            quota INT DEFAULT 80 COMMENT '剩余配额',
            use_count INT DEFAULT 0 COMMENT '使用次数',
            fail_count INT DEFAULT 0 COMMENT '连续失败次数',
            last_used_at DATETIME COMMENT '最后使用时间',
            last_fail_at DATETIME COMMENT '最后失败时间',
            note VARCHAR(255) DEFAULT '' COMMENT '备注',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 创建 Krater 凭据表
    await pool.execute(`
        CREATE TABLE IF NOT EXISTS krater_credentials (
            id INT PRIMARY KEY AUTO_INCREMENT,
            api_key VARCHAR(255) NOT NULL COMMENT 'Krater API Key (kr_live_...)',
            key_hash VARCHAR(64) NOT NULL UNIQUE COMMENT 'API Key 的 SHA256 哈希，用于去重',
            status VARCHAR(20) DEFAULT 'active' COMMENT '状态: active / cooling / expired / disabled',
            use_count INT DEFAULT 0 COMMENT '使用次数',
            fail_count INT DEFAULT 0 COMMENT '连续失败次数',
            last_used_at DATETIME COMMENT '最后使用时间',
            last_fail_at DATETIME COMMENT '最后失败时间',
            note VARCHAR(255) DEFAULT '' COMMENT '备注',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    return pool;
}

/**
 * 获取数据库连接池
 */
export async function getDatabase() {
    if (!pool) {
        await initDatabase();
    }
    return pool;
}

/**
 * 关闭数据库连接池
 */
export async function closeDatabase() {
    if (pool) {
        await pool.end();
        pool = null;
    }
}

/**
 * 凭据管理类
 */
export class CredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new CredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO credentials (name, access_token, refresh_token, profile_arn, client_id, client_secret, auth_method, provider, region, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.accessToken,
            credential.refreshToken || null,
            credential.profileArn || null,
            credential.clientId || null,
            credential.clientSecret || null,
            credential.authMethod || 'social',
            credential.provider || 'Google',
            credential.region || 'us-east-1',
            credential.expiresAt || null
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const toNull = (val) => val === undefined ? null : val;
        await this.db.execute(`
            UPDATE credentials SET
                name = COALESCE(?, name),
                access_token = COALESCE(?, access_token),
                refresh_token = COALESCE(?, refresh_token),
                profile_arn = COALESCE(?, profile_arn),
                client_id = COALESCE(?, client_id),
                client_secret = COALESCE(?, client_secret),
                auth_method = COALESCE(?, auth_method),
                provider = COALESCE(?, provider),
                region = COALESCE(?, region),
                expires_at = COALESCE(?, expires_at)
            WHERE id = ?
        `, [
            toNull(credential.name),
            toNull(credential.accessToken),
            toNull(credential.refreshToken),
            toNull(credential.profileArn),
            toNull(credential.clientId),
            toNull(credential.clientSecret),
            toNull(credential.authMethod),
            toNull(credential.provider),
            toNull(credential.region),
            toNull(credential.expiresAt),
            id
        ]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getActive() {
        const [rows] = await this.db.execute('SELECT * FROM credentials WHERE is_active = 1 LIMIT 1');
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async setActive(id) {
        await this.db.execute('UPDATE credentials SET is_active = 0');
        await this.db.execute('UPDATE credentials SET is_active = 1 WHERE id = ?', [id]);
    }

    async importFromFile(filePath, name) {
        const fs = await import('fs');
        const content = fs.readFileSync(filePath, 'utf8');
        const creds = JSON.parse(content);

        return this.add({
            name: name || `imported_${Date.now()}`,
            accessToken: creds.accessToken,
            refreshToken: creds.refreshToken,
            profileArn: creds.profileArn,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            authMethod: creds.authMethod,
            region: creds.region,
            expiresAt: creds.expiresAt
        });
    }

    async batchImportSocialAccounts(accounts, region = 'us-east-1') {
        const results = {
            success: 0,
            failed: 0,
            errors: [],
            imported: []
        };

        for (const account of accounts) {
            try {
                if (!account.email || !account.refreshToken) {
                    results.failed++;
                    results.errors.push({
                        email: account.email || 'unknown',
                        error: '缺少 email 或 refreshToken'
                    });
                    continue;
                }

                const provider = account.provider || 'Google';

                const existing = await this.getByName(account.email);
                if (existing) {
                    await this.update(existing.id, {
                        refreshToken: account.refreshToken,
                        authMethod: 'social',
                        provider: provider,
                        region: region
                    });
                    results.success++;
                    results.imported.push({
                        email: account.email,
                        id: existing.id,
                        action: 'updated'
                    });
                } else {
                    const id = await this.add({
                        name: account.email,
                        accessToken: account.refreshToken,
                        refreshToken: account.refreshToken,
                        authMethod: 'social',
                        provider: provider,
                        region: region
                    });
                    results.success++;
                    results.imported.push({
                        email: account.email,
                        id: id,
                        action: 'created'
                    });
                }
            } catch (error) {
                results.failed++;
                results.errors.push({
                    email: account.email || 'unknown',
                    error: error.message
                });
            }
        }

        return results;
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            email: row.name,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            profileArn: row.profile_arn,
            clientId: row.client_id,
            clientSecret: row.client_secret,
            authMethod: row.auth_method,
            provider: row.provider || 'Google',
            region: row.region,
            expiresAt: row.expires_at,
            isActive: row.is_active === 1,
            usageData: row.usage_data ? (typeof row.usage_data === 'string' ? JSON.parse(row.usage_data) : row.usage_data) : null,
            usageUpdatedAt: row.usage_updated_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    async updateUsage(id, usageData) {
        const usageJson = JSON.stringify(usageData);
        await this.db.execute(`
            UPDATE credentials SET
                usage_data = ?,
                usage_updated_at = NOW()
            WHERE id = ?
        `, [usageJson, id]);
    }

    _mapErrorRow(row) {
        return {
            id: row.id,
            originalId: row.original_id,
            name: row.name,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            profileArn: row.profile_arn,
            clientId: row.client_id,
            clientSecret: row.client_secret,
            authMethod: row.auth_method,
            region: row.region,
            expiresAt: row.expires_at,
            errorMessage: row.error_message,
            errorCount: row.error_count,
            lastErrorAt: row.last_error_at,
            createdAt: row.created_at
        };
    }

    async moveToError(id, errorMessage) {
        const credential = await this.getById(id);
        if (!credential) return null;

        const [existingError] = await this.db.execute(
            'SELECT id, error_count FROM error_credentials WHERE original_id = ?',
            [id]
        );

        if (existingError.length > 0) {
            const errorId = existingError[0].id;
            const errorCount = existingError[0].error_count + 1;
            await this.db.execute(`
                UPDATE error_credentials SET
                    error_message = ?,
                    error_count = ?,
                    last_error_at = NOW()
                WHERE id = ?
            `, [errorMessage, errorCount, errorId]);
        } else {
            await this.db.execute(`
                INSERT INTO error_credentials (
                    original_id, name, access_token, refresh_token, profile_arn,
                    client_id, client_secret, auth_method, region, expires_at,
                    error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                credential.id,
                credential.name,
                credential.accessToken,
                credential.refreshToken,
                credential.profileArn,
                credential.clientId,
                credential.clientSecret,
                credential.authMethod,
                credential.region,
                credential.expiresAt,
                errorMessage,
                credential.createdAt
            ]);
        }

        await this.delete(id);
        return credential;
    }

    async restoreFromError(errorId, newAccessToken, newRefreshToken, newExpiresAt) {
        const [rows] = await this.db.execute('SELECT * FROM error_credentials WHERE id = ?', [errorId]);
        if (rows.length === 0) return null;

        const errorCred = this._mapErrorRow(rows[0]);

        const [result] = await this.db.execute(`
            INSERT INTO credentials (
                name, access_token, refresh_token, profile_arn,
                client_id, client_secret, auth_method, region, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            errorCred.name,
            newAccessToken || errorCred.accessToken,
            newRefreshToken || errorCred.refreshToken,
            errorCred.profileArn,
            errorCred.clientId,
            errorCred.clientSecret,
            errorCred.authMethod,
            errorCred.region,
            newExpiresAt || errorCred.expiresAt,
            errorCred.createdAt
        ]);

        await this.db.execute('DELETE FROM error_credentials WHERE id = ?', [errorId]);
        return result.insertId;
    }

    async getAllErrors() {
        const [rows] = await this.db.execute('SELECT * FROM error_credentials ORDER BY last_error_at DESC');
        return rows.map(row => this._mapErrorRow(row));
    }

    async getErrorById(id) {
        const [rows] = await this.db.execute('SELECT * FROM error_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapErrorRow(rows[0]);
    }

    async deleteError(id) {
        await this.db.execute('DELETE FROM error_credentials WHERE id = ?', [id]);
    }

    async updateErrorToken(id, accessToken, refreshToken, expiresAt) {
        const toNull = (val) => val === undefined ? null : val;
        await this.db.execute(`
            UPDATE error_credentials SET
                access_token = COALESCE(?, access_token),
                refresh_token = COALESCE(?, refresh_token),
                expires_at = COALESCE(?, expires_at)
            WHERE id = ?
        `, [toNull(accessToken), toNull(refreshToken), toNull(expiresAt), id]);
    }
}

/**
 * 用户管理类
 */
export class UserStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new UserStore(database);
    }

    async create(username, passwordHash, isAdmin = false) {
        try {
            const [result] = await this.db.execute(`
                INSERT INTO users (username, password_hash, is_admin)
                VALUES (?, ?, ?)
            `, [username, passwordHash, isAdmin ? 1 : 0]);
            return result.insertId;
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                throw new Error('用户名已存在');
            }
            throw error;
        }
    }

    async getByUsername(username) {
        const [rows] = await this.db.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM users WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM users ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async updatePassword(id, passwordHash) {
        await this.db.execute(`
            UPDATE users SET password_hash = ?
            WHERE id = ?
        `, [passwordHash, id]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM api_keys WHERE user_id = ?', [id]);
        await this.db.execute('DELETE FROM users WHERE id = ?', [id]);
    }

    async hasUsers() {
        const [rows] = await this.db.execute('SELECT COUNT(*) as count FROM users');
        return rows[0].count > 0;
    }

    _mapRow(row) {
        return {
            id: row.id,
            username: row.username,
            passwordHash: row.password_hash,
            isAdmin: row.is_admin === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * API 密钥管理类
 */
export class ApiKeyStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new ApiKeyStore(database);
    }

    async create(userId, name, keyValue, keyHash, keyPrefix, email) {
        const [result] = await this.db.execute(`
            INSERT INTO api_keys (user_id, name, key_value, key_hash, key_prefix, email)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [userId, name, keyValue, keyHash, keyPrefix, email || null]);
        return result.insertId;
    }

    async getByKeyHash(keyHash) {
        const [rows] = await this.db.execute('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1', [keyHash]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByUserId(userId) {
        const [rows] = await this.db.execute('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC', [userId]);
        return rows.map(row => this._mapRow(row));
    }

    async getAll() {
        const [rows] = await this.db.execute(`
            SELECT ak.*, u.username
            FROM api_keys ak
            LEFT JOIN users u ON ak.user_id = u.id
            ORDER BY ak.created_at DESC
        `);
        return rows.map(row => this._mapRowWithUser(row));
    }

    async updateLastUsed(id) {
        await this.db.execute(`
            UPDATE api_keys SET last_used_at = NOW()
            WHERE id = ?
        `, [id]);
    }

    async disable(id) {
        await this.db.execute('UPDATE api_keys SET is_active = 0 WHERE id = ?', [id]);
    }

    async enable(id) {
        await this.db.execute('UPDATE api_keys SET is_active = 1 WHERE id = ?', [id]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM api_keys WHERE id = ?', [id]);
    }

    async updateLimits(id, limits) {
        const { dailyLimit, monthlyLimit, totalLimit, concurrentLimit, rateLimit, dailyCostLimit, monthlyCostLimit, totalCostLimit, expiresInDays } = limits;
        await this.db.execute(`
            UPDATE api_keys SET
                daily_limit = COALESCE(?, daily_limit),
                monthly_limit = COALESCE(?, monthly_limit),
                total_limit = COALESCE(?, total_limit),
                concurrent_limit = COALESCE(?, concurrent_limit),
                rate_limit = COALESCE(?, rate_limit),
                daily_cost_limit = COALESCE(?, daily_cost_limit),
                monthly_cost_limit = COALESCE(?, monthly_cost_limit),
                total_cost_limit = COALESCE(?, total_cost_limit),
                expires_in_days = COALESCE(?, expires_in_days)
            WHERE id = ?
        `, [
            dailyLimit ?? null,
            monthlyLimit ?? null,
            totalLimit ?? null,
            concurrentLimit ?? null,
            rateLimit ?? null,
            dailyCostLimit ?? null,
            monthlyCostLimit ?? null,
            totalCostLimit ?? null,
            expiresInDays ?? null,
            id
        ]);
    }

    /**
     * 续费 - 增加有效期天数
     * @param {number} id - API 密钥 ID
     * @param {number} days - 要增加的天数
     * @returns {object} 续费结果，包含新的过期信息
     */
    async renew(id, days) {
        if (!days || days <= 0) {
            throw new Error('续费天数必须大于 0');
        }

        const key = await this.getById(id);
        if (!key) {
            throw new Error('密钥不存在');
        }

        // 直接在原有天数基础上增加
        const previousDays = key.expiresInDays || 0;
        const newExpiresInDays = previousDays + days;

        await this.db.execute(`
            UPDATE api_keys SET expires_in_days = ? WHERE id = ?
        `, [newExpiresInDays, id]);

        // 计算新的过期日期和剩余天数（用于返回显示）
        // createdAt 是数据库存储的北京时间字符串 "YYYY-MM-DD HH:mm:ss"
        const now = new Date();
        const createDateStr = key.createdAt.replace(' ', 'T') + '+08:00';
        const createDate = new Date(createDateStr);
        const newExpireDate = new Date(createDate.getTime() + newExpiresInDays * 24 * 60 * 60 * 1000);
        const remainingDays = Math.max(0, Math.ceil((newExpireDate - now) / (24 * 60 * 60 * 1000)));

        // 格式化过期时间为北京时间字符串
        const expireDateLocal = new Date(newExpireDate.getTime() + 8 * 60 * 60 * 1000);
        const expireDateStr = expireDateLocal.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');

        return {
            previousExpiresInDays: previousDays,
            newExpiresInDays: newExpiresInDays,
            addedDays: days,
            expireDate: expireDateStr,
            remainingDays: remainingDays
        };
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM api_keys WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    _mapRow(row) {
        return {
            id: row.id,
            userId: row.user_id,
            name: row.name,
            keyValue: row.key_value,
            keyHash: row.key_hash,
            keyPrefix: row.key_prefix,
            isActive: row.is_active === 1,
            lastUsedAt: row.last_used_at,
            createdAt: row.created_at,
            dailyLimit: row.daily_limit || 0,
            monthlyLimit: row.monthly_limit || 0,
            totalLimit: row.total_limit || 0,
            concurrentLimit: row.concurrent_limit || 0,
            rateLimit: row.rate_limit || 0,
            dailyCostLimit: parseFloat(row.daily_cost_limit) || 0,
            monthlyCostLimit: parseFloat(row.monthly_cost_limit) || 0,
            totalCostLimit: parseFloat(row.total_cost_limit) || 0,
            expiresInDays: row.expires_in_days || 0,
            email: row.email || null
        };
    }

    _mapRowWithUser(row) {
        return {
            id: row.id,
            userId: row.user_id,
            username: row.username,
            name: row.name,
            keyValue: row.key_value,
            keyHash: row.key_hash,
            keyPrefix: row.key_prefix,
            isActive: row.is_active === 1,
            lastUsedAt: row.last_used_at,
            createdAt: row.created_at,
            dailyLimit: row.daily_limit || 0,
            monthlyLimit: row.monthly_limit || 0,
            totalLimit: row.total_limit || 0,
            concurrentLimit: row.concurrent_limit || 0,
            rateLimit: row.rate_limit || 0,
            dailyCostLimit: parseFloat(row.daily_cost_limit) || 0,
            monthlyCostLimit: parseFloat(row.monthly_cost_limit) || 0,
            totalCostLimit: parseFloat(row.total_cost_limit) || 0,
            expiresInDays: row.expires_in_days || 0,
            email: row.email || null
        };
    }

    async getByEmail(email) {
        const [rows] = await this.db.execute(
            'SELECT * FROM api_keys WHERE email = ? ORDER BY created_at DESC',
            [email]
        );
        return rows.map(row => this._mapRow(row));
    }
}

/**
 * API 日志管理类
 */
export class ApiLogStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new ApiLogStore(database);
    }

    async create(logData) {
        const [result] = await this.db.execute(`
            INSERT INTO api_logs (
                request_id, api_key_id, api_key_prefix, credential_id, credential_name,
                channel, ip_address, user_agent, method, path, model, stream,
                input_tokens, output_tokens,
                status_code, error_message, duration_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            logData.requestId || null,
            logData.apiKeyId !== undefined ? logData.apiKeyId : null,
            logData.apiKeyPrefix !== undefined ? logData.apiKeyPrefix : null,
            logData.credentialId !== undefined ? logData.credentialId : null,
            logData.credentialName !== undefined ? logData.credentialName : null,
            logData.channel || null,
            logData.ipAddress !== undefined ? logData.ipAddress : null,
            logData.userAgent !== undefined ? logData.userAgent : null,
            logData.method || 'POST',
            logData.path || '/v1/messages',
            logData.model !== undefined ? logData.model : null,
            logData.stream ? 1 : 0,
            logData.inputTokens || 0,
            logData.outputTokens || 0,
            logData.statusCode || 200,
            logData.errorMessage !== undefined ? logData.errorMessage : null,
            logData.durationMs || 0
        ]);
        return result.insertId;
    }

    async getAll(options = {}) {
        const { page = 1, pageSize = 100, apiKeyId, ipAddress, channel, startDate, endDate } = options;
        const limit = parseInt(pageSize) || 100;
        const offset = ((parseInt(page) || 1) - 1) * limit;

        let query = 'SELECT * FROM api_logs WHERE 1=1';
        const params = [];

        if (apiKeyId) {
            query += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (ipAddress) {
            query += ' AND ip_address = ?';
            params.push(ipAddress);
        }
        if (channel) {
            query += ' AND channel = ?';
            params.push(channel);
        }
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        // 获取总数
        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
        const [countRows] = await this.db.execute(countQuery, params);
        const total = Number(countRows[0].total) || 0;

        query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        const [rows] = await this.db.execute(query, params);

        return {
            logs: rows.map(row => this._mapRow(row)),
            total,
            page: parseInt(page) || 1,
            pageSize: limit,
            totalPages: Math.ceil(total / limit)
        };
    }

    async getByApiKeyId(apiKeyId, limit = 100) {
        const [rows] = await this.db.execute(
            `SELECT * FROM api_logs WHERE api_key_id = ? ORDER BY created_at DESC LIMIT ${parseInt(limit)}`,
            [apiKeyId]
        );
        return rows.map(row => this._mapRow(row));
    }

    async getStats(apiKeyId = null, startDate = null, endDate = null) {
        let query = `
            SELECT
                COUNT(*) as total_requests,
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                AVG(duration_ms) as avg_duration_ms
            FROM api_logs
            WHERE 1=1
        `;
        const params = [];

        if (apiKeyId) {
            query += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        const [rows] = await this.db.execute(query, params);
        return rows[0];
    }

    _mapRow(row) {
        return {
            id: row.id,
            requestId: row.request_id,
            apiKeyId: row.api_key_id,
            apiKeyPrefix: row.api_key_prefix,
            credentialId: row.credential_id,
            credentialName: row.credential_name,
            channel: row.channel,
            ipAddress: row.ip_address,
            userAgent: row.user_agent,
            method: row.method,
            path: row.path,
            model: row.model,
            stream: row.stream === 1,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            requestMessages: row.request_messages,
            responseContent: row.response_content,
            statusCode: row.status_code,
            errorMessage: row.error_message,
            durationMs: row.duration_ms,
            createdAt: row.created_at
        };
    }

    async getStatsForApiKey(apiKeyId, options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens,
                COALESCE(AVG(duration_ms), 0) as avgDurationMs
            FROM api_logs
            WHERE api_key_id = ?
        `;
        const params = [apiKeyId];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        const [rows] = await this.db.execute(query, params);
        return {
            requestCount: Number(rows[0].requestCount) || 0,
            inputTokens: Number(rows[0].inputTokens) || 0,
            outputTokens: Number(rows[0].outputTokens) || 0,
            avgDurationMs: Number(rows[0].avgDurationMs) || 0
        };
    }

    async getStatsByModel(apiKeyId, options = {}) {
        const { startDate, endDate, includeErrors = false } = options;
        let query = `
            SELECT
                model,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE api_key_id = ?
        `;
        const params = [apiKeyId];

        // 默认只统计成功请求的 token（用于计费）
        if (!includeErrors) {
            query += ' AND status_code = 200';
        }

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY model';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            model: row.model,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getAllStatsByModel(options = {}) {
        const { startDate, endDate, includeErrors = false } = options;
        let query = `
            SELECT
                model,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE 1=1
        `;
        const params = [];

        // 默认只统计成功请求的 token（用于计费）
        if (!includeErrors) {
            query += ' AND status_code = 200';
        }

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY model';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            model: row.model,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getStatsByApiKey(options = {}) {
        const { startDate, endDate, includeErrors = false } = options;
        let query = `
            SELECT
                al.api_key_id,
                ak.name as apiKeyName,
                ak.key_prefix as apiKeyPrefix,
                COUNT(*) as requestCount,
                COALESCE(SUM(al.input_tokens), 0) as inputTokens,
                COALESCE(SUM(al.output_tokens), 0) as outputTokens
            FROM api_logs al
            LEFT JOIN api_keys ak ON al.api_key_id = ak.id
            WHERE al.api_key_id IS NOT NULL
        `;
        const params = [];

        // 默认只统计成功请求的 token（用于计费）
        if (!includeErrors) {
            query += ' AND al.status_code = 200';
        }

        if (startDate) {
            query += ' AND al.created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND al.created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY al.api_key_id, ak.name, ak.key_prefix ORDER BY requestCount DESC';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            apiKeyId: row.api_key_id,
            apiKeyName: row.apiKeyName || '未知',
            apiKeyPrefix: row.apiKeyPrefix || '',
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    /**
     * 获取使用排行榜（按 API Key）
     * @param {object} options - 查询选项
     * @param {number} options.hours - 最近多少小时（默认24）
     * @param {number} options.limit - 返回数量（默认5）
     * @param {string} options.orderBy - 排序字段：requests/tokens/cost（默认 tokens）
     */
    async getUsageRanking(options = {}) {
        const { hours = 24, limit = 5, orderBy = 'tokens' } = options;

        // 计算起始时间
        const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
        const startDate = startTime.toISOString().slice(0, 19).replace('T', ' ');

        // 确保 limit 是整数，防止 MySQL execute 报错
        const limitInt = parseInt(limit, 10) || 5;

        const query = `
            SELECT
                al.api_key_id,
                ak.name as apiKeyName,
                ak.key_prefix as apiKeyPrefix,
                COUNT(*) as requestCount,
                COALESCE(SUM(al.input_tokens), 0) as inputTokens,
                COALESCE(SUM(al.output_tokens), 0) as outputTokens,
                COALESCE(SUM(al.input_tokens), 0) + COALESCE(SUM(al.output_tokens), 0) as totalTokens,
                MIN(al.created_at) as firstRequest,
                MAX(al.created_at) as lastRequest
            FROM api_logs al
            LEFT JOIN api_keys ak ON al.api_key_id = ak.id
            WHERE al.api_key_id IS NOT NULL
              AND al.created_at >= ?
              AND al.status_code = 200
            GROUP BY al.api_key_id, ak.name, ak.key_prefix
            ORDER BY ${orderBy === 'requests' ? 'requestCount' : orderBy === 'cost' ? 'totalTokens' : 'totalTokens'} DESC
            LIMIT ${limitInt}
        `;

        const [rows] = await this.db.execute(query, [startDate]);
        return rows.map((row, index) => ({
            rank: index + 1,
            apiKeyId: row.api_key_id,
            apiKeyName: row.apiKeyName || '未知',
            apiKeyPrefix: row.apiKeyPrefix || '',
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0,
            totalTokens: Number(row.totalTokens) || 0,
            firstRequest: row.firstRequest,
            lastRequest: row.lastRequest
        }));
    }

    /**
     * 获取指定 API Key 的调用记录
     * @param {number} apiKeyId - API  ID
     * @param {object} options - 查询选项
     */
    async getCallHistory(apiKeyId, options = {}) {
        const { limit = 50, offset = 0, hours = 24 } = options;

        // 计算起始时间
        const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
        const startDate = startTime.toISOString().slice(0, 19).replace('T', ' ');

        // 确保参数是整数，防止 MySQL execute 报错
        const apiKeyIdInt = parseInt(apiKeyId, 10);
        const limitInt = parseInt(limit, 10) || 50;
        const offsetInt = parseInt(offset, 10) || 0;

        const query = `
            SELECT
                id,
                request_id,
                model,
                path,
                method,
                input_tokens,
                output_tokens,
                status_code,
                duration_ms,
                ip_address,
                error_message,
                credential_name,
                created_at
            FROM api_logs
            WHERE api_key_id = ?
              AND created_at >= ?
            ORDER BY created_at DESC
            LIMIT ${limitInt} OFFSET ${offsetInt}
        `;

        const [rows] = await this.db.execute(query, [apiKeyIdInt, startDate]);

        // 获取总数
        const countQuery = `
            SELECT COUNT(*) as total
            FROM api_logs
            WHERE api_key_id = ? AND created_at >= ?
        `;
        const [countRows] = await this.db.execute(countQuery, [apiKeyIdInt, startDate]);
        const total = Number(countRows[0]?.total) || 0;

        return {
            records: rows.map(row => ({
                id: row.id,
                requestId: row.request_id,
                model: row.model,
                path: row.path,
                method: row.method,
                inputTokens: Number(row.input_tokens) || 0,
                outputTokens: Number(row.output_tokens) || 0,
                statusCode: row.status_code,
                durationMs: Number(row.duration_ms) || 0,
                clientIp: row.ip_address,
                errorMessage: row.error_message,
                credentialName: row.credential_name,
                createdAt: row.created_at
            })),
            total,
            limit,
            offset
        };
    }

    /**
     * 获取指定 API Key 按时间间隔的统计数据（用于图表）
     * @param {number} apiKeyId - API Key ID
     * @param {object} options - 查询选项
     */
    async getUsageByInterval(apiKeyId, options = {}) {
        const { hours = 24, interval = 'hour' } = options;

        const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);
        const startDate = startTime.toISOString().slice(0, 19).replace('T', ' ');
        const apiKeyIdInt = parseInt(apiKeyId, 10);

        // 根据间隔类型选择时间格式
        let dateFormat;
        if (interval === 'day') {
            dateFormat = '%Y-%m-%d';
        } else if (interval === 'minute') {
            dateFormat = '%Y-%m-%d %H:%i';
        } else {
            dateFormat = '%Y-%m-%d %H:00';
        }

        const query = `
            SELECT
                DATE_FORMAT(created_at, '${dateFormat}') as time_bucket,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE api_key_id = ?
              AND created_at >= ?
              AND status_code = 200
            GROUP BY time_bucket
            ORDER BY time_bucket ASC
        `;

        const [rows] = await this.db.execute(query, [apiKeyIdInt, startDate]);
        return rows.map(row => ({
            time: row.time_bucket,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getErrorLogs(options = {}) {
        const { limit = 100, offset = 0, startDate, endDate } = options;
        let query = `
            SELECT * FROM api_logs
            WHERE status_code >= 400
        `;
        const params = [];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ` ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`;

        const [rows] = await this.db.execute(query, params);
        return {
            logs: rows.map(row => this._mapRow(row)),
            total: rows.length
        };
    }

    async getByRequestId(requestId) {
        const [rows] = await this.db.execute(
            'SELECT * FROM api_logs WHERE request_id = ?',
            [requestId]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async update(requestId, data) {
        const fields = [];
        const params = [];

        if (data.outputTokens !== undefined) {
            fields.push('output_tokens = ?');
            params.push(data.outputTokens);
        }
        if (data.statusCode !== undefined) {
            fields.push('status_code = ?');
            params.push(data.statusCode);
        }
        if (data.errorMessage !== undefined) {
            fields.push('error_message = ?');
            params.push(data.errorMessage);
        }
        if (data.durationMs !== undefined) {
            fields.push('duration_ms = ?');
            params.push(data.durationMs);
        }

        if (fields.length === 0) return;

        params.push(requestId);
        await this.db.execute(
            `UPDATE api_logs SET ${fields.join(', ')} WHERE request_id = ?`,
            params
        );
    }

    async delete(id) {
        await this.db.execute('DELETE FROM api_logs WHERE id = ?', [id]);
    }

    async cleanOldLogs(daysToKeep) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        await this.db.execute(
            'DELETE FROM api_logs WHERE created_at < ?',
            [cutoffDate.toISOString()]
        );
    }

    async getStatsByIp(options = {}) {
        const { startDate, endDate, limit = 100 } = options;
        let query = `
            SELECT
                ip_address as ipAddress,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ` GROUP BY ip_address ORDER BY requestCount DESC LIMIT ${parseInt(limit)}`;

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            ipAddress: row.ipAddress,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
  }

    async getStatsByApiKey(options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                al.api_key_id as apiKeyId,
                al.api_key_prefix as apiKeyPrefix,
                ak.name as apiKeyName,
                COUNT(*) as requestCount,
                COALESCE(SUM(al.input_tokens), 0) as inputTokens,
                COALESCE(SUM(al.output_tokens), 0) as outputTokens
            FROM api_logs al
            LEFT JOIN api_keys ak ON al.api_key_id = ak.id
            WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            query += ' AND al.created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND al.created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY al.api_key_id, al.api_key_prefix, ak.name';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            apiKeyId: row.apiKeyId,
            apiKeyPrefix: row.apiKeyPrefix,
            apiKeyName: row.apiKeyName,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getCostByApiKey(options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                al.api_key_id as apiKeyId,
                al.api_key_prefix as apiKeyPrefix,
                ak.name as apiKeyName,
                COUNT(*) as requestCount,
                COALESCE(SUM(al.input_tokens), 0) as inputTokens,
                COALESCE(SUM(al.output_tokens), 0) as outputTokens
            FROM api_logs al
            LEFT JOIN api_keys ak ON al.api_key_id = ak.id
            WHERE al.api_key_id IS NOT NULL
        `;
        const params = [];

        if (startDate) {
            query += ' AND al.created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND al.created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY al.api_key_id, al.api_key_prefix, ak.name';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            apiKeyId: row.apiKeyId,
            apiKeyPrefix: row.apiKeyPrefix,
            apiKeyName: row.apiKeyName,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getStatsByChannel(options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                COALESCE(channel, 'unknown') as channel,
                COUNT(*) as totalRequests,
                SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END) as successCount,
                SUM(CASE WHEN status_code >= 400 AND status_code NOT IN (401, 429) THEN 1 ELSE 0 END) as errorCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens,
                COALESCE(AVG(duration_ms), 0) as avgDurationMs
            FROM api_logs
            WHERE status_code NOT IN (401, 429)
        `;
        const params = [];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY channel ORDER BY totalRequests DESC';


        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            channel: row.channel,
            totalRequests: Number(row.totalRequests) || 0,
            successCount: Number(row.successCount) || 0,
            errorCount: Number(row.errorCount) || 0,
            successRate: row.totalRequests > 0 ? ((Number(row.successCount) / Number(row.totalRequests)) * 100).toFixed(2) : '0.00',
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0,
            avgDurationMs: Math.round(Number(row.avgDurationMs) || 0)
        }));
    }

    async getStatsByDate(options = {}) {
        const { startDate, endDate, apiKeyId } = options;
        let query = `
            SELECT
                DATE(created_at) as date,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE 1=1
        `;
        const params = [];

        if (apiKeyId) {
            query += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY DATE(created_at) ORDER BY date DESC';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            date: row.date,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getStatsByTimeInterval(options = {}) {
        const { startDate, endDate, apiKeyId, intervalMinutes = 20 } = options;
        let query = `
            SELECT
                FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(created_at) / (? * 60)) * (? * 60)) as time_slot,
                COUNT(*) as requestCount,
                COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens
            FROM api_logs
            WHERE 1=1
        `;
        const params = [intervalMinutes, intervalMinutes];

        if (apiKeyId) {
            query += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY time_slot ORDER BY time_slot ASC';

        const [rows] = await this.db.execute(query, params);
        return rows.map(row => ({
            timeSlot: row.time_slot,
            requestCount: Number(row.requestCount) || 0,
            inputTokens: Number(row.inputTokens) || 0,
            outputTokens: Number(row.outputTokens) || 0
        }));
    }

    async getChannelTimeSlotStats(options = {}) {
        const { startDate, endDate, intervalMinutes = 30 } = options;
        let query = `
            SELECT
                COALESCE(channel, 'unknown') as channel,
                FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(created_at) / (? * 60)) * (? * 60)) as time_slot,
                COUNT(*) as totalRequests,
                SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END) as successCount,
                SUM(CASE WHEN status_code >= 400 AND status_code NOT IN (401, 429) THEN 1 ELSE 0 END) as errorCount,
                COALESCE(AVG(duration_ms), 0) as avgDurationMs
            FROM api_logs
            WHERE status_code NOT IN (401, 429)
        `;
        const params = [intervalMinutes, intervalMinutes];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY channel, time_slot ORDER BY channel, time_slot ASC';

        const [rows] = await this.db.execute(query, params);

        const channelMap = {};
        for (const row of rows) {
            const ch = row.channel;
            if (!channelMap[ch]) channelMap[ch] = { channel: ch, slots: [] };
            channelMap[ch].slots.push({
                time: row.time_slot,
                total: Number(row.totalRequests) || 0,
                success: Number(row.successCount) || 0,
                error: Number(row.errorCount) || 0,
                avgMs: Math.round(Number(row.avgDurationMs) || 0)
            });
        }
        return Object.values(channelMap);
    }
}

/**
 * Gemini Antigravity 凭证管理类
 */
export class GeminiCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new GeminiCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO gemini_credentials (name, email, access_token, refresh_token, project_id, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.email || null,
            credential.accessToken,
            credential.refreshToken || null,
            credential.projectId || null,
            credential.expiresAt || null
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const toNull = (val) => val === undefined ? null : val;
        await this.db.execute(`
            UPDATE gemini_credentials SET
                name = COALESCE(?, name),
                email = COALESCE(?, email),
                access_token = COALESCE(?, access_token),
                refresh_token = COALESCE(?, refresh_token),
                project_id = COALESCE(?, project_id),
                expires_at = COALESCE(?, expires_at),
                error_count = COALESCE(?, error_count),
                last_error_at = COALESCE(?, last_error_at),
                last_error_message = COALESCE(?, last_error_message)
            WHERE id = ?
        `, [
            toNull(credential.name),
            toNull(credential.email),
            toNull(credential.accessToken),
            toNull(credential.refreshToken),
            toNull(credential.projectId),
            toNull(credential.expiresAt),
            toNull(credential.errorCount),
            toNull(credential.lastErrorAt),
            toNull(credential.lastErrorMessage),
            id
        ]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM gemini_credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM gemini_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM gemini_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM gemini_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getActive() {
        const [rows] = await this.db.execute('SELECT * FROM gemini_credentials WHERE is_active = 1 LIMIT 1');
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM gemini_credentials WHERE is_active = 1 ORDER BY error_count ASC, updated_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async setActive(id) {
        await this.db.execute('UPDATE gemini_credentials SET is_active = 0');
        await this.db.execute('UPDATE gemini_credentials SET is_active = 1 WHERE id = ?', [id]);
    }

    async updateUsage(id, usageData) {
        const usageJson = JSON.stringify(usageData);
        await this.db.execute(`
            UPDATE gemini_credentials SET
                usage_data = ?,
                usage_updated_at = NOW()
            WHERE id = ?
        `, [usageJson, id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE gemini_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async resetErrorCount(id) {
        await this.db.execute(`
            UPDATE gemini_credentials SET
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL
            WHERE id = ?
        `, [id]);
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            projectId: row.project_id,
            expiresAt: row.expires_at,
            isActive: row.is_active === 1,
            usageData: row.usage_data ? (typeof row.usage_data === 'string' ? JSON.parse(row.usage_data) : row.usage_data) : null,
            usageUpdatedAt: row.usage_updated_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    // ============ 错误凭证管理 ============

    async moveToError(id, errorMessage) {
        const credential = await this.getById(id);
        if (!credential) return null;

        const [existingError] = await this.db.execute(
            'SELECT id, error_count FROM gemini_error_credentials WHERE original_id = ?',
            [id]
        );

        if (existingError.length > 0) {
            const errorId = existingError[0].id;
            const errorCount = existingError[0].error_count + 1;
            await this.db.execute(`
                UPDATE gemini_error_credentials SET
                    error_message = ?,
                    error_count = ?,
                    last_error_at = NOW()
                WHERE id = ?
            `, [errorMessage, errorCount, errorId]);
        } else {
            await this.db.execute(`
                INSERT INTO gemini_error_credentials (
                    original_id, name, email, access_token, refresh_token,
                    project_id, expires_at, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                credential.id,
                credential.name,
                credential.email,
                credential.accessToken,
                credential.refreshToken,
                credential.projectId,
                credential.expiresAt,
                errorMessage,
                credential.createdAt
            ]);
        }

        await this.delete(id);
        return credential;
    }

    async restoreFromError(errorId, newAccessToken, newRefreshToken, newExpiresAt) {
        const [rows] = await this.db.execute('SELECT * FROM gemini_error_credentials WHERE id = ?', [errorId]);
        if (rows.length === 0) return null;

        const errorCred = this._mapErrorRow(rows[0]);

        const [result] = await this.db.execute(`
            INSERT INTO gemini_credentials (
                name, email, access_token, refresh_token, project_id, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            errorCred.name,
            errorCred.email,
            newAccessToken || errorCred.accessToken,
            newRefreshToken || errorCred.refreshToken,
            errorCred.projectId,
            newExpiresAt || errorCred.expiresAt,
            errorCred.createdAt
        ]);

        await this.db.execute('DELETE FROM gemini_error_credentials WHERE id = ?', [errorId]);
        return result.insertId;
    }

    async getAllErrors() {
        const [rows] = await this.db.execute('SELECT * FROM gemini_error_credentials ORDER BY last_error_at DESC');
        return rows.map(row => this._mapErrorRow(row));
    }

    async getErrorById(id) {
        const [rows] = await this.db.execute('SELECT * FROM gemini_error_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapErrorRow(rows[0]);
    }

    async deleteError(id) {
        await this.db.execute('DELETE FROM gemini_error_credentials WHERE id = ?', [id]);
    }

    _mapErrorRow(row) {
        return {
            id: row.id,
            originalId: row.original_id,
            name: row.name,
            email: row.email,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            projectId: row.project_id,
            expiresAt: row.expires_at,
            errorMessage: row.error_message,
            errorCount: row.error_count,
            lastErrorAt: row.last_error_at,
            createdAt: row.created_at
        };
    }
}

/**
 * Orchids 凭证管理类
 */
export class OrchidsCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new OrchidsCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO orchids_credentials (name, email, client_jwt, clerk_session_id, user_id, expires_at, weight, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.email || null,
            credential.clientJwt,
            credential.clerkSessionId || null,
            credential.userId || null,
            credential.expiresAt || null,
            credential.weight || 1,
            credential.isActive !== false ? 1 : 0
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const toNull = (val) => val === undefined ? null : val;
        
        // 构建动态更新语句
        const updates = [];
        const values = [];
        
        if (credential.name !== undefined) { updates.push('name = ?'); values.push(credential.name); }
        if (credential.email !== undefined) { updates.push('email = ?'); values.push(credential.email); }
        if (credential.clientJwt !== undefined) { updates.push('client_jwt = ?'); values.push(credential.clientJwt); }
        if (credential.clerkSessionId !== undefined) { updates.push('clerk_session_id = ?'); values.push(credential.clerkSessionId); }
        if (credential.userId !== undefined) { updates.push('user_id = ?'); values.push(credential.userId); }
        if (credential.expiresAt !== undefined) { updates.push('expires_at = ?'); values.push(credential.expiresAt); }
        if (credential.isActive !== undefined) { updates.push('is_active = ?'); values.push(credential.isActive ? 1 : 0); }
        if (credential.weight !== undefined) { updates.push('weight = ?'); values.push(credential.weight); }
        if (credential.errorCount !== undefined) { updates.push('error_count = ?'); values.push(credential.errorCount); }
        if (credential.lastErrorAt !== undefined) { updates.push('last_error_at = ?'); values.push(credential.lastErrorAt); }
        if (credential.lastErrorMessage !== undefined) { updates.push('last_error_message = ?'); values.push(credential.lastErrorMessage); }
        
        if (updates.length === 0) return;
        
        values.push(id);
        await this.db.execute(`UPDATE orchids_credentials SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM orchids_credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM orchids_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM orchids_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM orchids_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getActive() {
        const [rows] = await this.db.execute('SELECT * FROM orchids_credentials WHERE is_active = 1 LIMIT 1');
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM orchids_credentials WHERE is_active = 1 ORDER BY error_count ASC, updated_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async setActive(id) {
        await this.db.execute('UPDATE orchids_credentials SET is_active = 0');
        await this.db.execute('UPDATE orchids_credentials SET is_active = 1 WHERE id = ?', [id]);
    }

    async deactivate(id) {
        await this.db.execute('UPDATE orchids_credentials SET is_active = 0 WHERE id = ?', [id]);
    }

    async updateUsage(id, usageData) {
        const usageJson = JSON.stringify(usageData);
        await this.db.execute(`
            UPDATE orchids_credentials SET
                usage_data = ?,
                usage_updated_at = NOW()
            WHERE id = ?
        `, [usageJson, id]);
    }

    async updateCredits(id, plan, credits) {
        await this.db.execute(`
            UPDATE orchids_credentials SET
                plan = ?,
                credits = ?,
                credits_updated_at = NOW()
            WHERE id = ?
        `, [plan, credits, id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE orchids_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async resetErrorCount(id) {
        await this.db.execute(`
            UPDATE orchids_credentials SET
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL
            WHERE id = ?
        `, [id]);
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            clientJwt: row.client_jwt,
            clerkSessionId: row.clerk_session_id,
            userId: row.user_id,
            expiresAt: row.expires_at,
            isActive: row.is_active === 1,
            weight: row.weight || 1,
            requestCount: row.request_count || 0,
            successCount: row.success_count || 0,
            failureCount: row.failure_count || 0,
            lastUsedAt: row.last_used_at,
            usageData: row.usage_data ? (typeof row.usage_data === 'string' ? JSON.parse(row.usage_data) : row.usage_data) : null,
            usageUpdatedAt: row.usage_updated_at,
            plan: row.plan || null,
            credits: row.credits != null ? row.credits : null,
            creditsUpdatedAt: row.credits_updated_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    // ============ 负载均衡相关方法 ============

    /**
     * 获取所有已启用的账号（用于负载均衡）
     */
    async getEnabledAccounts() {
        const [rows] = await this.db.execute(
            'SELECT * FROM orchids_credentials WHERE is_active = 1 AND error_count < 5 ORDER BY weight DESC, error_count ASC'
        );
        return rows.map(row => this._mapRow(row));
    }

    /**
     * 更新权重
     */
    async updateWeight(id, weight) {
        await this.db.execute('UPDATE orchids_credentials SET weight = ? WHERE id = ?', [weight, id]);
    }

    /**
     * 增加请求计数
     */
    async addRequestCount(id, count = 1) {
        await this.db.execute(
            'UPDATE orchids_credentials SET request_count = request_count + ?, last_used_at = NOW() WHERE id = ?',
            [count, id]
        );
    }

    /**
     * 增加成功计数
     */
    async addSuccessCount(id, count = 1) {
        await this.db.execute(
            'UPDATE orchids_credentials SET success_count = success_count + ? WHERE id = ?',
            [count, id]
        );
    }

    /**
     * 增加失败计数
     */
    async addFailureCount(id, count = 1) {
        await this.db.execute(
            'UPDATE orchids_credentials SET failure_count = failure_count + ? WHERE id = ?',
            [count, id]
        );
    }

    /**
     * 重置统计计数
     */
    async resetCounts(id) {
        await this.db.execute(
            'UPDATE orchids_credentials SET request_count = 0, success_count = 0, failure_count = 0 WHERE id = ?',
            [id]
        );
    }

    /**
     * 获取统计汇总
     */
    async getStats() {
        const [rows] = await this.db.execute(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as enabled,
                SUM(CASE WHEN error_count > 0 THEN 1 ELSE 0 END) as error,
                SUM(request_count) as total_requests,
                SUM(success_count) as total_success,
                SUM(failure_count) as total_failure
            FROM orchids_credentials
        `);
        return rows[0];
    }

    // ============ 错误凭证管理 ============

    async moveToError(id, errorMessage) {
        const credential = await this.getById(id);
        if (!credential) return null;

        const [existingError] = await this.db.execute(
            'SELECT id, error_count FROM orchids_error_credentials WHERE original_id = ?',
            [id]
        );

        if (existingError.length > 0) {
            const errorId = existingError[0].id;
            const errorCount = existingError[0].error_count + 1;
            await this.db.execute(`
                UPDATE orchids_error_credentials SET
                    error_message = ?,
                    error_count = ?,
                    last_error_at = NOW()
                WHERE id = ?
            `, [errorMessage, errorCount, errorId]);
        } else {
            await this.db.execute(`
                INSERT INTO orchids_error_credentials (
                    original_id, name, email, client_jwt, clerk_session_id,
                    user_id, expires_at, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                credential.id,
                credential.name,
                credential.email,
                credential.clientJwt,
                credential.clerkSessionId,
                credential.userId,
                credential.expiresAt,
                errorMessage,
                credential.createdAt
            ]);
        }

        await this.delete(id);
        return credential;
    }

    async restoreFromError(errorId, newClientJwt, newExpiresAt) {
        const [rows] = await this.db.execute('SELECT * FROM orchids_error_credentials WHERE id = ?', [errorId]);
        if (rows.length === 0) return null;

        const errorCred = this._mapErrorRow(rows[0]);

        const [result] = await this.db.execute(`
            INSERT INTO orchids_credentials (
                name, email, client_jwt, clerk_session_id, user_id, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            errorCred.name,
            errorCred.email,
            newClientJwt || errorCred.clientJwt,
            errorCred.clerkSessionId,
            errorCred.userId,
            newExpiresAt || errorCred.expiresAt,
            errorCred.createdAt
        ]);

        await this.db.execute('DELETE FROM orchids_error_credentials WHERE id = ?', [errorId]);
        return result.insertId;
    }

    async getAllErrors() {
        const [rows] = await this.db.execute('SELECT * FROM orchids_error_credentials ORDER BY last_error_at DESC');
        return rows.map(row => this._mapErrorRow(row));
    }

    async getErrorById(id) {
        const [rows] = await this.db.execute('SELECT * FROM orchids_error_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapErrorRow(rows[0]);
    }

    async deleteError(id) {
        await this.db.execute('DELETE FROM orchids_error_credentials WHERE id = ?', [id]);
    }

    _mapErrorRow(row) {
        return {
            id: row.id,
            originalId: row.original_id,
            name: row.name,
            email: row.email,
            clientJwt: row.client_jwt,
            clerkSessionId: row.clerk_session_id,
            userId: row.user_id,
            expiresAt: row.expires_at,
            errorMessage: row.error_message,
            errorCount: row.error_count,
            lastErrorAt: row.last_error_at,
            createdAt: row.created_at
        };
    }
}

/**
 * Warp 凭证管理类
 */
export class WarpCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new WarpCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO warp_credentials (name, email, refresh_token, access_token, token_expires_at)
            VALUES (?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.email || null,
            credential.refreshToken,
            credential.accessToken || null,
            credential.tokenExpiresAt || null
        ]);
        return result.insertId;
    }

    async addBatch(credentials) {
        const results = [];
        for (const cred of credentials) {
            try {
                const id = await this.add(cred);
                results.push({ success: true, id, name: cred.name });
            } catch (e) {
                results.push({ success: false, name: cred.name, error: e.message });
            }
        }
        return results;
    }

    async update(id, credential) {
        const fields = [];
        const values = [];

        if (credential.name !== undefined) { fields.push('name = ?'); values.push(credential.name); }
        if (credential.email !== undefined) { fields.push('email = ?'); values.push(credential.email); }
        if (credential.refreshToken !== undefined) { fields.push('refresh_token = ?'); values.push(credential.refreshToken); }
        if (credential.accessToken !== undefined) { fields.push('access_token = ?'); values.push(credential.accessToken); }
        if (credential.tokenExpiresAt !== undefined) { fields.push('token_expires_at = ?'); values.push(credential.tokenExpiresAt); }
        if (credential.isActive !== undefined) { fields.push('is_active = ?'); values.push(credential.isActive ? 1 : 0); }

        if (fields.length === 0) return;

        values.push(id);
        await this.db.execute(`UPDATE warp_credentials SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async updateToken(id, accessToken, expiresAt) {
        await this.db.execute(`
            UPDATE warp_credentials SET
                access_token = ?,
                token_expires_at = ?,
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL
            WHERE id = ?
        `, [accessToken, expiresAt, id]);
    }

    async incrementUseCount(id) {
        await this.db.execute(`
            UPDATE warp_credentials SET
                use_count = use_count + 1,
                last_used_at = NOW()
            WHERE id = ?
        `, [id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE warp_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM warp_credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM warp_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM warp_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM warp_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM warp_credentials WHERE is_active = 1 ORDER BY use_count ASC, last_used_at ASC');
        return rows.map(row => this._mapRow(row));
    }

    async getRandomActive() {
        // 获取使用次数最少的活跃账号
        const [rows] = await this.db.execute(`
            SELECT * FROM warp_credentials 
            WHERE is_active = 1 AND error_count < 3
            ORDER BY use_count ASC, RAND()
            LIMIT 1
        `);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getRandomActiveExcluding(excludeIds = []) {
        // 获取使用次数最少的活跃账号，排除指定 ID
        let query = `
            SELECT * FROM warp_credentials 
            WHERE is_active = 1 AND error_count < 3
        `;
        
        if (excludeIds.length > 0) {
            const placeholders = excludeIds.map(() => '?').join(',');
            query += ` AND id NOT IN (${placeholders})`;
        }
        
        query += ` ORDER BY use_count ASC, RAND() LIMIT 1`;
        
        const [rows] = await this.db.execute(query, excludeIds);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async markQuotaExhausted(id) {
        // 标记账号额度耗尽（增加错误计数到阈值）
        await this.db.execute(
            'UPDATE warp_credentials SET error_count = 3, last_error_message = ?, last_error_at = NOW() WHERE id = ?',
            ['额度耗尽', id]
        );
    }

    async getCount() {
        const [rows] = await this.db.execute('SELECT COUNT(*) as count FROM warp_credentials');
        return rows[0].count;
    }

    async getActiveCount() {
        const [rows] = await this.db.execute('SELECT COUNT(*) as count FROM warp_credentials WHERE is_active = 1');
        return rows[0].count;
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM warp_credentials');
        const [active] = await this.db.execute('SELECT COUNT(*) as count FROM warp_credentials WHERE is_active = 1');
        const [healthy] = await this.db.execute('SELECT COUNT(*) as count FROM warp_credentials WHERE is_active = 1 AND error_count < 3');
        const [errors] = await this.db.execute('SELECT COUNT(*) as count FROM warp_error_credentials');
        const [totalUse] = await this.db.execute('SELECT SUM(use_count) as total FROM warp_credentials');

        return {
            total: total[0].count,
            active: active[0].count,
            healthy: healthy[0].count,
            errors: errors[0].count,
            totalUseCount: totalUse[0].total || 0
        };
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            refreshToken: row.refresh_token,
            accessToken: row.access_token,
            tokenExpiresAt: row.token_expires_at,
            isActive: row.is_active === 1,
            useCount: row.use_count || 0,
            lastUsedAt: row.last_used_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            quotaLimit: row.quota_limit || 0,
            quotaUsed: row.quota_used || 0,
            quotaUpdatedAt: row.quota_updated_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    async updateQuota(id, quotaLimit, quotaUsed) {
        await this.db.execute(
            'UPDATE warp_credentials SET quota_limit = ?, quota_used = ?, quota_updated_at = NOW() WHERE id = ?',
            [quotaLimit, quotaUsed, id]
        );
    }

    // ============ 错误凭证管理 ============

    async moveToError(id, errorMessage) {
        const credential = await this.getById(id);
        if (!credential) return null;

        const [existingError] = await this.db.execute(
            'SELECT id, error_count FROM warp_error_credentials WHERE original_id = ?',
            [id]
        );

        if (existingError.length > 0) {
            const errorId = existingError[0].id;
            const errorCount = existingError[0].error_count + 1;
            await this.db.execute(`
                UPDATE warp_error_credentials SET
                    error_message = ?,
                    error_count = ?,
                    last_error_at = NOW()
                WHERE id = ?
            `, [errorMessage, errorCount, errorId]);
        } else {
            await this.db.execute(`
                INSERT INTO warp_error_credentials (
                    original_id, name, email, refresh_token, access_token, error_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                credential.id,
                credential.name,
                credential.email,
                credential.refreshToken,
                credential.accessToken,
                errorMessage,
                credential.createdAt
            ]);
        }

        await this.delete(id);
        return credential;
    }

    async restoreFromError(errorId, newRefreshToken) {
        const [rows] = await this.db.execute('SELECT * FROM warp_error_credentials WHERE id = ?', [errorId]);
        if (rows.length === 0) return null;

        const errorCred = this._mapErrorRow(rows[0]);

        const [result] = await this.db.execute(`
            INSERT INTO warp_credentials (name, email, refresh_token, created_at)
            VALUES (?, ?, ?, ?)
        `, [
            errorCred.name,
            errorCred.email,
            newRefreshToken || errorCred.refreshToken,
            errorCred.createdAt
        ]);

        await this.db.execute('DELETE FROM warp_error_credentials WHERE id = ?', [errorId]);
        return result.insertId;
    }

    async getAllErrors() {
        const [rows] = await this.db.execute('SELECT * FROM warp_error_credentials ORDER BY last_error_at DESC');
        return rows.map(row => this._mapErrorRow(row));
    }

    async deleteError(id) {
        await this.db.execute('DELETE FROM warp_error_credentials WHERE id = ?', [id]);
    }

    _mapErrorRow(row) {
        return {
            id: row.id,
            originalId: row.original_id,
            name: row.name,
            email: row.email,
            refreshToken: row.refresh_token,
            accessToken: row.access_token,
            errorMessage: row.error_message,
            errorCount: row.error_count,
            lastErrorAt: row.last_error_at,
            createdAt: row.created_at
        };
    }
}

/**
 * Warp 请求统计存储
 */
export class WarpRequestStatsStore {
    constructor(db) {
        this.db = db;
    }

    async record(stats) {
        const {
            credentialId,
            apiKeyId = null,
            endpoint,
            model,
            isStream = false,
            inputTokens = 0,
            outputTokens = 0,
            totalTokens = 0,
            durationMs = 0,
            status = 'success',
            errorMessage = null
        } = stats;

        await this.db.execute(`
            INSERT INTO warp_request_stats (
                credential_id, api_key_id, endpoint, model, is_stream,
                input_tokens, output_tokens, total_tokens, duration_ms,
                status, error_message
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            credentialId, apiKeyId, endpoint, model, isStream ? 1 : 0,
            inputTokens, outputTokens, totalTokens, durationMs,
            status, errorMessage
        ]);
    }

    async getStats(options = {}) {
        const { credentialId, apiKeyId, model, startDate, endDate, limit = 100 } = options;
        
        let sql = 'SELECT * FROM warp_request_stats WHERE 1=1';
        const params = [];

        if (credentialId) {
            sql += ' AND credential_id = ?';
            params.push(credentialId);
        }
        if (apiKeyId) {
            sql += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (model) {
            sql += ' AND model = ?';
            params.push(model);
        }
        if (startDate) {
            sql += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND created_at <= ?';
            params.push(endDate);
        }

        sql += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const [rows] = await this.db.execute(sql, params);
        return rows.map(row => this._mapRow(row));
    }

    async getSummary(options = {}) {
        const { credentialId, apiKeyId, startDate, endDate } = options;
        
        let sql = `
            SELECT 
                COUNT(*) as total_requests,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                SUM(total_tokens) as total_tokens,
                AVG(duration_ms) as avg_duration_ms,
                model
            FROM warp_request_stats WHERE 1=1
        `;
        const params = [];

        if (credentialId) {
            sql += ' AND credential_id = ?';
            params.push(credentialId);
        }
        if (apiKeyId) {
            sql += ' AND api_key_id = ?';
            params.push(apiKeyId);
        }
        if (startDate) {
            sql += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND created_at <= ?';
            params.push(endDate);
        }

        sql += ' GROUP BY model';

        const [rows] = await this.db.execute(sql, params);
        return rows;
    }

    async getTotalSummary(options = {}) {
        const { startDate, endDate } = options;
        
        let sql = `
            SELECT 
                COUNT(*) as total_requests,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
                SUM(input_tokens) as total_input_tokens,
                SUM(output_tokens) as total_output_tokens,
                SUM(total_tokens) as total_tokens,
                AVG(duration_ms) as avg_duration_ms
            FROM warp_request_stats WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            sql += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND created_at <= ?';
            params.push(endDate);
        }

        const [rows] = await this.db.execute(sql, params);
        return rows[0];
    }

    async getCredentialSummary(options = {}) {
        const { startDate, endDate } = options;
        
        let sql = `
            SELECT 
                credential_id,
                COUNT(*) as total_requests,
                SUM(total_tokens) as total_tokens
            FROM warp_request_stats WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            sql += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            sql += ' AND created_at <= ?';
            params.push(endDate);
        }

        sql += ' GROUP BY credential_id ORDER BY total_requests DESC';

        const [rows] = await this.db.execute(sql, params);
        return rows;
    }

    _mapRow(row) {
        return {
            id: row.id,
            credentialId: row.credential_id,
            apiKeyId: row.api_key_id,
            endpoint: row.endpoint,
            model: row.model,
            isStream: row.is_stream === 1,
            inputTokens: row.input_tokens,
            outputTokens: row.output_tokens,
            totalTokens: row.total_tokens,
            durationMs: row.duration_ms,
            status: row.status,
            errorMessage: row.error_message,
            createdAt: row.created_at
        };
    }
}

/**
 * 套餐管理类
 */
export class PackageStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new PackageStore(database);
    }

    async add(pkg) {
        const [result] = await this.db.execute(`
            INSERT INTO packages (name, description, daily_limit, monthly_limit, total_limit, 
                concurrent_limit, rate_limit, daily_cost_limit, monthly_cost_limit, total_cost_limit,
                expires_in_days, price, sort_order, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            pkg.name,
            pkg.description || null,
            pkg.dailyLimit || 0,
            pkg.monthlyLimit || 0,
            pkg.totalLimit || 0,
            pkg.concurrentLimit || 0,
            pkg.rateLimit || 0,
            pkg.dailyCostLimit || 0,
            pkg.monthlyCostLimit || 0,
            pkg.totalCostLimit || 0,
            pkg.expiresInDays || 0,
            pkg.price || 0,
            pkg.sortOrder || 0,
            pkg.isActive !== false ? 1 : 0
        ]);
        return result.insertId;
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM packages WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll(includeInactive = false) {
        let query = 'SELECT * FROM packages';
        if (!includeInactive) {
            query += ' WHERE is_active = 1';
        }
        query += ' ORDER BY sort_order ASC, id ASC';
        const [rows] = await this.db.execute(query);
        return rows.map(row => this._mapRow(row));
    }

    async update(id, pkg) {
        const fields = [];
        const values = [];

        if (pkg.name !== undefined) { fields.push('name = ?'); values.push(pkg.name); }
        if (pkg.description !== undefined) { fields.push('description = ?'); values.push(pkg.description); }
        if (pkg.dailyLimit !== undefined) { fields.push('daily_limit = ?'); values.push(pkg.dailyLimit); }
        if (pkg.monthlyLimit !== undefined) { fields.push('monthly_limit = ?'); values.push(pkg.monthlyLimit); }
        if (pkg.totalLimit !== undefined) { fields.push('total_limit = ?'); values.push(pkg.totalLimit); }
        if (pkg.concurrentLimit !== undefined) { fields.push('concurrent_limit = ?'); values.push(pkg.concurrentLimit); }
        if (pkg.rateLimit !== undefined) { fields.push('rate_limit = ?'); values.push(pkg.rateLimit); }
        if (pkg.dailyCostLimit !== undefined) { fields.push('daily_cost_limit = ?'); values.push(pkg.dailyCostLimit); }
        if (pkg.monthlyCostLimit !== undefined) { fields.push('monthly_cost_limit = ?'); values.push(pkg.monthlyCostLimit); }
        if (pkg.totalCostLimit !== undefined) { fields.push('total_cost_limit = ?'); values.push(pkg.totalCostLimit); }
        if (pkg.expiresInDays !== undefined) { fields.push('expires_in_days = ?'); values.push(pkg.expiresInDays); }
        if (pkg.price !== undefined) { fields.push('price = ?'); values.push(pkg.price); }
        if (pkg.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(pkg.sortOrder); }
        if (pkg.isActive !== undefined) { fields.push('is_active = ?'); values.push(pkg.isActive ? 1 : 0); }

        if (fields.length === 0) return false;

        values.push(id);
        await this.db.execute(`UPDATE packages SET ${fields.join(', ')} WHERE id = ?`, values);
        return true;
    }

    async delete(id) {
        await this.db.execute('DELETE FROM packages WHERE id = ?', [id]);
        return true;
    }

    async toggleActive(id) {
        await this.db.execute('UPDATE packages SET is_active = NOT is_active WHERE id = ?', [id]);
        return true;
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            dailyLimit: row.daily_limit || 0,
            monthlyLimit: row.monthly_limit || 0,
            totalLimit: row.total_limit || 0,
            concurrentLimit: row.concurrent_limit || 0,
            rateLimit: row.rate_limit || 0,
            dailyCostLimit: parseFloat(row.daily_cost_limit) || 0,
            monthlyCostLimit: parseFloat(row.monthly_cost_limit) || 0,
            totalCostLimit: parseFloat(row.total_cost_limit) || 0,
            expiresInDays: row.expires_in_days || 0,
            price: parseFloat(row.price) || 0,
            sortOrder: row.sort_order || 0,
            isActive: row.is_active === 1,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * 试用申请管理类
 */
export class TrialApplicationStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new TrialApplicationStore(database);
    }

    async add(application) {
        const [result] = await this.db.execute(`
            INSERT INTO trial_applications (xianyu_name, order_screenshot, source, email)
            VALUES (?, ?, ?, ?)
        `, [
            application.xianyuName,
            application.orderScreenshot || null,
            application.source || null,
            application.email
        ]);
        return result.insertId;
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM trial_applications WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByEmail(email) {
        const [rows] = await this.db.execute(
            'SELECT * FROM trial_applications WHERE email = ? ORDER BY created_at DESC',
            [email]
        );
        return rows.map(row => this._mapRow(row));
    }

    async getLatestByEmail(email) {
        const [rows] = await this.db.execute(
            'SELECT * FROM trial_applications WHERE email = ? ORDER BY created_at DESC LIMIT 1',
            [email]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll(options = {}) {
        const { status, page = 1, pageSize = 50 } = options;
        const limit = parseInt(pageSize) || 50;
        const offset = ((parseInt(page) || 1) - 1) * limit;

        let query = 'SELECT * FROM trial_applications WHERE 1=1';
        const params = [];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
        const [countRows] = await this.db.execute(countQuery, params);
        const total = Number(countRows[0].total) || 0;

        query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        const [rows] = await this.db.execute(query, params);

        return {
            applications: rows.map(row => this._mapRow(row)),
            total,
            page: parseInt(page) || 1,
            pageSize: limit,
            totalPages: Math.ceil(total / limit)
        };
    }

    async approve(id, reviewedBy, apiKey, expiresAt, costLimit = 50) {
        await this.db.execute(`
            UPDATE trial_applications SET
                status = 'approved',
                api_key = ?,
                api_key_expires_at = ?,
                cost_limit = ?,
                reviewed_by = ?,
                reviewed_at = NOW()
            WHERE id = ?
        `, [apiKey, expiresAt, costLimit, reviewedBy, id]);
    }

    async reject(id, reviewedBy, reason = null) {
        await this.db.execute(`
            UPDATE trial_applications SET
                status = 'rejected',
                reject_reason = ?,
                reviewed_by = ?,
                reviewed_at = NOW()
            WHERE id = ?
        `, [reason, reviewedBy, id]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM trial_applications WHERE id = ?', [id]);
    }

    async getStats() {
        const [rows] = await this.db.execute(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
            FROM trial_applications
        `);
        return {
            total: Number(rows[0].total) || 0,
            pending: Number(rows[0].pending) || 0,
            approved: Number(rows[0].approved) || 0,
            rejected: Number(rows[0].rejected) || 0
        };
    }

    _mapRow(row) {
        return {
            id: row.id,
            xianyuName: row.xianyu_name,
            orderScreenshot: row.order_screenshot,
            source: row.source,
            email: row.email,
            status: row.status,
            apiKey: row.api_key,
            apiKeyExpiresAt: row.api_key_expires_at,
            costLimit: parseFloat(row.cost_limit) || 50,
            rejectReason: row.reject_reason,
            reviewedBy: row.reviewed_by,
            reviewedAt: row.reviewed_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * 站点设置管理类
 */
export class SiteSettingsStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new SiteSettingsStore(database);
    }

    async get() {
        const [rows] = await this.db.execute('SELECT * FROM site_settings WHERE id = 1');
        if (rows.length === 0) {
            return {
                siteName: 'Kiro',
                siteLogo: 'K',
                siteSubtitle: 'Account Manager'
            };
        }
        return this._mapRow(rows[0]);
    }

    async update(settings) {
        await this.db.execute(`
            INSERT INTO site_settings (id, site_name, site_logo, site_subtitle)
            VALUES (1, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                site_name = VALUES(site_name),
                site_logo = VALUES(site_logo),
                site_subtitle = VALUES(site_subtitle)
        `, [
            settings.siteName || 'Kiro',
            settings.siteLogo || 'K',
            settings.siteSubtitle || 'Account Manager'
        ]);
        return this.get();
    }

    _mapRow(row) {
        return {
            siteName: row.site_name,
            siteLogo: row.site_logo,
            siteSubtitle: row.site_subtitle,
            updatedAt: row.updated_at
        };
    }
}

/**
 * Vertex AI 凭证管理类
 */
export class VertexCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new VertexCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO vertex_credentials (name, project_id, client_email, private_key, region, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.projectId,
            credential.clientEmail,
            credential.privateKey,
            credential.region || 'global',
            credential.isActive !== false ? 1 : 0
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const fields = [];
        const values = [];

        if (credential.name !== undefined) { fields.push('name = ?'); values.push(credential.name); }
        if (credential.projectId !== undefined) { fields.push('project_id = ?'); values.push(credential.projectId); }
        if (credential.clientEmail !== undefined) { fields.push('client_email = ?'); values.push(credential.clientEmail); }
        if (credential.privateKey !== undefined) { fields.push('private_key = ?'); values.push(credential.privateKey); }
        if (credential.region !== undefined) { fields.push('region = ?'); values.push(credential.region); }
        if (credential.isActive !== undefined) { fields.push('is_active = ?'); values.push(credential.isActive ? 1 : 0); }
        if (credential.errorCount !== undefined) { fields.push('error_count = ?'); values.push(credential.errorCount); }
        if (credential.lastErrorMessage !== undefined) { fields.push('last_error_message = ?'); values.push(credential.lastErrorMessage); }

        if (fields.length === 0) return;

        values.push(id);
        await this.db.execute(`UPDATE vertex_credentials SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM vertex_credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM vertex_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM vertex_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM vertex_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM vertex_credentials WHERE is_active = 1 ORDER BY error_count ASC, updated_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getRandomActive() {
        const [rows] = await this.db.execute(`
            SELECT * FROM vertex_credentials
            WHERE is_active = 1 AND error_count < 3
            ORDER BY use_count ASC, RAND()
            LIMIT 1
        `);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async setActive(id) {
        await this.db.execute('UPDATE vertex_credentials SET is_active = 0');
        await this.db.execute('UPDATE vertex_credentials SET is_active = 1 WHERE id = ?', [id]);
    }

    async incrementUseCount(id) {
        await this.db.execute(`
            UPDATE vertex_credentials SET
                use_count = use_count + 1,
                last_used_at = NOW()
            WHERE id = ?
        `, [id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE vertex_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async resetErrorCount(id) {
        await this.db.execute(`
            UPDATE vertex_credentials SET
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL
            WHERE id = ?
        `, [id]);
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM vertex_credentials');
        const [active] = await this.db.execute('SELECT COUNT(*) as count FROM vertex_credentials WHERE is_active = 1');
        const [healthy] = await this.db.execute('SELECT COUNT(*) as count FROM vertex_credentials WHERE is_active = 1 AND error_count < 3');
        const [totalUse] = await this.db.execute('SELECT SUM(use_count) as total FROM vertex_credentials');

        return {
            total: total[0].count,
            active: active[0].count,
            healthy: healthy[0].count,
            totalUseCount: totalUse[0].total || 0
        };
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            projectId: row.project_id,
            clientEmail: row.client_email,
            privateKey: row.private_key,
            region: row.region || 'global',
            isActive: row.is_active === 1,
            useCount: row.use_count || 0,
            lastUsedAt: row.last_used_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    /**
     * 将凭据转换为 GCP 服务账号格式
     */
    toGcpCredentials(credential) {
      return {
            type: 'service_account',
            project_id: credential.projectId,
            client_email: credential.clientEmail,
            private_key: credential.privateKey
        };
    }
}

/**
 * 模型定价管理类
 */
export class ModelPricingStore {
    constructor(database) {
        this.db = database;
        this.cache = null;
        this.cacheTime = null;
        this.cacheTTL = 60000; // 缓存 60 秒
    }

    static async create() {
        const database = await getDatabase();
        return new ModelPricingStore(database);
    }

    /**
     * 获取所有定价配置
     */
    async getAll() {
        const [rows] = await this.db.execute(`
            SELECT * FROM model_pricing ORDER BY sort_order ASC, model_name ASC
        `);
        return rows.map(this._mapRow);
    }

    /**
     * 获取所有定价配置（带缓存）
     */
    async getAllCached() {
        const now = Date.now();
        if (this.cache && this.cacheTime && (now - this.cacheTime) < this.cacheTTL) {
            return this.cache;
        }
        this.cache = await this.getAll();
        this.cacheTime = now;
        return this.cache;
    }

    /**
     * 根据模型名称获取定价
     */
    async getByModel(modelName) {
        const [rows] = await this.db.execute(`
            SELECT * FROM model_pricing WHERE model_name = ? AND is_active = 1
        `, [modelName]);
        return rows.length > 0 ? this._mapRow(rows[0]) : null;
    }

    /**
     * 获取定价映射表（带缓存，用于快速查找）
     */
    async getPricingMap() {
        const all = await this.getAllCached();
        const map = {};
        for (const item of all) {
            if (item.isActive) {
                map[item.modelName] = {
                    input: parseFloat(item.inputPrice),
                    output: parseFloat(item.outputPrice)
                };
            }
        }
        return map;
    }

    /**
     * 根据 ID 获取定价
     */
    async getById(id) {
        const [rows] = await this.db.execute(`
            SELECT * FROM model_pricing WHERE id = ?
        `, [id]);
        return rows.length > 0 ? this._mapRow(rows[0]) : null;
    }

    /**
     * 添加定价配置
     */
    async add(pricing) {
        const [result] = await this.db.execute(`
            INSERT INTO model_pricing (model_name, display_name, provider, input_price, output_price, is_active, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            pricing.modelName,
            pricing.displayName || pricing.modelName,
            pricing.provider || 'anthropic',
            pricing.inputPrice,
            pricing.outputPrice,
            pricing.isActive !== false ? 1 : 0,
            pricing.sortOrder || 0
        ]);
        this.clearCache();
        return result.insertId;
    }

    /**
     * 更新定价配置
     */
    async update(id, pricing) {
        await this.db.execute(`
            UPDATE model_pricing SET
                model_name = COALESCE(?, model_name),
                display_name = COALESCE(?, display_name),
                provider = COALESCE(?, provider),
                input_price = COALESCE(?, input_price),
                output_price = COALESCE(?, output_price),
                is_active = COALESCE(?, is_active),
                sort_order = COALESCE(?, sort_order)
            WHERE id = ?
        `, [
            pricing.modelName || null,
            pricing.displayName || null,
            pricing.provider || null,
            pricing.inputPrice || null,
            pricing.outputPrice || null,
            pricing.isActive !== undefined ? (pricing.isActive ? 1 : 0) : null,
            pricing.sortOrder !== undefined ? pricing.sortOrder : null,
            id
        ]);
        this.clearCache();
    }

    /**
     * 删除定价配置
     */
    async delete(id) {
        await this.db.execute('DELETE FROM model_pricing WHERE id = ?', [id]);
        this.clearCache();
    }

    /**
     * 批量导入定价配置
     */
    async batchImport(pricingList) {
        const results = { success: 0, failed: 0, errors: [] };
        
        for (const pricing of pricingList) {
            try {
                // 检查是否已存在
                const existing = await this.getByModel(pricing.modelName);
                if (existing) {
                    // 更新现有记录
                    await this.update(existing.id, pricing);
                } else {
                    // 添加新记录
                    await this.add(pricing);
                }
                results.success++;
            } catch (err) {
                results.failed++;
                results.errors.push({ modelName: pricing.modelName, error: err.message });
            }
        }
        
        this.clearCache();
        return results;
    }

    /**
     * 初始化默认定价配置
     */
    async initDefaultPricing() {
        const defaultPricing = [
            // Claude Opus 4.5
            { modelName: 'claude-opus-4-5-20251101', displayName: 'Claude Opus 4.5', provider: 'anthropic', inputPrice: 15, outputPrice: 75, sortOrder: 1 },
            { modelName: 'claude-opus-4.5', displayName: 'Claude Opus 4.5 (alias)', provider: 'anthropic', inputPrice: 15, outputPrice: 75, sortOrder: 2 },
            // Claude Sonnet 4.5
            { modelName: 'claude-sonnet-4-5-20250929', displayName: 'Claude Sonnet 4.5', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 10 },
            // Claude Sonnet 4
            { modelName: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 11 },
            // Claude 3.7 Sonnet
            { modelName: 'claude-3-7-sonnet-20250219', displayName: 'Claude 3.7 Sonnet', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 12 },
            // Claude 3.5 Sonnet
            { modelName: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet v2', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 13 },
            { modelName: 'claude-3-5-sonnet-20240620', displayName: 'Claude 3.5 Sonnet v1', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 14 },
            // Claude Haiku 4.5
            { modelName: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', provider: 'anthropic', inputPrice: 0.80, outputPrice: 4, sortOrder: 20 },
            // Claude 3.5 Haiku
            { modelName: 'claude-3-5-haiku-20241022', displayName: 'Claude 3.5 Haiku', provider: 'anthropic', inputPrice: 0.80, outputPrice: 4, sortOrder: 21 },
            // Claude 3 Opus
            { modelName: 'claude-3-opus-20240229', displayName: 'Claude 3 Opus', provider: 'anthropic', inputPrice: 15, outputPrice: 75, sortOrder: 30 },
            // Claude 3 Sonnet
            { modelName: 'claude-3-sonnet-20240229', displayName: 'Claude 3 Sonnet', provider: 'anthropic', inputPrice: 3, outputPrice: 15, sortOrder: 31 },
            // Claude 3 Haiku
            { modelName: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku', provider: 'anthropic', inputPrice: 0.25, outputPrice: 1.25, sortOrder: 32 },
            // Gemini 模型
            { modelName: 'gemini-3-pro-preview', displayName: 'Gemini 3 Pro', provider: 'google', inputPrice: 1.25, outputPrice: 5, sortOrder: 50 },
            { modelName: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash', provider: 'google', inputPrice: 0.075, outputPrice: 0.30, sortOrder: 51 },
            { modelName: 'gemini-2.5-flash-preview', displayName: 'Gemini 2.5 Flash', provider: 'google', inputPrice: 0.075, outputPrice: 0.30, sortOrder: 52 },
        ];

        return await this.batchImport(defaultPricing);
    }

    /**
     * 清除缓存
     */
    clearCache() {
        this.cache = null;
        this.cacheTime = null;
    }

    _mapRow(row) {
        return {
            id: row.id,
            modelName: row.model_name,
            displayName: row.display_name,
            provider: row.provider,
            inputPrice: row.input_price,
            outputPrice: row.output_price,
            isActive: row.is_active === 1,
            sortOrder: row.sort_order,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * Amazon Bedrock 凭证管理类
 */
export class BedrockCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new BedrockCredentialStore(database);
    }

    async add(credential) {
        const authType = credential.bearerToken ? 'bearer' : 'iam';
        const [result] = await this.db.execute(`
            INSERT INTO bedrock_credentials (name, auth_type, access_key_id, secret_access_key, session_token, bearer_token, region, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            authType,
            credential.accessKeyId || null,
            credential.secretAccessKey || null,
            credential.sessionToken || null,
            credential.bearerToken || null,
            credential.region || 'us-east-1',
            credential.isActive !== false ? 1 : 0
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const fields = [];
        const values = [];

        if (credential.name !== undefined) { fields.push('name = ?'); values.push(credential.name); }
        if (credential.authType !== undefined) { fields.push('auth_type = ?'); values.push(credential.authType); }
        if (credential.accessKeyId !== undefined) { fields.push('access_key_id = ?'); values.push(credential.accessKeyId); }
        if (credential.secretAccessKey !== undefined) { fields.push('secret_access_key = ?'); values.push(credential.secretAccessKey); }
        if (credential.sessionToken !== undefined) { fields.push('session_token = ?'); values.push(credential.sessionToken); }
        if (credential.bearerToken !== undefined) { fields.push('bearer_token = ?'); values.push(credential.bearerToken); }
        if (credential.region !== undefined) { fields.push('region = ?'); values.push(credential.region); }
        if (credential.isActive !== undefined) { fields.push('is_active = ?'); values.push(credential.isActive ? 1 : 0); }
        if (credential.errorCount !== undefined) { fields.push('error_count = ?'); values.push(credential.errorCount); }
        if (credential.lastErrorMessage !== undefined) { fields.push('last_error_message = ?'); values.push(credential.lastErrorMessage); }

        if (fields.length === 0) return;

        values.push(id);
        await this.db.execute(`UPDATE bedrock_credentials SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM bedrock_credentials WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM bedrock_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM bedrock_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM bedrock_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM bedrock_credentials WHERE is_active = 1 ORDER BY error_count ASC, updated_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getRandomActive() {
        const [rows] = await this.db.execute(`
            SELECT * FROM bedrock_credentials
            WHERE is_active = 1 AND error_count < 3
            ORDER BY use_count ASC, RAND()
            LIMIT 1
        `);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async setActive(id) {
        await this.db.execute('UPDATE bedrock_credentials SET is_active = 0');
        await this.db.execute('UPDATE bedrock_credentials SET is_active = 1 WHERE id = ?', [id]);
    }

    async incrementUseCount(id) {
        await this.db.execute(`
            UPDATE bedrock_credentials SET
                use_count = use_count + 1,
                last_used_at = NOW()
            WHERE id = ?
        `, [id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE bedrock_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async resetErrorCount(id) {
        await this.db.execute(`
            UPDATE bedrock_credentials SET
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL
            WHERE id = ?
        `, [id]);
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM bedrock_credentials');
        const [active] = await this.db.execute('SELECT COUNT(*) as count FROM bedrock_credentials WHERE is_active = 1');
        const [healthy] = await this.db.execute('SELECT COUNT(*) as count FROM bedrock_credentials WHERE is_active = 1 AND error_count < 3');
        const [totalUse] = await this.db.execute('SELECT SUM(use_count) as total FROM bedrock_credentials');
        const [tokenStats] = await this.db.execute(`
            SELECT
                COALESCE(SUM(input_tokens), 0) as totalInputTokens,
                COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
                COALESCE(SUM(total_cost), 0) as totalCost
            FROM bedrock_credentials
        `);

        return {
            total: total[0].count,
            active: active[0].count,
            healthy: healthy[0].count,
            totalUseCount: totalUse[0].total || 0,
            totalInputTokens: Number(tokenStats[0].totalInputTokens) || 0,
            totalOutputTokens: Number(tokenStats[0].totalOutputTokens) || 0,
            totalCost: Number(tokenStats[0].totalCost) || 0
        };
    }

    async updateTokenStats(id, inputTokens, outputTokens, cost) {
        await this.db.execute(`
            UPDATE bedrock_credentials SET
                input_tokens = input_tokens + ?,
                output_tokens = output_tokens + ?,
                total_cost = total_cost + ?
            WHERE id = ?
        `, [inputTokens, outputTokens, cost, id]);
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            authType: row.auth_type || 'iam',
            accessKeyId: row.access_key_id,
            secretAccessKey: row.secret_access_key,
            sessionToken: row.session_token,
            bearerToken: row.bearer_token,
            region: row.region || 'us-east-1',
            isActive: row.is_active === 1,
            useCount: row.use_count || 0,
            inputTokens: Number(row.input_tokens) || 0,
            outputTokens: Number(row.output_tokens) || 0,
            totalCost: Number(row.total_cost) || 0,
            lastUsedAt: row.last_used_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * AMI 凭证管理类
 */
export class AmiCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new AmiCredentialStore(database);
    }

    async add(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO ami_credentials (name, session_cookie, project_id, chat_id, note, status, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.sessionCookie,
            credential.projectId || null,
            credential.chatId || null,
            credential.note || null,
            credential.status || 'active',
            credential.isActive !== false ? 1 : 0
        ]);
        return { id: result.insertId, ...credential };
    }

    async update(id, credential) {
        const existing = await this.getById(id);
        if (!existing) return null;

        const fields = [];
        const values = [];

        if (credential.name !== undefined) { fields.push('name = ?'); values.push(credential.name); }
        if (credential.sessionCookie !== undefined) { fields.push('session_cookie = ?'); values.push(credential.sessionCookie); }
        if (credential.projectId !== undefined) { fields.push('project_id = ?'); values.push(credential.projectId); }
        if (credential.chatId !== undefined) { fields.push('chat_id = ?'); values.push(credential.chatId); }
        if (credential.note !== undefined) { fields.push('note = ?'); values.push(credential.note); }
        if (credential.status !== undefined) { fields.push('status = ?'); values.push(credential.status); }
        if (credential.isActive !== undefined) { fields.push('is_active = ?'); values.push(credential.isActive ? 1 : 0); }
        if (credential.useCount !== undefined) { fields.push('use_count = ?'); values.push(credential.useCount); }
        if (credential.lastUsed !== undefined) { fields.push('last_used_at = ?'); values.push(credential.lastUsed); }
        if (credential.errorCount !== undefined) { fields.push('error_count = ?'); values.push(credential.errorCount); }
        if (credential.lastErrorAt !== undefined) { fields.push('last_error_at = ?'); values.push(credential.lastErrorAt); }
        if (credential.lastErrorMessage !== undefined) { fields.push('last_error_message = ?'); values.push(credential.lastErrorMessage); }

        if (fields.length === 0) return existing;

        values.push(id);
        await this.db.execute(`UPDATE ami_credentials SET ${fields.join(', ')} WHERE id = ?`, values);
        return await this.getById(id);
    }

    async delete(id) {
        const existing = await this.getById(id);
        if (!existing) return false;
        await this.db.execute('DELETE FROM ami_credentials WHERE id = ?', [id]);
        return true;
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM ami_credentials WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute('SELECT * FROM ami_credentials WHERE name = ?', [name]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM ami_credentials ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM ami_credentials WHERE is_active = 1 AND status = ? ORDER BY error_count ASC, updated_at DESC', ['active']);
        return rows.map(row => this._mapRow(row));
    }

    async getRandomActive() {
        const [rows] = await this.db.execute(`
            SELECT * FROM ami_credentials
            WHERE is_active = 1 AND status = 'active' AND error_count < 3
            ORDER BY use_count ASC, RAND()
            LIMIT 1
        `);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async incrementUseCount(id) {
        await this.db.execute(`
            UPDATE ami_credentials SET
                use_count = use_count + 1,
                last_used_at = NOW()
            WHERE id = ?
        `, [id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE ami_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async resetErrorCount(id) {
        await this.db.execute(`
            UPDATE ami_credentials SET
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL,
                status = 'active'
            WHERE id = ?
        `, [id]);
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM ami_credentials');
        const [active] = await this.db.execute('SELECT COUNT(*) as count FROM ami_credentials WHERE is_active = 1 AND status = ?', ['active']);
        const [error] = await this.db.execute('SELECT COUNT(*) as count FROM ami_credentials WHERE status = ?', ['error']);
        const [totalUse] = await this.db.execute('SELECT SUM(use_count) as total FROM ami_credentials');
        const [tokenStats] = await this.db.execute(`
            SELECT
                COALESCE(SUM(input_tokens), 0) as totalInputTokens,
                COALESCE(SUM(output_tokens), 0) as totalOutputTokens,
                COALESCE(SUM(total_cost), 0) as totalCost
            FROM ami_credentials
        `);

        return {
            total: total[0].count,
            active: active[0].count,
            error: error[0].count,
            totalUseCount: totalUse[0].total || 0,
            totalInputTokens: Number(tokenStats[0].totalInputTokens) || 0,
            totalOutputTokens: Number(tokenStats[0].totalOutputTokens) || 0,
            totalCost: Number(tokenStats[0].totalCost) || 0
        };
    }

    async updateTokenStats(id, inputTokens, outputTokens, cost = 0) {
        await this.db.execute(`
            UPDATE ami_credentials SET
                input_tokens = input_tokens + ?,
                output_tokens = output_tokens + ?,
                total_cost = total_cost + ?
            WHERE id = ?
        `, [inputTokens, outputTokens, cost, id]);
    }

    async updateAccountStatus(id, { isPaid, dailyUsage, tokenExpiresHours, status }) {
        const fields = [];
        const values = [];
        if (isPaid !== undefined)          { fields.push('is_paid = ?');              values.push(isPaid ? 1 : 0); }
        if (dailyUsage !== undefined)      { fields.push('daily_usage = ?');          values.push(dailyUsage); }
        if (tokenExpiresHours !== undefined){ fields.push('token_expires_hours = ?'); values.push(tokenExpiresHours); }
        if (status !== undefined)          { fields.push('status = ?');              values.push(status); }
        fields.push('last_check_at = NOW()');
        values.push(id);
        await this.db.execute(`UPDATE ami_credentials SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            sessionCookie: row.session_cookie,
            projectId: row.project_id,
            chatId: row.chat_id,
            note: row.note,
            status: row.status || 'active',
            isActive: row.is_active === 1,
            useCount: row.use_count || 0,
            inputTokens: Number(row.input_tokens) || 0,
            outputTokens: Number(row.output_tokens) || 0,
            totalCost: Number(row.total_cost) || 0,
            isPaid: row.is_paid === 1,
            dailyUsage: Number(row.daily_usage) || 0,
            tokenExpiresHours: Number(row.token_expires_hours) || 0,
            lastCheckAt: row.last_check_at,
            lastUsedAt: row.last_used_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * 工具调用日志管理类
 */
export class ToolCallLogStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new ToolCallLogStore(database);
    }

    /**
     * 记录工具调用日志
     */
    async log(logData) {
        try {
            const [result] = await this.db.execute(`
                INSERT INTO tool_call_logs (
                    request_id, credential_id, credential_name,
                    tool_name, tool_use_id, input_size,
                    log_level, message, input_preview
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                logData.requestId || null,
                logData.credentialId || null,
                logData.credentialName || null,
                logData.toolName,
                logData.toolUseId || null,
                logData.inputSize || 0,
                logData.logLevel || 'INFO',
                logData.message || null,
                logData.inputPreview || null
            ]);
            return result.insertId;
        } catch (error) {
            console.error('[ToolCallLogStore] 写入日志失败:', error.message);
            return null;
        }
    }

    /**
     * 记录警告日志
     */
    async warn(toolName, message, extra = {}) {
        return this.log({
            ...extra,
            toolName,
            message,
            logLevel: 'WARN'
        });
    }

    /**
     * 记录错误日志
     */
    async error(toolName, message, extra = {}) {
        return this.log({
            ...extra,
            toolName,
            message,
            logLevel: 'ERROR'
        });
    }

    /**
     * 获取日志列表
     */
    async getAll(options = {}) {
        const { page = 1, pageSize = 100, toolName, logLevel, startDate, endDate } = options;
        const limit = parseInt(pageSize) || 100;
        const offset = ((parseInt(page) || 1) - 1) * limit;

        let query = 'SELECT * FROM tool_call_logs WHERE 1=1';
        const params = [];

        if (toolName) {
            query += ' AND tool_name = ?';
            params.push(toolName);
        }
        if (logLevel) {
            query += ' AND log_level = ?';
            params.push(logLevel);
        }
        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
        const [countRows] = await this.db.execute(countQuery, params);
        const total = Number(countRows[0].total) || 0;

        query += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
        const [rows] = await this.db.execute(query, params);

        return {
            logs: rows.map(row => this._mapRow(row)),
            total,
            page: parseInt(page) || 1,
            pageSize: limit,
            totalPages: Math.ceil(total / limit)
        };
    }

    /**
     * 获取统计信息
     */
    async getStats(options = {}) {
        const { startDate, endDate } = options;
        let query = `
            SELECT
                tool_name as toolName,
                log_level as logLevel,
                COUNT(*) as count
            FROM tool_call_logs
            WHERE 1=1
        `;
        const params = [];

        if (startDate) {
            query += ' AND created_at >= ?';
            params.push(startDate);
        }
        if (endDate) {
            query += ' AND created_at <= ?';
            params.push(endDate);
        }

        query += ' GROUP BY tool_name, log_level ORDER BY count DESC';

        const [rows] = await this.db.execute(query, params);
        return rows;
    }

    /**
     * 清理旧日志
     */
    async cleanOldLogs(daysToKeep = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const [result] = await this.db.execute(
            'DELETE FROM tool_call_logs WHERE created_at < ?',
            [cutoffDate.toISOString().replace('T', ' ').substring(0, 19)]
        );
        return result.affectedRows;
    }

    _mapRow(row) {
        return {
            id: row.id,
            requestId: row.request_id,
            credentialId: row.credential_id,
            credentialName: row.credential_name,
            toolName: row.tool_name,
            toolUseId: row.tool_use_id,
            inputSize: row.input_size,
            logLevel: row.log_level,
            message: row.message,
            inputPreview: row.input_preview,
            createdAt: row.created_at
        };
    }
}

/**
 * Codex 凭证管理类
 */
export class CodexCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new CodexCredentialStore(database);
    }

    async getAll() {
        const [rows] = await this.db.execute(`
            SELECT * FROM codex_credentials ORDER BY created_at DESC
        `);
        return rows.map(row => this._mapRow(row));
    }

    async getById(id) {
        const [rows] = await this.db.execute(
            'SELECT * FROM codex_credentials WHERE id = ?',
            [id]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByName(name) {
        const [rows] = await this.db.execute(
            'SELECT * FROM codex_credentials WHERE name = ?',
            [name]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByEmail(email) {
        const [rows] = await this.db.execute(
            'SELECT * FROM codex_credentials WHERE email = ?',
            [email]
        );
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async create(credential) {
        const [result] = await this.db.execute(`
            INSERT INTO codex_credentials (
                name, email, account_id, access_token, refresh_token,
                id_token, expires_at, note, status, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            credential.name,
            credential.email || null,
            credential.accountId || null,
            credential.accessToken || null,
            credential.refreshToken,
            credential.idToken || null,
            credential.expiresAt || null,
            credential.note || null,
            credential.status || 'active',
            credential.isActive !== false ? 1 : 0
        ]);
        return result.insertId;
    }

    async update(id, credential) {
        const fields = [];
        const values = [];

        if (credential.name !== undefined) {
            fields.push('name = ?');
            values.push(credential.name);
        }
        if (credential.email !== undefined) {
            fields.push('email = ?');
            values.push(credential.email);
        }
        if (credential.accountId !== undefined) {
            fields.push('account_id = ?');
            values.push(credential.accountId);
        }
        if (credential.accessToken !== undefined) {
            fields.push('access_token = ?');
            values.push(credential.accessToken);
        }
        if (credential.refreshToken !== undefined) {
            fields.push('refresh_token = ?');
            values.push(credential.refreshToken);
        }
        if (credential.idToken !== undefined) {
            fields.push('id_token = ?');
            values.push(credential.idToken);
        }
        if (credential.expiresAt !== undefined) {
            fields.push('expires_at = ?');
            values.push(credential.expiresAt);
        }
        if (credential.note !== undefined) {
            fields.push('note = ?');
            values.push(credential.note);
        }
        if (credential.status !== undefined) {
            fields.push('status = ?');
            values.push(credential.status);
        }
        if (credential.isActive !== undefined) {
            fields.push('is_active = ?');
            values.push(credential.isActive ? 1 : 0);
        }

        if (fields.length === 0) return;

        values.push(id);
        await this.db.execute(
            `UPDATE codex_credentials SET ${fields.join(', ')} WHERE id = ?`,
            values
        );
    }

    async delete(id) {
        await this.db.execute('DELETE FROM codex_credentials WHERE id = ?', [id]);
    }

    async getRandomActive() {
        const [rows] = await this.db.execute(`
            SELECT * FROM codex_credentials
            WHERE is_active = 1 AND status = 'active' AND error_count < 3
            ORDER BY use_count ASC, RAND()
            LIMIT 1
        `);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async incrementUseCount(id) {
        await this.db.execute(`
            UPDATE codex_credentials SET
                use_count = use_count + 1,
                last_used_at = NOW()
            WHERE id = ?
        `, [id]);
    }

    async incrementErrorCount(id, errorMessage) {
        await this.db.execute(`
            UPDATE codex_credentials SET
                error_count = error_count + 1,
                last_error_at = NOW(),
                last_error_message = ?
            WHERE id = ?
        `, [errorMessage, id]);
    }

    async resetErrorCount(id) {
        await this.db.execute(`
            UPDATE codex_credentials SET
                error_count = 0,
                last_error_at = NULL,
                last_error_message = NULL,
                status = 'active'
            WHERE id = ?
        `, [id]);
    }

    async updateTokens(id, tokens) {
        await this.db.execute(`
            UPDATE codex_credentials SET
                access_token = ?,
                refresh_token = ?,
                id_token = ?,
                account_id = COALESCE(?, account_id),
                email = COALESCE(?, email),
                expires_at = ?,
                error_count = 0,
                status = 'active'
            WHERE id = ?
        `, [
            tokens.accessToken,
            tokens.refreshToken,
            tokens.idToken || null,
            tokens.accountId || null,
            tokens.email || null,
            tokens.expiresAt || null,
            id
        ]);
    }

    async updateUsage(id, usage) {
        // 自动适配两种输入格式：
        // 1. getUsageLimits() 原始返回值 (含 primaryWindow/secondaryWindow/summary)
        // 2. 已提取的扁平对象 (含 usagePercent/primaryUsagePercent 等)
        let usagePercent = usage.usagePercent;
        let usageResetAt = usage.usageResetAt;
        let planType = usage.planType || null;
        let primaryUsagePercent = usage.primaryUsagePercent;
        let primaryResetAt = usage.primaryResetAt;
        let secondaryUsagePercent = usage.secondaryUsagePercent;
        let secondaryResetAt = usage.secondaryResetAt;
        let quotaError = usage.quotaError || null;

        // 如果传入的是 getUsageLimits() 原始格式，自动提取
        if (usage.summary && usagePercent === undefined) {
            usagePercent = usage.summary.usedPercent ?? null;
            usageResetAt = usage.summary.resetTime || null;
        }
        if (usage.primaryWindow && primaryUsagePercent === undefined) {
            primaryUsagePercent = usage.primaryWindow.usedPercent ?? null;
            primaryResetAt = usage.primaryWindow.resetAtTimestamp ?? null;
        }
        if (usage.secondaryWindow && secondaryUsagePercent === undefined) {
            secondaryUsagePercent = usage.secondaryWindow.usedPercent ?? null;
            secondaryResetAt = usage.secondaryWindow.resetAtTimestamp ?? null;
        }

        // 转换 ISO 8601 日期为 MySQL 格式
        let resetAt = null;
        if (usageResetAt) {
            const date = new Date(usageResetAt);
            if (!isNaN(date.getTime())) {
                resetAt = date.toISOString().slice(0, 19).replace('T', ' ');
            }
        }
        
        await this.db.execute(`
            UPDATE codex_credentials SET
                usage_percent = ?,
                usage_reset_at = ?,
                plan_type = ?,
                primary_usage_percent = ?,
                primary_reset_at = ?,
                secondary_usage_percent = ?,
                secondary_reset_at = ?,
                quota_error = ?,
                usage_updated_at = NOW()
            WHERE id = ?
        `, [
            usagePercent !== undefined ? usagePercent : null,
            resetAt,
            planType,
            primaryUsagePercent !== undefined ? primaryUsagePercent : null,
            primaryResetAt || null,
            secondaryUsagePercent !== undefined ? secondaryUsagePercent : null,
            secondaryResetAt || null,
            quotaError,
            id
        ]);
    }

    async batchUpdateUsage(usages) {
        for (const usage of usages) {
            await this.updateUsage(usage.id, usage);
        }
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM codex_credentials');
        const [active] = await this.db.execute('SELECT COUNT(*) as count FROM codex_credentials WHERE is_active = 1 AND status = ?', ['active']);
        const [error] = await this.db.execute('SELECT COUNT(*) as count FROM codex_credentials WHERE status = ?', ['error']);
        const [totalUse] = await this.db.execute('SELECT SUM(use_count) as total FROM codex_credentials');

        return {
            total: total[0].count,
            active: active[0].count,
            error: error[0].count,
            totalUseCount: totalUse[0].total || 0
        };
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            email: row.email,
            accountId: row.account_id,
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            idToken: row.id_token,
            expiresAt: row.expires_at,
            note: row.note,
            status: row.status || 'active',
            isActive: row.is_active === 1,
            useCount: row.use_count || 0,
            lastUsedAt: row.last_used_at,
            errorCount: row.error_count || 0,
            lastErrorAt: row.last_error_at,
            lastErrorMessage: row.last_error_message,
            usagePercent: row.usage_percent !== null ? parseFloat(row.usage_percent) : null,
            usageResetAt: row.usage_reset_at,
            planType: row.plan_type,
            primaryUsagePercent: row.primary_usage_percent !== null && row.primary_usage_percent !== undefined ? parseFloat(row.primary_usage_percent) : null,
            primaryResetAt: row.primary_reset_at ? Number(row.primary_reset_at) : null,
            secondaryUsagePercent: row.secondary_usage_percent !== null && row.secondary_usage_percent !== undefined ? parseFloat(row.secondary_usage_percent) : null,
            secondaryResetAt: row.secondary_reset_at ? Number(row.secondary_reset_at) : null,
            quotaError: row.quota_error || null,
            usageUpdatedAt: row.usage_updated_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * 满血号池管理类
 */
export class FullAccountStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new FullAccountStore(database);
    }

    async add(account) {
        const [result] = await this.db.execute(`
            INSERT INTO full_accounts (name, type, credentials, remark, is_active)
            VALUES (?, ?, ?, ?, ?)
        `, [
            account.name,
            account.type,
            JSON.stringify(account.credentials),
            account.remark || null,
            account.isActive !== false ? 1 : 0
        ]);
        return result.insertId;
    }

    async update(id, account) {
        const fields = [];
        const values = [];

        if (account.name !== undefined) { fields.push('name = ?'); values.push(account.name); }
        if (account.type !== undefined) { fields.push('type = ?'); values.push(account.type); }
        if (account.credentials !== undefined) { fields.push('credentials = ?'); values.push(JSON.stringify(account.credentials)); }
        if (account.remark !== undefined) { fields.push('remark = ?'); values.push(account.remark); }
        if (account.isActive !== undefined) { fields.push('is_active = ?'); values.push(account.isActive ? 1 : 0); }
        if (account.models !== undefined) { fields.push('models = ?'); values.push(JSON.stringify(account.models)); }
        if (account.lastTestedAt !== undefined) { fields.push('last_tested_at = ?'); values.push(account.lastTestedAt); }

        if (fields.length === 0) return;

        values.push(id);
        await this.db.execute(`UPDATE full_accounts SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM full_accounts WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM full_accounts WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM full_accounts ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getAllActive() {
        const [rows] = await this.db.execute('SELECT * FROM full_accounts WHERE is_active = 1 ORDER BY created_at DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getByType(type) {
        const [rows] = await this.db.execute('SELECT * FROM full_accounts WHERE type = ? ORDER BY created_at DESC', [type]);
        return rows.map(row => this._mapRow(row));
    }

    async toggleActive(id) {
        await this.db.execute('UPDATE full_accounts SET is_active = NOT is_active WHERE id = ?', [id]);
    }

    async batchDelete(ids) {
        if (!ids || ids.length === 0) return 0;
        const placeholders = ids.map(() => '?').join(',');
        const [result] = await this.db.execute(`DELETE FROM full_accounts WHERE id IN (${placeholders})`, ids);
        return result.affectedRows;
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM full_accounts');
        const [byType] = await this.db.execute('SELECT type, COUNT(*) as count FROM full_accounts GROUP BY type');

        const stats = { total: total[0].count, digitalocean: 0, aws: 0, gcp: 0, azure: 0, other: 0 };
        byType.forEach(row => { stats[row.type] = row.count; });
        return stats;
    }

    _mapRow(row) {
        let credentials = {};
        try {
            credentials = typeof row.credentials === 'string' ? JSON.parse(row.credentials) : row.credentials;
        } catch (e) { credentials = {}; }

        let models = [];
        try {
            models = row.models ? (typeof row.models === 'string' ? JSON.parse(row.models) : row.models) : [];
        } catch (e) { models = []; }

        return {
            id: row.id,
            name: row.name,
            type: row.type,
            credentials,
            remark: row.remark,
            isActive: row.is_active === 1,
            models,
            lastTestedAt: row.last_tested_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

// 模型映射存储
export class ModelMappingStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new ModelMappingStore(database);
    }

    async add(mapping) {
        const [result] = await this.db.execute(`
            INSERT INTO model_mappings (source_model, target_model, provider, is_active, priority)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE target_model = VALUES(target_model), is_active = VALUES(is_active), priority = VALUES(priority)
        `, [
            mapping.sourceModel,
            mapping.targetModel,
            mapping.provider || 'digitalocean',
            mapping.isActive !== false ? 1 : 0,
            mapping.priority || 0
        ]);
        return result.insertId;
    }

    async update(id, mapping) {
        const fields = [];
        const values = [];

        if (mapping.sourceModel !== undefined) { fields.push('source_model = ?'); values.push(mapping.sourceModel); }
        if (mapping.targetModel !== undefined) { fields.push('target_model = ?'); values.push(mapping.targetModel); }
        if (mapping.provider !== undefined) { fields.push('provider = ?'); values.push(mapping.provider); }
        if (mapping.isActive !== undefined) { fields.push('is_active = ?'); values.push(mapping.isActive ? 1 : 0); }
        if (mapping.priority !== undefined) { fields.push('priority = ?'); values.push(mapping.priority); }

        if (fields.length === 0) return;

        values.push(id);
        await this.db.execute(`UPDATE model_mappings SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM model_mappings WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM model_mappings WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM model_mappings ORDER BY priority DESC, source_model ASC');
        return rows.map(row => this._mapRow(row));
    }

    async getByProvider(provider) {
        const [rows] = await this.db.execute('SELECT * FROM model_mappings WHERE provider = ? ORDER BY priority DESC', [provider]);
        return rows.map(row => this._mapRow(row));
    }

    async getActiveByProvider(provider) {
        const [rows] = await this.db.execute('SELECT * FROM model_mappings WHERE provider = ? AND is_active = 1 ORDER BY priority DESC', [provider]);
        return rows.map(row => this._mapRow(row));
    }

    // 根据源模型名称查找目标模型
    async findTargetModel(sourceModel, provider = 'digitalocean') {
        const [rows] = await this.db.execute(`
            SELECT target_model FROM model_mappings
            WHERE source_model = ? AND provider = ? AND is_active = 1
            ORDER BY priority DESC LIMIT 1
        `, [sourceModel, provider]);
        return rows.length > 0 ? rows[0].target_model : null;
    }

    // 批量添加/更新映射
    async batchUpsert(mappings) {
        for (const mapping of mappings) {
            await this.add(mapping);
        }
        return mappings.length;
    }

    _mapRow(row) {
        return {
            id: row.id,
            sourceModel: row.source_model,
            targetModel: row.target_model,
            provider: row.provider,
            isActive: row.is_active === 1,
            priority: row.priority,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }
}

/**
 * 兑换码管理类
 */
export class RedemptionCodeStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new RedemptionCodeStore(database);
    }

    async generateCodes(packageId, count, createdBy, expiresAt = null, note = null) {
        const codes = [];
        for (let i = 0; i < count; i++) {
            const code = this._generateCode();
            const [result] = await this.db.execute(`
                INSERT INTO redemption_codes (code, package_id, created_by, expires_at, note)
                VALUES (?, ?, ?, ?, ?)
            `, [code, packageId, createdBy, expiresAt, note]);
            codes.push({ id: result.insertId, code });
        }
        return codes;
    }

    async getByCode(code) {
        const [rows] = await this.db.execute('SELECT * FROM redemption_codes WHERE code = ?', [code]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getAll(options = {}) {
        const { status, packageId, page = 1, pageSize = 50 } = options;
        let query = 'SELECT rc.*, p.name as package_name FROM redemption_codes rc LEFT JOIN packages p ON rc.package_id = p.id';
        const conditions = [];
        const params = [];

        if (status) {
            conditions.push('rc.status = ?');
            params.push(status);
        }
        if (packageId) {
            conditions.push('rc.package_id = ?');
            params.push(packageId);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY rc.created_at DESC';

        const limit = parseInt(pageSize) || 50;
        const offset = ((parseInt(page) || 1) - 1) * limit;
        query += ` LIMIT ${limit} OFFSET ${offset}`;

        const [rows] = await this.db.execute(query, params);

        // 获取总数
        let countQuery = 'SELECT COUNT(*) as total FROM redemption_codes rc';
        if (conditions.length > 0) {
            countQuery += ' WHERE ' + conditions.join(' AND ');
        }
        const [countRows] = await this.db.execute(countQuery, params);

        return {
            items: rows.map(row => this._mapRow(row)),
            total: countRows[0].total,
            page: parseInt(page),
            pageSize: limit
        };
    }

    async redeem(code, apiKeyId, ip) {
        const redemption = await this.getByCode(code);
        if (!redemption) return { success: false, error: '兑换码不存在' };
        if (redemption.status !== 'unused') return { success: false, error: '兑换码已被使用或已失效' };
        if (redemption.expiresAt && new Date(redemption.expiresAt) < new Date()) {
            await this.db.execute('UPDATE redemption_codes SET status = "expired" WHERE id = ?', [redemption.id]);
            return { success: false, error: '兑换码已过期' };
        }

        await this.db.execute(`
            UPDATE redemption_codes SET status = 'used', redeemed_by_key_id = ?, redeemed_at = NOW(), redeemed_ip = ?
            WHERE id = ?
        `, [apiKeyId, ip, redemption.id]);

        return { success: true, redemption };
    }

    async disable(id) {
        await this.db.execute('UPDATE redemption_codes SET status = "disabled" WHERE id = ?', [id]);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM redemption_codes WHERE id = ?', [id]);
    }

    async getStats() {
        const [rows] = await this.db.execute(`
            SELECT status, COUNT(*) as count FROM redemption_codes GROUP BY status
        `);
        const stats = { unused: 0, used: 0, expired: 0, disabled: 0, total: 0 };
        rows.forEach(row => {
            stats[row.status] = row.count;
            stats.total += row.count;
        });
        return stats;
    }

    _generateCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 16; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
            if (i === 3 || i === 7 || i === 11) code += '-';
        }
        return code;
    }

    _mapRow(row) {
        return {
            id: row.id,
            code: row.code,
            packageId: row.package_id,
            packageName: row.package_name || null,
            status: row.status,
            redeemedByKeyId: row.redeemed_by_key_id,
            redeemedAt: row.redeemed_at,
            redeemedIp: row.redeemed_ip,
            note: row.note,
            createdBy: row.created_by,
            createdAt: row.created_at,
            expiresAt: row.expires_at
        };
    }
}

/**
 * 通道配置管理类
 */
export class ChannelStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        const store = new ChannelStore(database);
        await store._ensureTables();
        return store;
    }

    async _ensureTables() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS channels (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL UNIQUE COMMENT '通道标识，对应 api_logs.channel',
                display_name VARCHAR(100) COMMENT '显示名称',
                api_path VARCHAR(255) COMMENT 'API 路径',
                description TEXT COMMENT '通道说明',
                is_active TINYINT(1) DEFAULT 1,
                sort_order INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS channel_models (
                id INT PRIMARY KEY AUTO_INCREMENT,
                channel_id INT NOT NULL,
                model_name VARCHAR(255) NOT NULL COMMENT '模型名称',
                input_price DECIMAL(10,4) DEFAULT 0 COMMENT '输入价格($/百万tokens)',
                output_price DECIMAL(10,4) DEFAULT 0 COMMENT '输出价格($/百万tokens)',
                is_active TINYINT(1) DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_channel_id (channel_id),
                UNIQUE KEY uk_channel_model (channel_id, model_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 兼容：如果表已存在但缺少某些列，尝试补上
        const addColSafe = async (table, col, def) => {
            try { await this.db.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch(e) { /* already exists */ }
        };
        await addColSafe('channels', 'sort_order', 'INT DEFAULT 0 AFTER is_active');
        await addColSafe('channels', 'display_name', "VARCHAR(100) COMMENT '显示名称' AFTER name");
        await addColSafe('channels', 'api_path', "VARCHAR(255) COMMENT 'API 路径' AFTER display_name");
        await addColSafe('channels', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');

        // 如果表为空，初始化预设通道
        const [countRows] = await this.db.execute('SELECT COUNT(*) as cnt FROM channels');
        if (countRows[0].cnt === 0) {
            const defaults = [
                ['kiro', 'Claude 格式', '/v1/messages', 'Claude 原生格式接口', 1, 1],
                ['openai', 'OpenAI 格式', '/v1/chat/completions', 'OpenAI 兼容格式接口', 1, 2],
                ['antigravity', 'Gemini 格式', '/gemini-antigravity/v1/messages', 'Gemini Antigravity 接口', 1, 3],
                ['orchids', 'Orchids 格式', '/orchids/v1/messages', 'Orchids 通道接口', 1, 4],
                ['Warp', 'Warp 格式', '/w/v1/messages', 'Warp 通道接口', 1, 5],
                ['Vertex', 'Vertex 格式', '/vertex/v1/messages', 'Vertex AI 接口', 1, 6],
                ['Bedrock', 'Bedrock 格式', '/bedrock/v1/messages', 'Amazon Bedrock 接口', 1, 7],
                ['AMI', 'AMI 格式', '/am/v1/messages', 'AMI 通道接口', 1, 8],
                ['Flow', 'Flow 格式', '/flow/v1/chat/completions', 'Flow 通道接口', 1, 9],
                ['DO', 'DO 格式', '/do/v1/chat/completions', 'DigitalOcean 接口', 1, 10],
                ['codex', 'Codex 格式', '/codex/v1/chat/completions', 'Codex 通道接口', 1, 11]
            ];
            for (const [name, displayName, apiPath, description, isActive, sortOrder] of defaults) {
                try {
                    await this.db.execute(
                        'INSERT INTO channels (name, display_name, api_path, description, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
                        [name, displayName, apiPath, description, isActive, sortOrder]
                    );
                } catch(e) { /* duplicate, skip */ }
            }
        }
    }

    async getAll() {
        const [rows] = await this.db.execute(
            'SELECT * FROM channels ORDER BY sort_order ASC, id ASC'
        );
        return rows.map(r => this._mapChannel(r));
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM channels WHERE id = ?', [id]);
        return rows.length ? this._mapChannel(rows[0]) : null;
    }

    async add(data) {
        const [result] = await this.db.execute(
            'INSERT INTO channels (name, display_name, api_path, description, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
            [data.name, data.displayName || null, data.apiPath || null, data.description || null, data.isActive !== false ? 1 : 0, data.sortOrder || 0]
        );
        return result.insertId;
    }

    async update(id, data) {
        const fields = [];
        const params = [];
        if (data.name !== undefined) { fields.push('name = ?'); params.push(data.name); }
        if (data.displayName !== undefined) { fields.push('display_name = ?'); params.push(data.displayName); }
        if (data.apiPath !== undefined) { fields.push('api_path = ?'); params.push(data.apiPath); }
        if (data.description !== undefined) { fields.push('description = ?'); params.push(data.description); }
        if (data.isActive !== undefined) { fields.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
        if (data.sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(data.sortOrder); }
        if (fields.length === 0) return;
        params.push(id);
        await this.db.execute(`UPDATE channels SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM channel_models WHERE channel_id = ?', [id]);
        await this.db.execute('DELETE FROM channels WHERE id = ?', [id]);
    }

    // ---- Models ----

    async getModels(channelId) {
        const [rows] = await this.db.execute(
            'SELECT * FROM channel_models WHERE channel_id = ? ORDER BY model_name ASC',
            [channelId]
        );
        return rows.map(r => this._mapModel(r));
    }

    async getAllWithModels() {
        const channels = await this.getAll();
        const [models] = await this.db.execute('SELECT * FROM channel_models ORDER BY model_name ASC');
        const modelMap = {};
        for (const m of models) {
            if (!modelMap[m.channel_id]) modelMap[m.channel_id] = [];
            modelMap[m.channel_id].push(this._mapModel(m));
        }
        return channels.map(ch => ({ ...ch, models: modelMap[ch.id] || [] }));
    }

    async addModel(channelId, data) {
        const [result] = await this.db.execute(
            'INSERT INTO channel_models (channel_id, model_name, input_price, output_price, is_active) VALUES (?, ?, ?, ?, ?)',
            [channelId, data.modelName, data.inputPrice || 0, data.outputPrice || 0, data.isActive !== false ? 1 : 0]
        );
        return result.insertId;
    }

    async updateModel(modelId, data) {
        const fields = [];
        const params = [];
        if (data.modelName !== undefined) { fields.push('model_name = ?'); params.push(data.modelName); }
        if (data.inputPrice !== undefined) { fields.push('input_price = ?'); params.push(data.inputPrice); }
        if (data.outputPrice !== undefined) { fields.push('output_price = ?'); params.push(data.outputPrice); }
        if (data.isActive !== undefined) { fields.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
        if (fields.length === 0) return;
        params.push(modelId);
        await this.db.execute(`UPDATE channel_models SET ${fields.join(', ')} WHERE id = ?`, params);
    }

    async deleteModel(modelId) {
        await this.db.execute('DELETE FROM channel_models WHERE id = ?', [modelId]);
    }

    _mapChannel(r) {
        return {
            id: r.id,
            name: r.name,
            displayName: r.display_name,
            apiPath: r.api_path,
            description: r.description,
            isActive: !!r.is_active,
            sortOrder: r.sort_order || 0,
            createdAt: r.created_at,
            updatedAt: r.updated_at
        };
    }

    _mapModel(r) {
        return {
            id: r.id,
            channelId: r.channel_id,
            modelName: r.model_name,
            inputPrice: parseFloat(r.input_price) || 0,
            outputPrice: parseFloat(r.output_price) || 0,
            isActive: !!r.is_active,
            createdAt: r.created_at
        };
    }
}

/**
 * Grok 凭证管理类（SSO Token 池）
 */
export class GrokCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new GrokCredentialStore(database);
    }

    async add(credential) {
        const crypto = await import('crypto');
        const cleanToken = credential.token.startsWith('sso=') ? credential.token.substring(4) : credential.token;
        const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
        const defaultQuota = credential.pool === 'ssoSuper' ? 140 : 80;

        const [result] = await this.db.execute(`
            INSERT INTO grok_credentials (token, token_hash, pool, status, quota, note)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            cleanToken,
            tokenHash,
            credential.pool || 'ssoBasic',
            credential.status || 'active',
            credential.quota !== undefined ? credential.quota : defaultQuota,
            credential.note || ''
        ]);
        return result.insertId;
    }

    async delete(tokenOrId) {
        // 支持按 token 字符串或 ID 删除
        if (typeof tokenOrId === 'number') {
            await this.db.execute('DELETE FROM grok_credentials WHERE id = ?', [tokenOrId]);
        } else {
            const cleanToken = tokenOrId.startsWith('sso=') ? tokenOrId.substring(4) : tokenOrId;
            const crypto = await import('crypto');
            const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');
            await this.db.execute('DELETE FROM grok_credentials WHERE token_hash = ?', [tokenHash]);
        }
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM grok_credentials ORDER BY pool ASC, quota DESC');
        return rows.map(row => this._mapRow(row));
    }

    async getByPool(poolName) {
        const [rows] = await this.db.execute('SELECT * FROM grok_credentials WHERE pool = ? ORDER BY quota DESC', [poolName]);
        return rows.map(row => this._mapRow(row));
    }

    async getActive() {
        const [rows] = await this.db.execute(
            "SELECT * FROM grok_credentials WHERE status = 'active' AND quota > 0 ORDER BY quota DESC"
        );
        return rows.map(row => this._mapRow(row));
    }

    async updateTokenState(tokenStr, state) {
        const cleanToken = tokenStr.startsWith('sso=') ? tokenStr.substring(4) : tokenStr;
        const crypto = await import('crypto');
        const tokenHash = crypto.createHash('sha256').update(cleanToken).digest('hex');

        const fields = [];
        const values = [];

        if (state.status !== undefined) { fields.push('status = ?'); values.push(state.status); }
        if (state.quota !== undefined) { fields.push('quota = ?'); values.push(state.quota); }
        if (state.useCount !== undefined) { fields.push('use_count = ?'); values.push(state.useCount); }
        if (state.failCount !== undefined) { fields.push('fail_count = ?'); values.push(state.failCount); }
        if (state.lastUsedAt !== undefined) {
            fields.push('last_used_at = ?');
            values.push(state.lastUsedAt ? new Date(state.lastUsedAt) : null);
        }

        if (fields.length === 0) return;

        values.push(tokenHash);
        await this.db.execute(`UPDATE grok_credentials SET ${fields.join(', ')} WHERE token_hash = ?`, values);
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM grok_credentials');
        const [active] = await this.db.execute("SELECT COUNT(*) as count FROM grok_credentials WHERE status = 'active' AND quota > 0");
        const [cooling] = await this.db.execute("SELECT COUNT(*) as count FROM grok_credentials WHERE status = 'cooling'");
        const [expired] = await this.db.execute("SELECT COUNT(*) as count FROM grok_credentials WHERE status = 'expired'");
        const [totalQuota] = await this.db.execute('SELECT SUM(quota) as total FROM grok_credentials');
        const [totalUse] = await this.db.execute('SELECT SUM(use_count) as total FROM grok_credentials');

        return {
            total: total[0].count,
            active: active[0].count,
            cooling: cooling[0].count,
            expired: expired[0].count,
            totalQuota: totalQuota[0].total || 0,
            totalUseCount: totalUse[0].total || 0,
        };
    }

    async resetAllQuotas() {
        await this.db.execute(`
            UPDATE grok_credentials SET
                quota = CASE WHEN pool = 'ssoSuper' THEN 140 ELSE 80 END,
                status = 'active',
                fail_count = 0
            WHERE status IN ('cooling', 'active')
        `);
    }

    _mapRow(row) {
        return {
            id: row.id,
            token: row.token,
            pool: row.pool,
            status: row.status,
            quota: row.quota,
            useCount: row.use_count || 0,
            failCount: row.fail_count || 0,
            lastUsedAt: row.last_used_at,
            lastFailAt: row.last_fail_at,
            note: row.note || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

/**
 * Krater 凭证管理类
 */
export class KraterCredentialStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        return new KraterCredentialStore(database);
    }

    async add(credential) {
        const crypto = await import('crypto');
        const keyHash = crypto.createHash('sha256').update(credential.apiKey).digest('hex');

        const [result] = await this.db.execute(`
            INSERT INTO krater_credentials (api_key, key_hash, status, note)
            VALUES (?, ?, ?, ?)
        `, [
            credential.apiKey,
            keyHash,
            credential.status || 'active',
            credential.note || ''
        ]);
        return result.insertId;
    }

    async delete(idOrKey) {
        if (typeof idOrKey === 'number') {
            await this.db.execute('DELETE FROM krater_credentials WHERE id = ?', [idOrKey]);
        } else {
            const crypto = await import('crypto');
            const keyHash = crypto.createHash('sha256').update(idOrKey).digest('hex');
            await this.db.execute('DELETE FROM krater_credentials WHERE key_hash = ?', [keyHash]);
        }
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM krater_credentials ORDER BY status ASC, use_count ASC');
        return rows.map(row => this._mapRow(row));
    }

    async getActive() {
        const [rows] = await this.db.execute(
            "SELECT * FROM krater_credentials WHERE status = 'active' ORDER BY use_count ASC, last_used_at ASC"
        );
        return rows.map(row => this._mapRow(row));
    }

    async updateKeyState(apiKey, state) {
        const crypto = await import('crypto');
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

        const fields = [];
        const values = [];

        if (state.status !== undefined) { fields.push('status = ?'); values.push(state.status); }
        if (state.useCount !== undefined) { fields.push('use_count = ?'); values.push(state.useCount); }
        if (state.failCount !== undefined) { fields.push('fail_count = ?'); values.push(state.failCount); }
        if (state.lastUsedAt !== undefined) {
            fields.push('last_used_at = ?');
            values.push(state.lastUsedAt ? new Date(state.lastUsedAt) : null);
        }
        if (state.lastFailAt !== undefined) {
            fields.push('last_fail_at = ?');
            values.push(state.lastFailAt ? new Date(state.lastFailAt) : null);
        }

        if (fields.length === 0) return;

        values.push(keyHash);
        await this.db.execute(`UPDATE krater_credentials SET ${fields.join(', ')} WHERE key_hash = ?`, values);
    }

    async incrementUseCount(apiKey) {
        const crypto = await import('crypto');
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        await this.db.execute(
            'UPDATE krater_credentials SET use_count = use_count + 1, last_used_at = NOW(), fail_count = 0 WHERE key_hash = ?',
            [keyHash]
        );
    }

    async recordFail(apiKey) {
        const crypto = await import('crypto');
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        await this.db.execute(
            'UPDATE krater_credentials SET fail_count = fail_count + 1, last_fail_at = NOW() WHERE key_hash = ?',
            [keyHash]
        );
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM krater_credentials');
        const [active] = await this.db.execute("SELECT COUNT(*) as count FROM krater_credentials WHERE status = 'active'");
        const [disabled] = await this.db.execute("SELECT COUNT(*) as count FROM krater_credentials WHERE status = 'disabled'");
        const [expired] = await this.db.execute("SELECT COUNT(*) as count FROM krater_credentials WHERE status = 'expired'");
        const [totalUse] = await this.db.execute('SELECT SUM(use_count) as total FROM krater_credentials');

        return {
            total: total[0].count,
            active: active[0].count,
            disabled: disabled[0].count,
            expired: expired[0].count,
            totalUseCount: totalUse[0].total || 0,
        };
    }

    _mapRow(row) {
        return {
            id: row.id,
            apiKey: row.api_key,
            status: row.status,
            useCount: row.use_count || 0,
            failCount: row.fail_count || 0,
            lastUsedAt: row.last_used_at,
            lastFailAt: row.last_fail_at,
            note: row.note || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}


// ============== Direct 转发通道 ==============
export class DirectChannelStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        const store = new DirectChannelStore(database);
        await store._ensureTable();
        return store;
    }

    async _ensureTable() {
        await this.db.execute(`
            CREATE TABLE IF NOT EXISTS direct_channels (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL COMMENT '通道名称',
                upstream_url VARCHAR(500) NOT NULL COMMENT '上游 API 地址',
                api_key VARCHAR(500) NOT NULL COMMENT '上游 API Key',
                status VARCHAR(20) DEFAULT 'active' COMMENT '状态: active / disabled',
                use_count INT DEFAULT 0 COMMENT '使用次数',
                fail_count INT DEFAULT 0 COMMENT '连续失败次数',
                last_used_at DATETIME COMMENT '最后使用时间',
                last_fail_at DATETIME COMMENT '最后失败时间',
                note VARCHAR(255) DEFAULT '' COMMENT '备注',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    }

    async add(channel) {
        const [result] = await this.db.execute(
            'INSERT INTO direct_channels (name, upstream_url, api_key, status, note) VALUES (?, ?, ?, ?, ?)',
            [channel.name, channel.upstreamUrl, channel.apiKey, channel.status || 'active', channel.note || '']
        );
        return result.insertId;
    }

    async update(id, channel) {
        const fields = [];
        const values = [];
        if (channel.name !== undefined) { fields.push('name = ?'); values.push(channel.name); }
        if (channel.upstreamUrl !== undefined) { fields.push('upstream_url = ?'); values.push(channel.upstreamUrl); }
        if (channel.apiKey !== undefined) { fields.push('api_key = ?'); values.push(channel.apiKey); }
        if (channel.status !== undefined) { fields.push('status = ?'); values.push(channel.status); }
        if (channel.note !== undefined) { fields.push('note = ?'); values.push(channel.note); }
        if (fields.length === 0) return;
        values.push(id);
        await this.db.execute(`UPDATE direct_channels SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM direct_channels WHERE id = ?', [id]);
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM direct_channels WHERE id = ?', [id]);
        return rows.length ? this._mapRow(rows[0]) : null;
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM direct_channels ORDER BY status ASC, id ASC');
        return rows.map(r => this._mapRow(r));
    }

    async getActive() {
        const [rows] = await this.db.execute(
            "SELECT * FROM direct_channels WHERE status = 'active' ORDER BY use_count ASC, last_used_at ASC"
        );
        return rows.map(r => this._mapRow(r));
    }

    async incrementUseCount(id) {
        await this.db.execute(
            'UPDATE direct_channels SET use_count = use_count + 1, last_used_at = NOW(), fail_count = 0 WHERE id = ?', [id]
        );
    }

    async recordFail(id) {
        await this.db.execute(
            'UPDATE direct_channels SET fail_count = fail_count + 1, last_fail_at = NOW() WHERE id = ?', [id]
        );
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM direct_channels');
        const [active] = await this.db.execute("SELECT COUNT(*) as count FROM direct_channels WHERE status = 'active'");
        return { total: total[0].count, active: active[0].count };
    }

    _mapRow(row) {
        return {
            id: row.id,
            name: row.name,
            upstreamUrl: row.upstream_url,
            apiKey: row.api_key,
            status: row.status,
            useCount: row.use_count || 0,
            failCount: row.fail_count || 0,
            lastUsedAt: row.last_used_at,
            lastFailAt: row.last_fail_at,
            note: row.note || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

/**
 * Outlook 邮箱账号管理类
 */
export class OutlookAccountStore {
    constructor(database) {
        this.db = database;
    }

    static async create() {
        const database = await getDatabase();
        await database.execute(`
            CREATE TABLE IF NOT EXISTS outlook_accounts (
                id INT PRIMARY KEY AUTO_INCREMENT,
                email VARCHAR(255) NOT NULL,
                password VARCHAR(255) DEFAULT NULL,
                client_id VARCHAR(128) DEFAULT NULL,
                refresh_token TEXT DEFAULT NULL,
                status ENUM('active','disabled','expired') DEFAULT 'active',
                note VARCHAR(512) DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        return new OutlookAccountStore(database);
    }

    async getAll() {
        const [rows] = await this.db.execute('SELECT * FROM outlook_accounts ORDER BY created_at DESC');
        return rows.map(r => this._mapRow(r));
    }

    async getById(id) {
        const [rows] = await this.db.execute('SELECT * FROM outlook_accounts WHERE id = ?', [id]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async getByEmail(email) {
        const [rows] = await this.db.execute('SELECT * FROM outlook_accounts WHERE email = ?', [email]);
        if (rows.length === 0) return null;
        return this._mapRow(rows[0]);
    }

    async create(account) {
        const [result] = await this.db.execute(`
            INSERT INTO outlook_accounts (email, password, client_id, refresh_token, status, note)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            account.email,
            account.password || null,
            account.clientId || null,
            account.refreshToken || null,
            account.status || 'active',
            account.note || null,
        ]);
        return result.insertId;
    }

    async update(id, data) {
        const fields = [];
        const values = [];
        if (data.email !== undefined) { fields.push('email = ?'); values.push(data.email); }
        if (data.password !== undefined) { fields.push('password = ?'); values.push(data.password); }
        if (data.clientId !== undefined) { fields.push('client_id = ?'); values.push(data.clientId); }
        if (data.refreshToken !== undefined) { fields.push('refresh_token = ?'); values.push(data.refreshToken); }
        if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status); }
        if (data.note !== undefined) { fields.push('note = ?'); values.push(data.note); }
        if (fields.length === 0) return;
        values.push(id);
        await this.db.execute(`UPDATE outlook_accounts SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    async delete(id) {
        await this.db.execute('DELETE FROM outlook_accounts WHERE id = ?', [id]);
    }

    async batchCreate(accounts) {
        const results = [];
        for (const account of accounts) {
            try {
                const existing = await this.getByEmail(account.email);
                if (existing) {
                    await this.update(existing.id, account);
                    results.push({ email: account.email, success: true, id: existing.id, action: 'updated' });
                } else {
                    const id = await this.create(account);
                    results.push({ email: account.email, success: true, id, action: 'created' });
                }
            } catch (e) {
                results.push({ email: account.email, success: false, error: e.message });
            }
        }
        return results;
    }

    async getStatistics() {
        const [total] = await this.db.execute('SELECT COUNT(*) as count FROM outlook_accounts');
        const [active] = await this.db.execute("SELECT COUNT(*) as count FROM outlook_accounts WHERE status = 'active'");
        const [disabled] = await this.db.execute("SELECT COUNT(*) as count FROM outlook_accounts WHERE status = 'disabled'");
        const [expired] = await this.db.execute("SELECT COUNT(*) as count FROM outlook_accounts WHERE status = 'expired'");
        return {
            total: total[0].count,
            active: active[0].count,
            disabled: disabled[0].count,
            expired: expired[0].count,
        };
    }

    _mapRow(row) {
        return {
            id: row.id,
            email: row.email,
            password: row.password,
            clientId: row.client_id,
            refreshToken: row.refresh_token,
            status: row.status,
            note: row.note || '',
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
