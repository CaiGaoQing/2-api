/**
 * 统一日志模块
 * 支持按模块写入不同的日志文件
 */
import fs from 'fs';
import path from 'path';

// 日志目录
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 获取当前时间戳字符串
 */
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * 获取当前日期字符串 (用于日志文件名)
 */
function getDateStr() {
    return new Date().toISOString().substring(0, 10);
}

/**
 * 日志级别
 */
const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

/**
 * 当前日志级别（可通过环境变量配置）
 */
let currentLevel = LogLevel.INFO;
if (process.env.LOG_LEVEL) {
    const level = process.env.LOG_LEVEL.toUpperCase();
    if (LogLevel[level] !== undefined) {
        currentLevel = LogLevel[level];
    }
}

/**
 * 是否启用日志（可通过环境变量禁用）
 */
const enabled = process.env.LOG_ENABLED !== 'false';

/**
 * 是否同时输出到控制台
 */
const consoleOutput = process.env.LOG_CONSOLE !== 'false';

/**
 * 写入流缓存
 */
const streams = new Map();

/**
 * 获取或创建写入流
 * @param {string} module - 模块名称
 * @returns {fs.WriteStream}
 */
function getStream(module) {
    const dateStr = getDateStr();
    const key = `${module}-${dateStr}`;

    if (streams.has(key)) {
        return streams.get(key);
    }

    // 关闭旧的流（不同日期的）
    for (const [k, stream] of streams) {
        if (k.startsWith(`${module}-`) && k !== key) {
            stream.end();
            streams.delete(k);
        }
    }

    const filePath = path.join(LOG_DIR, `${module}-${dateStr}.log`);
    const stream = fs.createWriteStream(filePath, { flags: 'a' });
    streams.set(key, stream);

    return stream;
}

/**
 * 写入日志到文件
 * @param {string} module - 模块名称
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 */
function writeToFile(module, level, message) {
    const stream = getStream(module);
    const line = `[${getTimestamp()}] [${level}] ${message}\n`;
    stream.write(line);
}

/**
 * 格式化参数为字符串
 */
function formatArgs(args) {
    return args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg);
            } catch {
                return String(arg);
            }
        }
        return String(arg);
    }).join(' ');
}

/**
 * 创建模块日志器
 * @param {string} module - 模块名称
 * @returns {Object} 日志器对象
 */
export function createLogger(module) {
    const prefix = `[${module}]`;

    return {
        debug(...args) {
            if (enabled && currentLevel <= LogLevel.DEBUG) {
                const message = formatArgs(args);
                writeToFile(module, 'DEBUG', message);
            }
        },

        info(...args) {
            if (enabled && currentLevel <= LogLevel.INFO) {
                const message = formatArgs(args);
                writeToFile(module, 'INFO', message);
            }
        },

        warn(...args) {
            if (enabled && currentLevel <= LogLevel.WARN) {
                const message = formatArgs(args);
                writeToFile(module, 'WARN', message);
            }
        },

        error(...args) {
            if (enabled && currentLevel <= LogLevel.ERROR) {
                const message = formatArgs(args);
                writeToFile(module, 'ERROR', message);
                if (consoleOutput) {
                    console.error(`[${getTimestamp()}] ${prefix} [ERROR]`, ...args);
                }
            }
        },

        /**
         * 记录 HTTP 请求
         */
        request(method, url) {
            this.info(`请求: ${method} ${url}`);
        },

        /**
         * 记录成功
         */
        success(message) {
            this.info(`✓ ${message}`);
        },

        /**
         * 记录失败
         */
        fail(message, statusCode) {
            if (statusCode) {
                this.error(`✗ ${message} (HTTP ${statusCode})`);
            } else {
                this.error(`✗ ${message}`);
            }
        },

        /**
         * 打印 curl 命令
         */
        curl(method, url, headers, data) {
            const curlCmd = buildCurlCommand(method, url, headers, data);
            this.info(`CURL:\n${curlCmd}`);
        }
    };
}

/**
 * 构建 curl 命令字符串
 * @param {string} method - HTTP 方法
 * @param {string} url - 请求 URL
 * @param {Object} headers - 请求头
 * @param {Object|string} data - 请求体
 * @returns {string} curl 命令
 */
function buildCurlCommand(method, url, headers, data) {
    const parts = ['curl'];

    // 添加方法
    if (method && method.toUpperCase() !== 'GET') {
        parts.push(`-X ${method.toUpperCase()}`);
    }

    // 添加 URL
    parts.push(`'${url}'`);

    // 添加请求头（不脱敏，完整输出）
    if (headers) {
        for (const [key, value] of Object.entries(headers)) {
            parts.push(`-H '${key}: ${value}'`);
        }
    }

    // 添加请求体（完整输出，不截断）
    if (data) {
        let bodyStr;
        if (typeof data === 'string') {
            bodyStr = data;
        } else {
            bodyStr = JSON.stringify(data);
        }
        // 转义单引号
        bodyStr = bodyStr.replace(/'/g, "'\\''");
        parts.push(`-d '${bodyStr}'`);
    }

    return parts.join(' \\\n  ');
}

/**
 * 预定义的模块日志器
 * 每个模块写入独立的日志文件:
 * - logs/api-YYYY-MM-DD.log
 * - logs/client-YYYY-MM-DD.log
 * - logs/auth-YYYY-MM-DD.log
 * - logs/db-YYYY-MM-DD.log
 * - logs/server-YYYY-MM-DD.log
 * - logs/token-YYYY-MM-DD.log
 */
export const logger = {
    api: createLogger('api'),
    client: createLogger('client'),
    auth: createLogger('auth'),
    db: createLogger('db'),
    server: createLogger('server'),
    token: createLogger('token')
};

/**
 * 设置日志级别
 * @param {string} level - 日志级别 (DEBUG/INFO/WARN/ERROR)
 */
export function setLogLevel(level) {
    const upperLevel = level.toUpperCase();
    if (LogLevel[upperLevel] !== undefined) {
        currentLevel = LogLevel[upperLevel];
    }
}

/**
 * 关闭所有日志流
 */
export function closeAllStreams() {
    for (const [, stream] of streams) {
        stream.end();
    }
    streams.clear();
}

/**
 * 获取时间戳（供外部使用）
 */
export { getTimestamp };

export default logger;
