/**
 * Krater Routes - Express 路由
 * 提供 OpenAI 兼容的 /krater/v1/chat/completions 接口
 *
 * 集成模式与 Grok 等 provider 一致：
 * - 独立路由前缀 /krater/
 * - API Key 验证
 * - 日志记录
 * - 流式/非流式支持
 * - Key 池自动轮换
 */

import {
    KraterService,
    KraterKeyManager,
    KRATER_MODELS,
} from './krater-service.js';

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

// ============ Claude Messages <-> OpenAI Chat Completions 格式转换 ============

/**
 * Claude Messages 格式消息 → OpenAI Chat Completions 格式消息
 */
function claudeToOpenAIMessages(system, claudeMessages) {
    const messages = [];

    // system prompt
    if (system) {
        if (typeof system === 'string') {
            messages.push({ role: 'system', content: system });
        } else if (Array.isArray(system)) {
            const text = system
                .filter(b => b.type === 'text')
                .map(b => b.text || '')
                .join('\n');
            if (text) messages.push({ role: 'system', content: text });
        }
    }

    for (const msg of claudeMessages || []) {
        if (msg.role === 'user') {
            if (typeof msg.content === 'string') {
                messages.push({ role: 'user', content: msg.content });
            } else if (Array.isArray(msg.content)) {
                // 处理多模态内容和 tool_result
                const hasToolResult = msg.content.some(b => b.type === 'tool_result');
                if (hasToolResult) {
                    // 将 tool_result 块转换为 OpenAI tool 消息
                    for (const block of msg.content) {
                        if (block.type === 'tool_result') {
                            let content = '';
                            if (typeof block.content === 'string') {
                                content = block.content;
                            } else if (Array.isArray(block.content)) {
                                content = block.content
                                    .filter(b => b.type === 'text')
                                    .map(b => b.text || '')
                                    .join('\n');
                            }
                            messages.push({
                                role: 'tool',
                                tool_call_id: block.tool_use_id,
                                content: content,
                            });
                        } else if (block.type === 'text') {
                            messages.push({ role: 'user', content: block.text });
                        }
                    }
                } else {
                    // 普通多模态消息
                    const parts = [];
                    for (const block of msg.content) {
                        if (block.type === 'text') {
                            parts.push({ type: 'text', text: block.text });
                        } else if (block.type === 'image') {
                            if (block.source?.type === 'base64') {
                                parts.push({
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:${block.source.media_type};base64,${block.source.data}`,
                                    }
                                });
                            } else if (block.source?.type === 'url') {
                                parts.push({
                                    type: 'image_url',
                                    image_url: { url: block.source.url }
                                });
                            }
                        }
                    }
                    if (parts.length === 1 && parts[0].type === 'text') {
                        messages.push({ role: 'user', content: parts[0].text });
                    } else {
                        messages.push({ role: 'user', content: parts });
                    }
                }
            }
        } else if (msg.role === 'assistant') {
            if (typeof msg.content === 'string') {
                messages.push({ role: 'assistant', content: msg.content });
            } else if (Array.isArray(msg.content)) {
                // 提取文本和 tool_use
                let textParts = [];
                const toolCalls = [];
                for (const block of msg.content) {
                    if (block.type === 'text') {
                        textParts.push(block.text);
                    } else if (block.type === 'thinking') {
                        // 忽略 thinking 块（OpenAI 不支持）
                    } else if (block.type === 'tool_use') {
                        toolCalls.push({
                            id: block.id,
                            type: 'function',
                            function: {
                                name: block.name,
                                arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
                            }
                        });
                    }
                }
                const assistantMsg = {
                    role: 'assistant',
                    content: textParts.join('') || null,
                };
                if (toolCalls.length > 0) {
                    assistantMsg.tool_calls = toolCalls;
                }
                messages.push(assistantMsg);
            }
        }
    }

    return messages;
}

/**
 * OpenAI Chat Completions 非流式响应 → Claude Messages 格式
 */
function openaiToClaude(openaiResponse, model, msgId) {
    const choice = openaiResponse.choices?.[0] || {};
    const message = choice.message || {};
    const usage = openaiResponse.usage || {};

    const content = [];

    // 文本内容
    if (message.content) {
        content.push({ type: 'text', text: message.content });
    }

    // tool_calls → tool_use
    if (message.tool_calls && message.tool_calls.length > 0) {
        for (const tc of message.tool_calls) {
            let input = {};
            try {
                input = JSON.parse(tc.function?.arguments || '{}');
            } catch (e) {
                input = { raw: tc.function?.arguments || '' };
            }
            content.push({
                type: 'tool_use',
                id: tc.id || `toolu_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`,
                name: tc.function?.name || '',
                input,
            });
        }
    }

    // 如果没有内容，补一个空文本
    if (content.length === 0) {
        content.push({ type: 'text', text: '' });
    }

    // stop_reason 转换
    let stopReason = 'end_turn';
    if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
    else if (choice.finish_reason === 'length') stopReason = 'max_tokens';
    else if (choice.finish_reason === 'stop') stopReason = 'end_turn';

    return {
        id: msgId,
        type: 'message',
        role: 'assistant',
        content,
        model,
        stop_reason: stopReason,
        stop_sequence: null,
        usage: {
            input_tokens: usage.prompt_tokens || 0,
            output_tokens: usage.completion_tokens || 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        },
    };
}

/**
 * 模拟流式响应: 用非流式结果生成 Claude Messages SSE 事件
 * Krater API 当前不支持 stream=true，所以先请求非流式，再模拟 SSE 输出
 */
function simulateStreamClaudeResponse(res, openaiResult, model, msgId) {
    const choice = openaiResult.choices?.[0] || {};
    const message = choice.message || {};
    const usage = openaiResult.usage || {};
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;

    // 1. message_start
    const msgStart = {
        type: 'message_start',
        message: {
            id: msgId,
            type: 'message',
            role: 'assistant',
            content: [],
            model,
            stop_reason: null,
            stop_sequence: null,
            usage: {
                input_tokens: inputTokens,
                output_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
            },
        },
    };
    res.write(`event: message_start\ndata: ${JSON.stringify(msgStart)}\n\n`);

    let blockIndex = 0;
    let hasToolUse = false;

    // 2. 文本内容
    if (message.content) {
        const bs = { type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } };
        res.write(`event: content_block_start\ndata: ${JSON.stringify(bs)}\n\n`);

        // 分段发送文本，模拟流式效果
        const text = message.content;
        const chunkSize = 20;
        for (let i = 0; i < text.length; i += chunkSize) {
            const chunk = text.substring(i, i + chunkSize);
            const delta = {
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'text_delta', text: chunk },
            };
            res.write(`event: content_block_delta\ndata: ${JSON.stringify(delta)}\n\n`);
        }

        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`);
        blockIndex++;
    }

    // 3. tool_calls → tool_use
    if (message.tool_calls && message.tool_calls.length > 0) {
        hasToolUse = true;
        for (const tc of message.tool_calls) {
            let input = {};
            try {
                input = JSON.parse(tc.function?.arguments || '{}');
            } catch (e) {
                input = { raw: tc.function?.arguments || '' };
            }
            const toolId = tc.id || `toolu_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
            const bs = {
                type: 'content_block_start',
                index: blockIndex,
                content_block: { type: 'tool_use', id: toolId, name: tc.function?.name || '', input: {} },
            };
            res.write(`event: content_block_start\ndata: ${JSON.stringify(bs)}\n\n`);

            const argDelta = {
                type: 'content_block_delta',
                index: blockIndex,
                delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
            };
            res.write(`event: content_block_delta\ndata: ${JSON.stringify(argDelta)}\n\n`);

            res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`);
            blockIndex++;
        }
    }

    // 4. message_delta + message_stop
    let stopReason = 'end_turn';
    if (hasToolUse || choice.finish_reason === 'tool_calls') stopReason = 'tool_use';
    else if (choice.finish_reason === 'length') stopReason = 'max_tokens';

    const msgDelta = {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: outputTokens },
    };
    res.write(`event: message_delta\ndata: ${JSON.stringify(msgDelta)}\n\n`);
    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
    res.end();
}

/**
 * 模拟 OpenAI 流式输出: 用非流式结果生成 OpenAI SSE 事件
 */
function simulateStreamOpenAI(res, openaiResult) {
    const choice = openaiResult.choices?.[0] || {};
    const message = choice.message || {};
    const chatId = openaiResult.id || 'chatcmpl-' + Date.now();

    // 文本分段
    if (message.content) {
        const text = message.content;
        const chunkSize = 20;
        for (let i = 0; i < text.length; i += chunkSize) {
            const chunk = text.substring(i, i + chunkSize);
            const event = {
                id: chatId,
                object: 'chat.completion.chunk',
                created: openaiResult.created || Math.floor(Date.now() / 1000),
                model: openaiResult.model,
                choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
    }

    // tool_calls
    if (message.tool_calls) {
        for (const tc of message.tool_calls) {
            const event = {
                id: chatId,
                object: 'chat.completion.chunk',
                created: openaiResult.created || Math.floor(Date.now() / 1000),
                model: openaiResult.model,
                choices: [{ index: 0, delta: { tool_calls: [tc] }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
    }

    // finish
    const finishEvent = {
        id: chatId,
        object: 'chat.completion.chunk',
        created: openaiResult.created || Math.floor(Date.now() / 1000),
        model: openaiResult.model,
        choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason || 'stop' }],
    };
    res.write(`data: ${JSON.stringify(finishEvent)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
}

/**
 * 设置 Krater 路由
 * @param {Express} app - Express 实例
 * @param {Function} authMiddleware - 管理后台认证中间件
 * @param {Function} verifyApiKey - API Key 验证函数
 * @param {Object} apiLogStore - 日志存储
 * @param {Object} kraterCredentialStore - Krater 凭据存储
 */
export function setupKraterRoutes(app, authMiddleware, verifyApiKey, apiLogStore, kraterCredentialStore) {

    const kraterService = new KraterService({
        timeout: parseInt(process.env.KRATER_TIMEOUT || '120000'),
        streamTimeout: parseInt(process.env.KRATER_STREAM_TIMEOUT || '60000'),
    });

    const keyManager = new KraterKeyManager();

    // 启动时从数据库加载 keys
    let keysLoaded = false;
    async function ensureKeysLoaded() {
        if (keysLoaded) return;
        try {
            const keys = await kraterCredentialStore.getAll();
            keyManager.loadKeys(keys);
            keysLoaded = true;
            console.log(`[${getTimestamp()}] [Krater] 加载了 ${keys.length} 个 API Key`);
        } catch (e) {
            console.error(`[${getTimestamp()}] [Krater] 加载 API Key 失败: ${e.message}`);
        }
    }

    // 每 5 分钟重新加载 keys
    setInterval(async () => {
        try {
            const keys = await kraterCredentialStore.getAll();
            keyManager.loadKeys(keys);
        } catch (e) {
            console.error(`[${getTimestamp()}] [Krater] 刷新 API Key 失败: ${e.message}`);
        }
    }, 5 * 60 * 1000);

    // 保存 key 状态到数据库
    async function persistKeyState(apiKey, action) {
        try {
            if (action === 'success') {
                await kraterCredentialStore.incrementUseCount(apiKey);
            } else if (action === 'fail') {
                await kraterCredentialStore.recordFail(apiKey);
            } else if (action === 'expired') {
                await kraterCredentialStore.updateKeyState(apiKey, { status: 'expired' });
            } else if (action === 'disabled') {
                await kraterCredentialStore.updateKeyState(apiKey, { status: 'disabled' });
            }
        } catch (e) {
            // 静默失败
        }
    }

    // ============ 模型列表 ============
    app.get('/k/v1/models', async (req, res) => {
        await ensureKeysLoaded();

        // 尝试从 Krater API 获取真实模型列表
        const kraterKey = keyManager.getKey();
        if (kraterKey) {
            try {
                const modelsData = await kraterService.fetchModels(kraterKey);
                return res.json(modelsData);
            } catch (e) {
                // 失败则返回本地列表
            }
        }

        const models = KRATER_MODELS.map(id => ({
            id,
            object: 'model',
            created: 1700000000,
            owned_by: 'krater',
            permission: [],
            root: id,
            parent: null,
        }));
        res.json({ object: 'list', data: models });
    });

    // ============ Chat Completions ============
    app.post('/k/v1/chat/completions', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'krater_' + Date.now() + Math.random().toString(36).substring(2, 8);
        const clientIp = getClientIp(req);

        let logData = {
            requestId,
            ipAddress: clientIp,
            userAgent: req.headers['user-agent'] || '',
            method: 'POST',
            path: '/k/v1/chat/completions',
            channel: 'Krater',
            stream: false,
            inputTokens: 0,
            outputTokens: 0,
            statusCode: 200,
        };

        try {
            // API Key 验证（验证调用者的 sk- key）
            const apiKey = parseApiKey(req.headers);
            if (apiKey && verifyApiKey) {
                const keyRecord = await verifyApiKey(apiKey);
                if (keyRecord) {
                    logData.apiKeyId = keyRecord.id;
                    logData.apiKeyPrefix = keyRecord.keyPrefix;
                }
            }

            await ensureKeysLoaded();

            const { model, messages, stream = false, ...restParams } = req.body;

            if (!model || !messages || !messages.length) {
                logData.statusCode = 400;
                logData.errorMessage = 'Missing required fields';
                if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                return res.status(400).json({
                    error: { message: 'Missing required fields: model, messages', type: 'invalid_request_error' }
                });
            }

            logData.model = model;
            logData.stream = !!stream;
            logData.inputTokens = Math.ceil(JSON.stringify(messages).length / 4);

            // Key 选择与重试
            const maxRetries = 3;
            const triedKeys = new Set();
            let lastError = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const kraterKey = keyManager.getKey(triedKeys);
                if (!kraterKey) {
                    if (lastError) break;
                    logData.statusCode = 429;
                    logData.errorMessage = 'No available Krater API keys';
                    if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                    return res.status(429).json({
                        error: { message: 'No available Krater API keys. Please try again later.', type: 'rate_limit_error' }
                    });
                }

                triedKeys.add(kraterKey);

                try {
                    const requestBody = { model, messages, ...restParams };

                    if (stream) {
                        // 模拟流式响应（Krater API 不支持原生流式，用非流式结果模拟 SSE）
                        const result = await kraterService.chatCompletions(kraterKey, requestBody);

                        keyManager.consume(kraterKey);
                        persistKeyState(kraterKey, 'success');

                        res.setHeader('Content-Type', 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache');
                        res.setHeader('Connection', 'keep-alive');
                        disableCompressionForSSE(res);

                        simulateStreamOpenAI(res, result);

                        const outputTokens = result.usage?.completion_tokens || 0;
                        logData.outputTokens = outputTokens;
                        logData.inputTokens = result.usage?.prompt_tokens || logData.inputTokens;
                        if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                        return;

                    } else {
                        // 非流式响应
                        const result = await kraterService.chatCompletions(kraterKey, requestBody);

                        keyManager.consume(kraterKey);
                        persistKeyState(kraterKey, 'success');

                        const outputTokens = result.usage?.completion_tokens || Math.ceil((result.choices?.[0]?.message?.content || '').length / 4);
                        logData.outputTokens = outputTokens;
                        logData.inputTokens = result.usage?.prompt_tokens || logData.inputTokens;
                        if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }

                        return res.json(result);
                    }

                } catch (error) {
                    lastError = error;
                    const status = error.status || 500;

                    if (status === 429) {
                        keyManager.markRateLimited(kraterKey);
                        persistKeyState(kraterKey, 'fail');
                        console.warn(`[${getTimestamp()}] [Krater] Key ${kraterKey.substring(0, 15)}... 被限流，尝试下一个 (${attempt + 1}/${maxRetries})`);
                        continue;
                    } else if (status === 401 || status === 403) {
                        keyManager.recordFail(kraterKey, status);
                        persistKeyState(kraterKey, 'expired');
                        console.warn(`[${getTimestamp()}] [Krater] Key ${kraterKey.substring(0, 15)}... ${status === 401 ? '认证失败' : '被拒绝'}，尝试下一个 (${attempt + 1}/${maxRetries})`);
                        continue;
                    } else {
                        throw error;
                    }
                }
            }

            // 所有 key 都失败
            const errorStatus = lastError?.status || 502;
            const errorMessage = lastError?.message || 'All Krater API keys failed';
            logData.statusCode = errorStatus;
            logData.errorMessage = errorMessage;
            if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }

            return res.status(errorStatus).json({
                error: { message: errorMessage, type: 'upstream_error' }
            });

        } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorStatus = error.status || 500;
            console.error(`[${getTimestamp()}] [Krater] 请求失败: ${error.message}`);

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

    // ============ Krater Key 管理 API ============

    // 获取所有 keys
    app.get('/api/krater/keys', authMiddleware, async (req, res) => {
        try {
            const keys = await kraterCredentialStore.getAll();
            const stats = keyManager.getStats();
            res.json({ keys, stats });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 添加 key
    app.post('/api/krater/keys', authMiddleware, async (req, res) => {
        try {
            const { apiKey, note = '' } = req.body;
            if (!apiKey) {
                return res.status(400).json({ error: 'apiKey is required' });
            }

            await kraterCredentialStore.add({ apiKey: apiKey.trim(), note });

            keysLoaded = false;
            await ensureKeysLoaded();

            res.json({ success: true, message: 'Key added' });
        } catch (error) {
            if (error.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ error: 'This API key already exists' });
            }
            res.status(500).json({ error: error.message });
        }
    });

    // 批量添加 keys
    app.post('/api/krater/keys/batch', authMiddleware, async (req, res) => {
        try {
            const { keys } = req.body;
            if (!keys || !Array.isArray(keys)) {
                return res.status(400).json({ error: 'keys array is required' });
            }

            let added = 0;
            for (const item of keys) {
                const key = (typeof item === 'string' ? item : item.apiKey || '').trim();
                if (!key) continue;
                try {
                    await kraterCredentialStore.add({
                        apiKey: key,
                        note: typeof item === 'object' ? (item.note || '') : '',
                    });
                    added++;
                } catch (e) {
                    // 跳过重复
                }
            }

            keysLoaded = false;
            await ensureKeysLoaded();

            res.json({ success: true, added, total: keys.length });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 删除 key
    app.delete('/api/krater/keys/:id', authMiddleware, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            if (isNaN(id)) {
                return res.status(400).json({ error: 'Invalid ID' });
            }
            await kraterCredentialStore.delete(id);
            keysLoaded = false;
            await ensureKeysLoaded();
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 更新 key 状态
    app.put('/api/krater/keys/:id/status', authMiddleware, async (req, res) => {
        try {
            const { status } = req.body;
            if (!['active', 'disabled'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status. Use: active, disabled' });
            }

            // 获取 key 详情
            const keys = await kraterCredentialStore.getAll();
            const target = keys.find(k => k.id === parseInt(req.params.id));
            if (!target) {
                return res.status(404).json({ error: 'Key not found' });
            }

            await kraterCredentialStore.updateKeyState(target.apiKey, { status });
            keysLoaded = false;
            await ensureKeysLoaded();

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // 获取统计
    app.get('/api/krater/stats', authMiddleware, async (req, res) => {
        try {
            await ensureKeysLoaded();
            const dbStats = await kraterCredentialStore.getStatistics();
            const memStats = keyManager.getStats();
            res.json({ ...dbStats, memory: memStats });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    // ============ Claude Messages 兼容端点 ============
    app.post('/k/v1/messages', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'msg_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 14);
        const clientIp = getClientIp(req);

        let logData = {
            requestId,
            ipAddress: clientIp,
            userAgent: req.headers['user-agent'] || '',
            method: 'POST',
            path: '/k/v1/messages',
            channel: 'Krater',
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

            await ensureKeysLoaded();

            const body = req.body;
            const model = body.model;
            const stream = body.stream || false;

            if (!model || !body.messages || !body.messages.length) {
                logData.statusCode = 400;
                logData.errorMessage = 'Missing required fields';
                if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                return res.status(400).json({
                    type: 'error',
                    error: { type: 'invalid_request_error', message: 'Missing required fields: model, messages' }
                });
            }

            logData.model = model;
            logData.stream = !!stream;

            // 将 Claude Messages 格式转换为 OpenAI Chat Completions 格式
            const openaiMessages = claudeToOpenAIMessages(body.system, body.messages);
            const openaiBody = {
                model,
                messages: openaiMessages,
                max_tokens: body.max_tokens || 4096,
            };
            if (body.temperature !== undefined) openaiBody.temperature = body.temperature;
            if (body.top_p !== undefined) openaiBody.top_p = body.top_p;
            if (body.stop_sequences) openaiBody.stop = body.stop_sequences;

            // 工具转换: Claude tools → OpenAI tools
            if (body.tools && body.tools.length > 0) {
                openaiBody.tools = body.tools.map(t => ({
                    type: 'function',
                    function: {
                        name: t.name,
                        description: t.description || '',
                        parameters: t.input_schema || {},
                    }
                }));
                if (body.tool_choice) {
                    if (typeof body.tool_choice === 'object' && body.tool_choice.name) {
                        openaiBody.tool_choice = { type: 'function', function: { name: body.tool_choice.name } };
                    } else if (body.tool_choice === 'auto' || body.tool_choice?.type === 'auto') {
                        openaiBody.tool_choice = 'auto';
                    } else if (body.tool_choice === 'any' || body.tool_choice?.type === 'any') {
                        openaiBody.tool_choice = 'required';
                    }
                }
            }

            logData.inputTokens = Math.ceil(JSON.stringify(openaiMessages).length / 4);

            // Key 选择与重试
            const maxRetries = 3;
            const triedKeys = new Set();
            let lastError = null;

            for (let attempt = 0; attempt < maxRetries; attempt++) {
                const kraterKey = keyManager.getKey(triedKeys);
                if (!kraterKey) {
                    if (lastError) break;
                    logData.statusCode = 429;
                    logData.errorMessage = 'No available Krater API keys';
                    if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                    return res.status(429).json({
                        type: 'error',
                        error: { type: 'rate_limit_error', message: 'No available Krater API keys. Please try again later.' }
                    });
                }

                triedKeys.add(kraterKey);

                try {
                    if (stream) {
                        // 模拟流式: 非流式请求 Krater → 模拟 Claude Messages SSE 输出
                        const result = await kraterService.chatCompletions(kraterKey, openaiBody);

                        keyManager.consume(kraterKey);
                        persistKeyState(kraterKey, 'success');

                        res.setHeader('Content-Type', 'text/event-stream');
                        res.setHeader('Cache-Control', 'no-cache');
                        res.setHeader('Connection', 'keep-alive');
                        disableCompressionForSSE(res);

                        simulateStreamClaudeResponse(res, result, model, requestId);

                        logData.inputTokens = result.usage?.prompt_tokens || logData.inputTokens;
                        logData.outputTokens = result.usage?.completion_tokens || 0;
                        if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }
                        return;

                    } else {
                        // 非流式: OpenAI response → Claude Messages response
                        const result = await kraterService.chatCompletions(kraterKey, openaiBody);

                        keyManager.consume(kraterKey);
                        persistKeyState(kraterKey, 'success');

                        const claudeResponse = openaiToClaude(result, model, requestId);

                        logData.inputTokens = result.usage?.prompt_tokens || logData.inputTokens;
                        logData.outputTokens = result.usage?.completion_tokens || 0;
                        if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }

                        return res.json(claudeResponse);
                    }

                } catch (error) {
                    lastError = error;
                    const status = error.status || 500;

                    if (status === 429) {
                        keyManager.markRateLimited(kraterKey);
                        persistKeyState(kraterKey, 'fail');
                        continue;
                    } else if (status === 401 || status === 403) {
                        keyManager.recordFail(kraterKey, status);
                        persistKeyState(kraterKey, 'expired');
                        continue;
                    } else {
                        throw error;
                    }
                }
            }

            const errorStatus = lastError?.status || 502;
            const errorMessage = lastError?.message || 'All Krater API keys failed';
            logData.statusCode = errorStatus;
            logData.errorMessage = errorMessage;
            if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) { /* ignore */ }

            return res.status(errorStatus).json({
                type: 'error',
                error: { type: 'api_error', message: errorMessage }
            });

        } catch (error) {
            const durationMs = Date.now() - startTime;
            const errorStatus = error.status || 500;
            console.error(`[${getTimestamp()}] [Krater] Messages 请求失败: ${error.message}`);

            logData.statusCode = errorStatus;
            logData.errorMessage = error.message;
            if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs }); } catch (e) { /* ignore */ }

            if (!res.headersSent) {
                return res.status(errorStatus).json({
                    type: 'error',
                    error: { type: 'api_error', message: error.message }
                });
            }
        }
    });

    console.log(`[${getTimestamp()}] [Krater] 路由已注册:`);
    console.log(`[${getTimestamp()}] [Krater]   Chat:     /k/v1/chat/completions`);
    console.log(`[${getTimestamp()}] [Krater]   Messages: /k/v1/messages`);
    console.log(`[${getTimestamp()}] [Krater]   Models:   /k/v1/models`);
    console.log(`[${getTimestamp()}] [Krater]   Admin:    /api/krater/keys, /api/krater/stats`);
}

export default setupKraterRoutes;
