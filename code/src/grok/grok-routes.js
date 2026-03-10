/**
 * Grok Routes - Express 路由
 * 提供 OpenAI 兼容的 /grok/v1/chat/completions 接口
 * 
 * 集成模式与 Flow、DigitalOcean 等 provider 一致：
 * - 独立路由前缀 /grok/
 * - API Key 验证
 * - 日志记录
 * - 流式/非流式支持
 * - Token 池自动轮换
 */

import {
    GrokService,
    GrokTokenManager,
    GROK_MODELS,
    GROK_MODELS_INFO,
    getGrokModelInfo,
    isValidGrokModel,
} from './grok-service.js';
import { generateImage, sizeToAspectRatio } from './grok-imagine.js';

// 获取时间戳
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// 禁用 SSE 压缩
function disableCompressionForSSE(res) {
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.removeHeader('Content-Encoding');
}

// 获取客户端 IP
function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return forwarded.split(',')[0].trim();
    return req.headers['x-real-ip'] || req.ip || req.socket?.remoteAddress || 'unknown';
}

// 解析 API Key
function parseApiKey(headers) {
    const auth = headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) {
        return auth.substring(7).trim();
    }
    return headers['x-api-key'] || null;
}

/**
 * 设置 Grok 路由
 * @param {Express} app - Express 实例
 * @param {Function} verifyApiKey - API Key 验证函数
 * @param {Object} apiLogStore - 日志存储
 * @param {Object} grokCredentialStore - Grok 凭据存储
 */
export function setupGrokRoutes(app, authMiddleware, verifyApiKey, apiLogStore, grokCredentialStore) {

    // 全局 GrokService 实例（配置从环境变量读取）
    const grokConfig = {
        userAgent: process.env.GROK_USER_AGENT || undefined,
        browser: process.env.GROK_BROWSER || undefined,
        cfClearance: process.env.GROK_CF_CLEARANCE || '',
        baseProxyUrl: process.env.GROK_PROXY_URL || '',
        timeout: parseInt(process.env.GROK_TIMEOUT || '120000'),
        streamTimeout: parseInt(process.env.GROK_STREAM_TIMEOUT || '60000'),
        temporary: process.env.GROK_TEMPORARY !== 'false',
        disableMemory: process.env.GROK_DISABLE_MEMORY !== 'false',
        thinking: process.env.GROK_THINKING !== 'false',
    };
    const grokService = new GrokService(grokConfig);

    // Token 管理器
    const tokenManager = new GrokTokenManager();

    // 启动时从数据库加载 tokens
    let tokensLoaded = false;
    async function ensureTokensLoaded() {
        if (tokensLoaded) return;
        try {
            const tokens = await grokCredentialStore.getAll();
            tokenManager.loadTokens(tokens);
            tokensLoaded = true;
            console.log(`[${getTimestamp()}] [Grok] 加载了 ${tokens.length} 个 Token`);
        } catch (e) {
            console.error(`[${getTimestamp()}] [Grok] 加载 Token 失败: ${e.message}`);
        }
    }

    // 每 5 分钟重新加载 tokens
    setInterval(async () => {
        try {
            const tokens = await grokCredentialStore.getAll();
            tokenManager.loadTokens(tokens);
        } catch (e) {
            console.error(`[${getTimestamp()}] [Grok] 刷新 Token 失败: ${e.message}`);
        }
    }, 5 * 60 * 1000);

    // 保存 token 状态到数据库
    async function persistTokenState(tokenStr) {
        try {
            const snapshot = tokenManager.snapshot();
            const t = snapshot.find(s => s.token === tokenStr);
            if (t) {
                await grokCredentialStore.updateTokenState(tokenStr, {
                    status: t.status,
                    quota: t.quota,
                    useCount: t.useCount,
                    failCount: t.failCount,
                    lastUsedAt: t.lastUsedAt,
                });
            }
        } catch (e) {
            // 静默失败，不影响主流程
        }
    }

    // ============ 模型列表 ============
    app.get('/grok/v1/models', async (req, res) => {
        const models = GROK_MODELS_INFO.map(m => ({
            id: m.modelId,
            object: 'model',
            created: 1700000000,
            owned_by: 'xai',
            permission: [],
            root: m.modelId,
            parent: null,
        }));
        res.json({ object: 'list', data: models });
    });

    // ============ Chat Completions ============
    app.post('/grok/v1/chat/completions', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'grok_' + Date.now() + Math.random().toString(36).substring(2, 8);
        const clientIp = getClientIp(req);

        let logData = {
            requestId,
            ipAddress: clientIp,
            userAgent: req.headers['user-agent'] || '',
            method: 'POST',
            path: '/grok/v1/chat/completions',
            channel: 'Grok',
            stream: false,
            inputTokens: 0,
            outputTokens: 0,
            statusCode: 200,
        };

        try {
            // API Key 验证
            const apiKey = parseApiKey(req.headers);
            if (apiKey && verifyApiKey) {
                const keyRecord = await verifyApiKey(apiKey);
                if (keyRecord) {
                    logData.apiKeyId = keyRecord.id;
                    logData.apiKeyPrefix = keyRecord.keyPrefix;
                }
            }

            // 确保 tokens 已加载
            await ensureTokensLoaded();

            const { model, messages, stream = false, temperature, top_p, reasoning_effort } = req.body;

            if (!model || !messages || !messages.length) {
                logData.statusCode = 400;
                logData.errorMessage = 'Missing required fields';
                if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                return res.status(400).json({
                    error: { message: 'Missing required fields: model, messages', type: 'invalid_request_error' }
                });
            }

            if (!isValidGrokModel(model)) {
                logData.statusCode = 400;
                logData.errorMessage = `Invalid model: ${model}`;
                if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                return res.status(400).json({
                    error: { message: `The model '${model}' does not exist. Available models: ${GROK_MODELS.join(', ')}`, type: 'invalid_request_error' }
                });
            }

            logData.model = model;
            logData.stream = !!stream;
            logData.inputTokens = Math.ceil(JSON.stringify(messages).length / 4);

            // Token 选择与重试
            const maxRetries = 3;
            const triedTokens = new Set();
            let lastError = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const ssoToken = tokenManager.getTokenForModel(model, triedTokens);
                if (!ssoToken) {
                    if (lastError) break;
                    logData.statusCode = 429;
                    logData.errorMessage = 'No available Grok tokens';
                    if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                    return res.status(429).json({
                        error: { message: 'No available Grok tokens. Please try again later.', type: 'rate_limit_error' }
                    });
                }

                triedTokens.add(ssoToken);

                try {
                    const options = {
                        temperature: temperature !== undefined ? temperature : 0.8,
                        topP: top_p !== undefined ? top_p : 0.95,
                        reasoningEffort: reasoning_effort || undefined,
                    };

                    if (stream) {
                        // 流式响应
                        res.setHeader('Content-Type', 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache');
                        res.setHeader('Connection', 'keep-alive');
                        disableCompressionForSSE(res);

                        let outputTokens = 0;

                        try {
                            for await (const chunk of grokService.chatCompletionsStream(ssoToken, model, messages, options)) {
                                res.write(chunk);
                                // 估算输出 tokens
                                if (chunk.startsWith('data: ') && chunk.includes('"content"')) {
                                    outputTokens += Math.ceil(chunk.length / 16);
                                }
                            }
                        } catch (streamError) {
                            console.error(`[${getTimestamp()}] [Grok] 流式错误: ${streamError.message}`);
                            // 如果还没发送数据，可以返回错误
                            if (!res.headersSent) {
                                throw streamError;
                            }
                            // 已发送的流，尝试发送错误
                            res.write(`data: ${JSON.stringify({ error: { message: streamError.message } })}\n\n`);
                        }

                        res.end();

                        // 记录使用
                        tokenManager.consume(ssoToken, model);
                        persistTokenState(ssoToken);

                        logData.outputTokens = outputTokens;
                        if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                        return;

                    } else {
                        // 非流式响应
                        const result = await grokService.chatCompletions(ssoToken, model, messages, options);

                        // 记录使用
                        tokenManager.consume(ssoToken, model);
                        persistTokenState(ssoToken);

                        const outputTokens = Math.ceil((result.choices?.[0]?.message?.content || '').length / 4);
                        logData.outputTokens = outputTokens;
                        if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }

                        return res.json(result);
                    }

                } catch (error) {
                    lastError = error;
                    const status = error.status || 500;

                    if (status === 429) {
                        // 限流 - 标记 token 为 cooling，换 token 重试
                        tokenManager.markRateLimited(ssoToken);
                        persistTokenState(ssoToken);
                        console.warn(`[${getTimestamp()}] [Grok] Token ${ssoToken.substring(0, 10)}... 被限流，尝试下一个 (${attempt + 1}/${maxRetries})`);
                        continue;
                    } else if (status === 401 || status === 403) {
                        // 认证/权限失败 - 记录失败，换 token 重试
                        tokenManager.recordFail(ssoToken, status);
                        persistTokenState(ssoToken);
                        console.warn(`[${getTimestamp()}] [Grok] Token ${ssoToken.substring(0, 10)}... ${status === 401 ? '认证失败' : '被拒绝(403)'}${error.body ? ': ' + error.body.substring(0, 200) : ''}，尝试下一个 (${attempt + 1}/${maxRetries})`);
                        continue;
                    } else {
                        // 其他错误 - 直接抛出
                        throw error;
                    }
                }
            }

            // 所有 token 都失败
            const errorStatus = lastError?.status || 502;
            const errorMessage = lastError?.message || 'All Grok tokens failed';
            logData.statusCode = errorStatus;
            logData.errorMessage = errorMessage;
            if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }

            return res.status(errorStatus).json({
                error: { message: errorMessage, type: 'upstream_error' }
            });

        } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorStatus = error.status || 500;
            console.error(`[${getTimestamp()}] [Grok] 请求失败: ${error.message}`);

            logData.statusCode = errorStatus;
            logData.errorMessage = error.message;
            if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs }); } catch (e) { /* ignore */ }

            if (!res.headersSent) {
                return res.status(errorStatus).json({
                    error: { message: error.message, type: 'server_error' }
                });
            }
        }
    });

    // ============ 图片生成（grok-imagine-1.0）============
    app.post('/grok/v1/images/generations', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'grok_img_' + Date.now() + Math.random().toString(36).substring(2, 8);
        const clientIp = getClientIp(req);

        let logData = {
            requestId,
            ipAddress: clientIp,
            userAgent: req.headers['user-agent'] || '',
            method: 'POST',
            path: '/grok/v1/images/generations',
            channel: 'Grok',
            stream: false,
            inputTokens: 0,
            outputTokens: 0,
            statusCode: 200,
        };

        try {
            // API Key 验证
            const apiKey = parseApiKey(req.headers);
            if (apiKey && verifyApiKey) {
                const keyRecord = await verifyApiKey(apiKey);
                if (keyRecord) {
                    logData.apiKeyId = keyRecord.id;
                    logData.apiKeyPrefix = keyRecord.keyPrefix;
                }
            }

            await ensureTokensLoaded();

            const { model = 'grok-imagine-1.0', prompt, n = 1, size = '1024x1024' } = req.body;

            if (!prompt) {
                logData.statusCode = 400;
                logData.errorMessage = 'Missing prompt';
                if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                return res.status(400).json({
                    error: { message: 'Missing required field: prompt', type: 'invalid_request_error' }
                });
            }

            logData.model = model;

            const aspectRatio = sizeToAspectRatio(size);
            const maxRetries = 3;
            const triedTokens = new Set();
            let lastError = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const ssoToken = tokenManager.getTokenForModel('grok-3', triedTokens);
                if (!ssoToken) {
                    if (lastError) break;
                    logData.statusCode = 429;
                    logData.errorMessage = 'No available Grok tokens';
                    if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                    return res.status(429).json({
                        error: { message: 'No available Grok tokens. Please try again later.', type: 'rate_limit_error' }
                    });
                }

                triedTokens.add(ssoToken);

                try {
                    const images = await generateImage(ssoToken, prompt, {
                        aspectRatio,
                        n: parseInt(n) || 1,
                        enableNsfw: true,
                        timeout: 60,
                        proxyUrl: grokConfig.baseProxyUrl || '',
                        cfClearance: grokConfig.cfClearance || '',
                        userAgent: grokConfig.userAgent || '',
                        browser: grokConfig.browser || 'chrome136',
                    });

                    tokenManager.consume(ssoToken, 'grok-3');
                    persistTokenState(ssoToken);

                    // 转换为 OpenAI images/generations 格式
                    const data = images.map(img => ({
                        b64_json: img.b64_json || '',
                        revised_prompt: prompt,
                    }));

                    logData.outputTokens = data.length;
                    if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }

                    return res.json({
                        created: Math.floor(Date.now() / 1000),
                        data,
                    });

                } catch (error) {
                    lastError = error;
                    const status = error.status || 500;

                    if (status === 429) {
                        tokenManager.markRateLimited(ssoToken);
                        persistTokenState(ssoToken);
                        console.warn(`[${getTimestamp()}] [Grok] Image Token ${ssoToken.substring(0, 10)}... 被限流，尝试下一个 (${attempt + 1}/${maxRetries})`);
                        continue;
                    } else if (status === 401 || status === 403) {
                        tokenManager.recordFail(ssoToken, status);
                        persistTokenState(ssoToken);
                        console.warn(`[${getTimestamp()}] [Grok] Image Token ${ssoToken.substring(0, 10)}... ${status}，尝试下一个 (${attempt + 1}/${maxRetries})`);
                        continue;
                    } else {
                        throw error;
                    }
                }
            }

            // 所有 token 都失败
            const errorStatus = lastError?.status || 502;
            const errorMessage = lastError?.message || 'All Grok tokens failed';
            logData.statusCode = errorStatus;
            logData.errorMessage = errorMessage;
            if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }

            return res.status(errorStatus).json({
                error: { message: errorMessage, type: 'upstream_error' }
            });

        } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorStatus = error.status || 500;
            console.error(`[${getTimestamp()}] [Grok] 图片生成失败: ${error.message}`);

            logData.statusCode = errorStatus;
            logData.errorMessage = error.message;
            if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs }); } catch (e) { /* ignore */ }

            if (!res.headersSent) {
                return res.status(errorStatus).json({
                    error: { message: error.message, type: 'server_error' }
                });
            }
        }
    });

    // ============ Grok Token 管理 API ============

    // 获取所有 tokens
    app.get('/api/grok/tokens', authMiddleware, async (req, res) => {
        try {
            const tokens = await grokCredentialStore.getAll();
            const stats = tokenManager.getStats();
            res.json({ tokens, stats });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 添加 token
    app.post('/api/grok/tokens', authMiddleware, async (req, res) => {
        try {
            const { token, pool = 'ssoBasic', note = '' } = req.body;
            if (!token) {
                return res.status(400).json({ error: 'Token is required' });
            }

            const cleanToken = token.startsWith('sso=') ? token.substring(4) : token;
            const defaultQuota = pool === 'ssoSuper' ? 140 : 80;

            await grokCredentialStore.add({
                token: cleanToken,
                pool,
                quota: defaultQuota,
                status: 'active',
                note,
            });

            // 重新加载
            tokensLoaded = false;
            await ensureTokensLoaded();

            res.json({ success: true, message: 'Token added' });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 批量添加 tokens
    app.post('/api/grok/tokens/batch', authMiddleware, async (req, res) => {
        try {
            const { tokens, pool = 'ssoBasic' } = req.body;
            if (!tokens || !Array.isArray(tokens)) {
                return res.status(400).json({ error: 'tokens array is required' });
            }

            const defaultQuota = pool === 'ssoSuper' ? 140 : 80;
            let added = 0;
            for (const token of tokens) {
                const cleanToken = (typeof token === 'string' ? token : token.token || '').trim();
                if (!cleanToken) continue;
                const t = cleanToken.startsWith('sso=') ? cleanToken.substring(4) : cleanToken;
                try {
                    await grokCredentialStore.add({
                        token: t,
                        pool: typeof token === 'object' ? (token.pool || pool) : pool,
                        quota: typeof token === 'object' ? (token.quota || defaultQuota) : defaultQuota,
                        status: 'active',
                        note: typeof token === 'object' ? (token.note || '') : '',
                    });
                    added++;
                } catch (e) {
                    // 跳过重复
                }
            }

            tokensLoaded = false;
            await ensureTokensLoaded();

            res.json({ success: true, added, total: tokens.length });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 删除 token
    app.delete('/api/grok/tokens/:token', authMiddleware, async (req, res) => {
        try {
            await grokCredentialStore.delete(req.params.token);
            tokensLoaded = false;
            await ensureTokensLoaded();
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 获取统计
    app.get('/api/grok/stats', authMiddleware, async (req, res) => {
        try {
            await ensureTokensLoaded();
            const stats = tokenManager.getStats();
            res.json(stats);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    console.log(`[${getTimestamp()}] [Grok] 路由已注册:`);
    console.log(`[${getTimestamp()}] [Grok]   Chat:   /grok/v1/chat/completions`);
    console.log(`[${getTimestamp()}] [Grok]   Images: /grok/v1/images/generations`);
    console.log(`[${getTimestamp()}] [Grok]   Models: /grok/v1/models`);
    console.log(`[${getTimestamp()}] [Grok]   Admin:  /api/grok/tokens, /api/grok/stats`);
}

export default setupGrokRoutes;
