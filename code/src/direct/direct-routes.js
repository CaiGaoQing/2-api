/**
 * Direct 转发通道路由
 * 纯透传 Anthropic/Claude Messages 格式，不做任何转换
 *
 * API 端点:
 *   POST /direct/v1/messages          - Claude Messages 转发
 *   GET  /direct/v1/models            - 模型列表(透传)
 *
 * 管理端点:
 *   GET    /api/direct/channels       - 获取所有通道
 *   POST   /api/direct/channels       - 添加通道
 *   PUT    /api/direct/channels/:id   - 更新通道
 *   DELETE /api/direct/channels/:id   - 删除通道
 *   GET    /api/direct/stats          - 统计信息
 */

function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.socket.remoteAddress
        || '127.0.0.1';
}

function parseApiKey(headers) {
    let apiKey = headers['x-api-key'];
    if (!apiKey) {
        const auth = headers['authorization'];
        if (auth) apiKey = auth.replace(/^bearer\s+/i, '');
    }
    if (apiKey) apiKey = apiKey.trim().replace(/^["']|["']$/g, '');
    return apiKey || null;
}

export function setupDirectRoutes(app, authMiddleware, verifyApiKey, apiLogStore, directChannelStore) {

    // ============ Claude Messages 转发 ============
    app.post('/direct/v1/messages', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'direct_' + Date.now() + Math.random().toString(36).substring(2, 8);
        const clientIp = getClientIp(req);

        let logData = {
            requestId,
            ipAddress: clientIp,
            userAgent: req.headers['user-agent'] || '',
            method: 'POST',
            path: '/direct/v1/messages',
            channel: 'Direct',
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

            const { model, messages, stream = false, ...restParams } = req.body;
            logData.model = model;
            logData.stream = stream;

            if (!model || !messages || !messages.length) {
                logData.statusCode = 400;
                logData.errorMessage = 'Missing required fields';
                if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) {}
                return res.status(400).json({
                    type: 'error',
                    error: { type: 'invalid_request_error', message: 'Missing required fields: model, messages' }
                });
            }

            // 获取可用通道（按使用次数轮询）
            const channels = await directChannelStore.getActive();
            if (!channels.length) {
                logData.statusCode = 503;
                logData.errorMessage = 'No active direct channels';
                if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) {}
                return res.status(503).json({
                    type: 'error',
                    error: { type: 'api_error', message: 'No active direct channels available' }
                });
            }

            // 构造转发请求体 — 原样透传
            const forwardBody = { model, messages, stream, ...restParams };

            // 尝试所有通道
            let lastError = null;
            for (const channel of channels) {
                try {
                    const upstreamUrl = channel.upstreamUrl;
                    const upstreamKey = channel.apiKey;

                    console.log(`[${getTimestamp()}] [Direct] ${requestId} -> ${channel.name} (${upstreamUrl})`);

                    const upstreamRes = await fetch(upstreamUrl, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-api-key': upstreamKey,
                            'anthropic-version': req.headers['anthropic-version'] || '2023-06-01',
                        },
                        body: JSON.stringify(forwardBody),
                    });

                    // 非流式：直接返回
                    if (!stream) {
                        const data = await upstreamRes.text();
                        const statusCode = upstreamRes.status;

                        if (statusCode >= 200 && statusCode < 300) {
                            await directChannelStore.incrementUseCount(channel.id);
                            try {
                                const parsed = JSON.parse(data);
                                logData.inputTokens = parsed.usage?.input_tokens || 0;
                                logData.outputTokens = parsed.usage?.output_tokens || 0;
                            } catch (e) {}
                        } else {
                            await directChannelStore.recordFail(channel.id);
                            // 4xx 非 429 不重试
                            if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
                                logData.statusCode = statusCode;
                                logData.errorMessage = data.substring(0, 200);
                                if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) {}
                                res.status(statusCode).set('Content-Type', 'application/json').send(data);
                                return;
                            }
                            lastError = { status: statusCode, body: data };
                            console.warn(`[${getTimestamp()}] [Direct] ${channel.name} 返回 ${statusCode}，尝试下一个通道`);
                            continue;
                        }

                        logData.statusCode = statusCode;
                        if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) {}
                        res.status(statusCode).set('Content-Type', 'application/json').send(data);
                        return;
                    }

                    // 流式：透传 SSE
                    if (!upstreamRes.ok) {
                        const errBody = await upstreamRes.text();
                        await directChannelStore.recordFail(channel.id);
                        if (upstreamRes.status >= 400 && upstreamRes.status < 500 && upstreamRes.status !== 429) {
                            logData.statusCode = upstreamRes.status;
                            logData.errorMessage = errBody.substring(0, 200);
                            if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) {}
                            res.status(upstreamRes.status).set('Content-Type', 'application/json').send(errBody);
                            return;
                        }
                        lastError = { status: upstreamRes.status, body: errBody };
                        console.warn(`[${getTimestamp()}] [Direct] ${channel.name} 流式返回 ${upstreamRes.status}，尝试下一个通道`);
                        continue;
                    }

                    await directChannelStore.incrementUseCount(channel.id);

                    // 透传 SSE 流
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');
                    res.setHeader('X-Accel-Buffering', 'no');
                    res.flushHeaders();

                    const reader = upstreamRes.body.getReader();
                    const decoder = new TextDecoder();

                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            const chunk = decoder.decode(value, { stream: true });
                            res.write(chunk);
                            if (typeof res.flush === 'function') res.flush();
                        }
                    } catch (streamErr) {
                        console.error(`[${getTimestamp()}] [Direct] 流式传输中断: ${streamErr.message}`);
                    }

                    logData.statusCode = 200;
                    if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) {}
                    res.end();
                    return;

                } catch (err) {
                    await directChannelStore.recordFail(channel.id);
                    lastError = { status: 502, body: err.message };
                    console.error(`[${getTimestamp()}] [Direct] ${channel.name} 请求异常: ${err.message}`);
                    continue;
                }
            }

            // 所有通道都失败
            const errStatus = lastError?.status || 502;
            logData.statusCode = errStatus;
            logData.errorMessage = 'All direct channels failed';
            if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) {}
            res.status(errStatus).json({
                type: 'error',
                error: { type: 'api_error', message: 'All direct channels failed', detail: lastError?.body }
            });

        } catch (err) {
            console.error(`[${getTimestamp()}] [Direct] 未捕获异常: ${err.message}`);
            logData.statusCode = 500;
            logData.errorMessage = err.message;
            if (apiLogStore) try { await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime }); } catch (e) {}
            if (!res.headersSent) {
                res.status(500).json({
                    type: 'error',
                    error: { type: 'api_error', message: err.message }
                });
            }
        }
    });

    // ============ 管理接口 ============

    // 获取所有通道
    app.get('/api/direct/channels', authMiddleware, async (req, res) => {
        try {
            const channels = await directChannelStore.getAll();
            res.json(channels);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 添加通道
    app.post('/api/direct/channels', authMiddleware, async (req, res) => {
        try {
            const { name, upstreamUrl, apiKey, note } = req.body;
            if (!name || !upstreamUrl || !apiKey) {
                return res.status(400).json({ error: '缺少必填字段: name, upstreamUrl, apiKey' });
            }
            const id = await directChannelStore.add({ name, upstreamUrl, apiKey, note });
            res.json({ success: true, id });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 更新通道
    app.put('/api/direct/channels/:id', authMiddleware, async (req, res) => {
        try {
            await directChannelStore.update(parseInt(req.params.id), req.body);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 删除通道
    app.delete('/api/direct/channels/:id', authMiddleware, async (req, res) => {
        try {
            await directChannelStore.delete(parseInt(req.params.id));
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 统计
    app.get('/api/direct/stats', authMiddleware, async (req, res) => {
        try {
            const stats = await directChannelStore.getStatistics();
            res.json(stats);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    console.log(`[${getTimestamp()}] [Direct] 路由已设置`);
    console.log('[Direct] 端点: POST /direct/v1/messages');
    console.log('[Direct] 管理: /api/direct/channels');
}
