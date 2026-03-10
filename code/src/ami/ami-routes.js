/**
 * AMI API 路由
 * 提供 AMI 凭据管理和对话 API
 */
import { AmiService, AMI_MODELS } from './ami-service.js';
import { ApiLogStore } from '../db.js';
import { logger } from '../logger.js';

const log = logger.server;

/**
 * 清洗 sessionCookie：自动去除 wos-session= 前缀
 */
function cleanCookie(raw) {
    if (!raw) return raw;
    return raw.startsWith('wos-session=') ? raw.substring('wos-session='.length) : raw;
}

/**
 * 创建 AMI 对话请求 handler（可复用）
 * 供 /am/v1/messages 路由和 server.js Model-Provider 路由共用
 */
export function createAmiMessagesHandler(amiStore, verifyApiKey) {
    return async function handleAmiMessages(req, res) {
        let credential = null;
        const startTime = Date.now();
        const requestId = 'ami_' + Date.now() + Math.random().toString(36).substring(2, 8);
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
        let apiLogStore = null;
        let logData = {
            requestId,
            ipAddress: clientIp,
            userAgent: req.headers['user-agent'] || '',
            method: 'POST',
            path: req.path || '/am/v1/messages',
            channel: 'AMI',
            stream: false,
            inputTokens: 0,
            outputTokens: 0,
            statusCode: 200
        };
        try { apiLogStore = await ApiLogStore.create(); } catch (e) { /* ignore */ }

        try {
            // 验证 API Key
            const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
            if (!apiKey) {
                return res.status(401).json({
                    type: 'error',
                    error: { type: 'authentication_error', message: '缺少 API Key' },
                });
            }

            const keyRecord = await verifyApiKey(apiKey);
            if (!keyRecord || !keyRecord.isActive) {
                return res.status(401).json({
                    type: 'error',
                    error: { type: 'authentication_error', message: 'API Key 无效或已禁用' },
                });
            }

            // 记录 API Key 信息用于计费
            logData.apiKeyId = keyRecord.id;
            logData.apiKeyPrefix = keyRecord.keyPrefix;

            let { model, messages, stream = true, system, max_tokens, temperature, tools } = req.body;

            // 使用 DB 层负载均衡选取凭据（按 use_count 升序 + 随机）
            credential = await amiStore.getRandomActive();

            if (!credential) {
                return res.status(503).json({
                    type: 'error',
                    error: { type: 'service_unavailable', message: '没有可用的 AMI 凭据' },
                });
            }

            // 自动清洗 cookie
            credential.sessionCookie = cleanCookie(credential.sessionCookie);

            const service = new AmiService(credential);

            // 如果缺少 projectId 或 chatId，自动创建项目并回写 DB
            if (!credential.projectId || !credential.chatId) {
                const project = await service.createProject(`API-${credential.name || credential.id}`);
                await amiStore.update(credential.id, {
                    projectId: project.projectId,
                    chatId: project.chatId,
                });
            }

            // ── 打印 CLI 请求摘要 ──
            const toolNames = tools?.map(t => t.name) || [];
            const msgCount = messages?.length || 0;
            // 只打印最后 2 条消息
            const tail = (messages || []).slice(-2).map((m, i) => {
                const idx = msgCount - 2 + i;
                const role = m.role;
                let preview = '';
                if (typeof m.content === 'string') {
                    preview = m.content.slice(0, 80);
                } else if (Array.isArray(m.content)) {
                    preview = m.content.map(b => {
                        if (b.type === 'text') return `text:"${(b.text || '').slice(0, 40)}"`;
                        if (b.type === 'tool_use') return `tool_use:${b.name}`;
                        if (b.type === 'tool_result') return `tool_result(err=${b.is_error||false})`;
                        return b.type;
                    }).join(' | ');
                }
                return `  [${idx < 0 ? 0 : idx}] ${role}: ${preview}`;
            });
            // 从 system prompt 或消息中提取 cwd
            let extractedCwd = null;
            const systemStr = typeof system === 'string' ? system
                : Array.isArray(system) ? system.map(s => typeof s === 'string' ? s : (s.text || '')).join('\n')
                : '';
            // 常见模式："/Users/xxx/project" 或 "working directory: /xxx"
            const cwdMatch = systemStr.match(/(?:working.?directory|cwd|project.?(?:root|path|directory))[:\s]+([\/][^\s\n"']+)/i)
                || systemStr.match(/(?:^|\s)(\/Users\/[^\s\n"']+)/m)
                || systemStr.match(/(?:^|\s)(\/home\/[^\s\n"']+)/m);
            if (cwdMatch) {
                extractedCwd = cwdMatch[1];
                console.log(`║ 提取 cwd: ${extractedCwd}`);
            }
            // 如果 system 没有，从消息中的文件路径推断
            if (!extractedCwd && messages?.length > 0) {
                for (const m of messages) {
                    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
                    const pathMatch = content.match(/(\/Users\/[^\s\n"'\\:]+\/[^\s\n"'\\:]+)\//);
                    if (pathMatch) {
                        // 取到项目根目录（去掉文件名）
                        const parts = pathMatch[1].split('/');
                        extractedCwd = parts.slice(0, -1).join('/') || pathMatch[1];
                        console.log(`║ 从消息推断 cwd: ${extractedCwd}`);
                        break;
                    }
                }
            }
            console.log(`\n╔═ CLI REQ: model=${model}, msgs=${msgCount}, tools=${toolNames.length}`);
            tail.forEach(s => console.log(`║ ${s}`));
            console.log('╚═══════════════════════════════════════');

            log.info(`[AMI] 对话请求: model=${model}, stream=${stream}, tools=${toolNames.length}, credential=${credential.id}`);

            // ── 拦截无意义请求，节省 AMI 配额 ──
            const lastMsg = messages?.[messages.length - 1];

            // 1) CLI prefill 请求：assistant 结尾 + 无 tools → 返回空响应
            if (lastMsg?.role === 'assistant' && toolNames.length === 0) {
                console.log('║ ⚡ 拦截: prefill 请求 (assistant 结尾 + 无 tools)');
                if (stream) {
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.setHeader('Cache-Control', 'no-cache');
                    const msgId = 'msg_' + Date.now();
                    res.write(`event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', content: [], model: model || 'ami-model', stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);
                    res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`);
                    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
                    res.write(`event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } })}\n\n`);
                    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                    return res.end();
                }
                return res.json({ id: 'msg_' + Date.now(), type: 'message', role: 'assistant', content: [{ type: 'text', text: '' }], model: model || 'ami-model', stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } });
            }

            // 2) tool_result 请求：提取工具结果，转换为普通用户消息发给 AMI
            const hasToolResult = lastMsg?.role === 'user' && Array.isArray(lastMsg?.content) && lastMsg.content.some(b => b.type === 'tool_result');
            if (hasToolResult) {
                // 从 assistant 消息中查找对应的 tool_use 名
                const toolUseMap = {};
                const prevMsg = messages[messages.length - 2];
                if (prevMsg?.role === 'assistant' && Array.isArray(prevMsg?.content)) {
                    for (const b of prevMsg.content) {
                        if (b.type === 'tool_use') toolUseMap[b.id] = b.name;
                    }
                }

                const parts = lastMsg.content.map(b => {
                    if (b.type === 'tool_result') {
                        const content = typeof b.content === 'string' ? b.content
                            : Array.isArray(b.content) ? b.content.map(c => c.text || '').join('\n')
                            : JSON.stringify(b.content || '');
                        const toolName = toolUseMap[b.tool_use_id] || 'unknown';
                        if (b.is_error) {
                            return `[Tool ${toolName} FAILED]: ${content}`;
                        }
                        return `[Tool ${toolName} result]: ${content}`;
                    }
                    if (b.type === 'text') return b.text || '';
                    return '';
                }).filter(Boolean);

                console.log(`║ 🔄 转换 tool_result → 用户消息: ${parts.map(p => p.slice(0, 60)).join(' | ')}`);
                messages[messages.length - 1] = { role: 'user', content: parts.join('\n') || '继续' };
                // 移除 messages 中的 tool_use（assistant 消息里的）
                for (let i = messages.length - 2; i >= 0; i--) {
                    const m = messages[i];
                    if (m.role === 'assistant' && Array.isArray(m.content)) {
                        m.content = m.content.filter(b => b.type !== 'tool_use');
                        if (m.content.length === 0) m.content = [{ type: 'text', text: '(continued)' }];
                    }
                }
            }

            // ── 裁剪消息历史，减少 AMI 输入 token → 加速响应 ──
            const MAX_CONTEXT_MESSAGES = 60; // 保留最近 N 条消息（约 30 轮工具调用）
            if (messages.length > MAX_CONTEXT_MESSAGES + 1) {
                const first = messages[0]; // 保留第一条用户消息（包含原始需求）
                const recent = messages.slice(-MAX_CONTEXT_MESSAGES);
                messages = [first, { role: 'user', content: '[...earlier conversation omitted for brevity...]' }, ...recent];
                console.log(`║ ✂ 裁剪消息: ${msgCount} → ${messages.length} 条`);
            }

            const requestBody = { messages, system, max_tokens, temperature, tools, cwd: extractedCwd };

            let inputTokens = 0;
            let outputTokens = 0;

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no');

                try {
                    for await (const event of service.generateContentStream(model, requestBody)) {
                        // 捕获最终 usage（message_stop._usage）
                        if (event.type === 'message_stop' && event._usage) {
                            inputTokens = event._usage.input_tokens || 0;
                            outputTokens = event._usage.output_tokens || 0;
                        }

                        // 捕获致命错误：标记凭据并禁用
                        if (event._fatal) {
                            log.warn(`[AMI] 致命错误，禁用凭据 ${credential.id}: ${event._errorMessage}`);
                            await amiStore.incrementErrorCount(credential.id, event._errorMessage);
                            // 直接设置 error_count=3 让 getRandomActive 不再选中
                            await amiStore.update(credential.id, { status: 'error' });
                        }

                        // 发送给客户端时移除内部字段
                        const { _usage, _fatal, _errorMessage, _internal, ...clientEvent } = event;
                        res.write(`event: ${clientEvent.type}\ndata: ${JSON.stringify(clientEvent)}\n\n`);
                    }
                } catch (streamError) {
                    log.error(`[AMI] 流式响应错误: ${streamError.message}`);
                    res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: streamError.message } })}\n\n`);
                    await amiStore.incrementErrorCount(credential.id, streamError.message);
                }

                res.end();
            } else {
                const response = await service.generateContent(model, requestBody);
                inputTokens = response.usage?.input_tokens || 0;
                outputTokens = response.usage?.output_tokens || 0;
                res.json(response);
            }

            // 成功后递增使用次数 + token 统计
            await amiStore.incrementUseCount(credential.id);
            if (inputTokens > 0 || outputTokens > 0) {
                await amiStore.updateTokenStats(credential.id, inputTokens, outputTokens);
                log.info(`[AMI] Token 统计: input=${inputTokens}, output=${outputTokens}, credential=${credential.id}`);
            }

            // 记录成功日志
            logData.credentialId = credential.id;
            logData.credentialName = credential.name;
            logData.model = model || 'ami-model';
            logData.stream = !!stream;
            logData.inputTokens = inputTokens;
            logData.outputTokens = outputTokens;
            if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
        } catch (error) {
            log.error(`[AMI] 对话请求失败: ${error.message}`);

            if (credential) {
                await amiStore.incrementErrorCount(credential.id, error.message);
            }

            logData.statusCode = 500;
            logData.errorMessage = error.message;
            if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });

            if (!res.headersSent) {
                res.status(500).json({
                    type: 'error',
                    error: { type: 'api_error', message: error.message },
                });
            }
        }
    };
}

export function setupAmiRoutes(app, amiStore, verifyApiKey) {

    // ============ 统计 API ============

    app.get('/api/ami/statistics', async (req, res) => {
        try {
            const stats = await amiStore.getStatistics();
            res.json({
                success: true,
                data: {
                    total: stats.total,
                    active: stats.active,
                    error: stats.error,
                    totalUsage: stats.totalUseCount,
                },
            });
        } catch (error) {
            log.error(`[AMI] 获取统计信息失败: ${error.message}`);
            res.json({ success: true, data: { total: 0, active: 0, error: 0, totalUsage: 0 } });
        }
    });

    // ============ 凭据管理 API ============

    // 获取所有 AMI 凭据
    app.get('/api/ami/credentials', async (req, res) => {
        try {
            const credentials = await amiStore.getAll();
            const safeCredentials = credentials.map(c => ({
                ...c,
                sessionCookie: c.sessionCookie ? '***' + c.sessionCookie.slice(-20) : null,
            }));
            res.json({ success: true, data: safeCredentials });
        } catch (error) {
            log.error(`[AMI] 获取凭据列表失败: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 添加 AMI 凭据
    app.post('/api/ami/credentials', async (req, res) => {
        try {
            const { name, sessionCookie, projectId, chatId, note } = req.body;

            if (!sessionCookie) {
                return res.status(400).json({ success: false, error: '缺少 sessionCookie' });
            }

            const credential = await amiStore.add({
                name: name || `AMI-${Date.now()}`,
                sessionCookie: cleanCookie(sessionCookie),
                projectId: projectId || '',
                chatId: chatId || '',
                note: note || '',
                status: 'active',
            });

            log.info(`[AMI] 添加凭据: ${credential.name}`);
            res.json({ success: true, data: { ...credential, sessionCookie: '***' } });
        } catch (error) {
            log.error(`[AMI] 添加凭据失败: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 更新 AMI 凭据
    app.put('/api/ami/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const { name, sessionCookie, projectId, chatId, note, status } = req.body;

            const updateData = { name, projectId, chatId, note, status };
            if (sessionCookie !== undefined) {
                updateData.sessionCookie = cleanCookie(sessionCookie);
            }

            const updated = await amiStore.update(id, updateData);

            if (!updated) {
                return res.status(404).json({ success: false, error: '凭据不存在' });
            }

            log.info(`[AMI] 更新凭据: ${id}`);
            res.json({ success: true, data: { ...updated, sessionCookie: '***' } });
        } catch (error) {
            log.error(`[AMI] 更新凭据失败: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 删除 AMI 凭据
    app.delete('/api/ami/credentials/:id', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const deleted = await amiStore.delete(id);

            if (!deleted) {
                return res.status(404).json({ success: false, error: '凭据不存在' });
            }

            log.info(`[AMI] 删除凭据: ${id}`);
            res.json({ success: true });
        } catch (error) {
            log.error(`[AMI] 删除凭据失败: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 测试 AMI 凭据
    app.post('/api/ami/credentials/:id/test', async (req, res) => {
        const id = parseInt(req.params.id);
        try {
            const credential = await amiStore.getById(id);

            if (!credential) {
                return res.status(404).json({ success: false, error: '凭据不存在' });
            }
            if (!credential.sessionCookie) {
                return res.status(400).json({ success: false, error: '缺少 sessionCookie' });
            }

            // 自动清洗 cookie
            credential.sessionCookie = cleanCookie(credential.sessionCookie);

            log.info(`[AMI] 开始测试凭据: ${id} (${credential.name})`);
            const service = new AmiService(credential);

            // 如果缺少 projectId 或 chatId，自动创建项目
            if (!credential.projectId || !credential.chatId) {
                log.info(`[AMI] 凭据 ${id} 缺少 projectId/chatId，自动创建项目...`);
                const project = await service.createProject(`API-${credential.name || id}`);
                // 回写到数据库
                await amiStore.update(id, {
                    projectId: project.projectId,
                    chatId: project.chatId,
                });
                log.info(`[AMI] 自动创建项目成功: projectId=${project.projectId}, chatId=${project.chatId}`);
            }

            const testResult = await service.generateContent('claude-sonnet-4', {
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 50,
            });

            // 测试成功：重置错误计数
            await amiStore.resetErrorCount(id);

            log.info(`[AMI] 测试凭据成功: ${id}`);
            res.json({ success: true, message: '凭据有效', response: testResult });
        } catch (error) {
            await amiStore.incrementErrorCount(id, error.message);
            log.error(`[AMI] 测试凭据失败: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 验证 AMI 凭据格式（不发送实际请求）
    app.post('/api/ami/credentials/:id/validate', async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const credential = await amiStore.getById(id);

            if (!credential) {
                return res.status(404).json({ success: false, error: '凭据不存在' });
            }

            const issues = [];

            if (!credential.sessionCookie) {
                issues.push('缺少 sessionCookie');
            }
            if (!credential.projectId) {
                issues.push('缺少 projectId');
            }
            if (!credential.chatId) {
                issues.push('缺少 chatId');
            }

            if (issues.length > 0) {
                return res.json({
                    success: false,
                    valid: false,
                    issues,
                    message: '凭据格式验证失败：' + issues.join('; '),
                });
            }

            res.json({ success: true, valid: true, message: '凭据格式验证通过，可以进行测试' });
        } catch (error) {
            log.error(`[AMI] 验证凭据格式失败: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 批量刷新所有凭据的账户状态（必须在 :id/refresh 之前注册）
    app.post('/api/ami/credentials/refresh-all', async (req, res) => {
        try {
            const all = await amiStore.getAll();
            const results = [];

            for (const cred of all) {
                try {
                    const c = { ...cred, sessionCookie: cleanCookie(cred.sessionCookie) };
                    const service = new AmiService(c);
                    const status = await service.checkAccountStatus();

                    await amiStore.updateAccountStatus(cred.id, {
                        isPaid: status.isPaid,
                        dailyUsage: status.dailyUsage,
                        tokenExpiresHours: status.tokenExpiresHours,
                        status: status.ok ? 'active' : 'error',
                    });
                    if (status.ok) await amiStore.resetErrorCount(cred.id);

                    results.push({ id: cred.id, name: cred.name, success: true, ...status });
                } catch (e) {
                    await amiStore.incrementErrorCount(cred.id, e.message);
                    results.push({ id: cred.id, name: cred.name, success: false, error: e.message });
                }
            }

            res.json({ success: true, total: all.length, data: results });
        } catch (error) {
            log.error(`[AMI] 批量刷新失败: ${error.message}`);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 刷新单个凭据的账户状态
    app.post('/api/ami/credentials/:id/refresh', async (req, res) => {
        const id = parseInt(req.params.id);
        try {
            const credential = await amiStore.getById(id);
            if (!credential) return res.status(404).json({ success: false, error: '凭据不存在' });

            credential.sessionCookie = cleanCookie(credential.sessionCookie);
            const service = new AmiService(credential);
            const status = await service.checkAccountStatus();

            await amiStore.updateAccountStatus(id, {
                isPaid: status.isPaid,
                dailyUsage: status.dailyUsage,
                tokenExpiresHours: status.tokenExpiresHours,
                status: status.ok ? 'active' : 'error',
            });
            if (status.ok) await amiStore.resetErrorCount(id);

            res.json({ success: true, data: status });
        } catch (error) {
            log.error(`[AMI] 刷新凭据 ${id} 状态失败: ${error.message}`);
            await amiStore.incrementErrorCount(id, error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============ 对话 API (Claude 格式) ============

    // 创建可复用的 handler（供 /am/v1/messages 路由和 server.js 的 Model-Provider 路由共用）
    const amiMessagesHandler = createAmiMessagesHandler(amiStore, verifyApiKey);

    app.post('/am/v1/messages', amiMessagesHandler);

    // ============ 模型列表 ============

    app.get('/ami/v1/models', (req, res) => {
        const models = Object.keys(AMI_MODELS).map(id => ({
            id,
            object: 'model',
            created: Date.now(),
            owned_by: 'ami',
            permission: [],
            root: id,
            parent: null,
        }));

        res.json({ object: 'list', data: models });
    });

    log.info('[AMI] 路由已注册');
}

export default setupAmiRoutes;
