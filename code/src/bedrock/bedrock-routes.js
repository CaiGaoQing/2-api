/**
 * Amazon Bedrock API 路由
 */
import express from 'express';
import { BedrockCredentialStore, ApiLogStore } from '../db.js';
import { BedrockClient, BedrockAPI } from './bedrock.js';
import { BEDROCK_CONSTANTS, BEDROCK_MODELS, BEDROCK_MODEL_MAPPING, calculateTokenCost } from '../constants.js';
import { logger } from '../logger.js';

const log = logger.api;
const router = express.Router();

// ==================== 凭据管理 API ====================

/**
 * 获取所有 Bedrock 凭据
 */
router.get('/credentials', async (req, res) => {
    try {
        const store = await BedrockCredentialStore.create();
        const credentials = await store.getAll();

        // 隐藏敏感信息
        const safeCredentials = credentials.map(cred => ({
            ...cred,
            accessKeyId: cred.accessKeyId ? cred.accessKeyId.substring(0, 8) + '****' : null,
            secretAccessKey: cred.secretAccessKey ? '********' : null,
            sessionToken: cred.sessionToken ? '****' : null,
            bearerToken: cred.bearerToken ? cred.bearerToken.substring(0, 10) + '****' : null
        }));

        res.json({ success: true, data: safeCredentials });
    } catch (error) {
        log.error(`获取 Bedrock 凭据列表失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取单个 Bedrock 凭据
 */
router.get('/credentials/:id', async (req, res) => {
    try {
        const store = await BedrockCredentialStore.create();
        const credential = await store.getById(parseInt(req.params.id));

        if (!credential) {
            return res.status(404).json({ success: false, error: '凭据不存在' });
        }

        // 隐藏敏感信息
        const safeCredential = {
            ...credential,
            accessKeyId: credential.accessKeyId ? credential.accessKeyId.substring(0, 8) + '****' : null,
            secretAccessKey: credential.secretAccessKey ? '********' : null,
            sessionToken: credential.sessionToken ? '****' : null,
            bearerToken: credential.bearerToken ? credential.bearerToken.substring(0, 10) + '****' : null
        };

        res.json({ success: true, data: safeCredential });
    } catch (error) {
        log.error(`获取 Bedrock 凭据失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 添加 Bedrock 凭据
 */
router.post('/credentials', async (req, res) => {
    try {
        const { name, accessKeyId, secretAccessKey, sessionToken, bearerToken, region } = req.body;

        // 验证：需要 Bearer Token 或 IAM 凭证
        if (!name) {
            return res.status(400).json({ success: false, error: '缺少必要参数: name' });
        }

        if (!bearerToken && (!accessKeyId || !secretAccessKey)) {
            return res.status(400).json({ success: false, error: '需要提供 bearerToken 或 (accessKeyId + secretAccessKey)' });
        }

        const store = await BedrockCredentialStore.create();

        // 检查名称是否已存在
        const existing = await store.getByName(name);
        if (existing) {
            return res.status(400).json({ success: false, error: `名称 "${name}" 已存在` });
        }

        const id = await store.add({
            name,
            accessKeyId,
            secretAccessKey,
            sessionToken,
            bearerToken,
            region: region || BEDROCK_CONSTANTS.DEFAULT_REGION
        });

        log.info(`添加 Bedrock 凭据成功: ${name} (ID: ${id}, 认证方式: ${bearerToken ? 'Bearer Token' : 'IAM'})`);
        res.json({ success: true, data: { id, name } });
    } catch (error) {
        log.error(`添加 Bedrock 凭据失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 更新 Bedrock 凭据
 */
router.put('/credentials/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();

        const existing = await store.getById(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: '凭据不存在' });
        }

        const updates = {};
        if (req.body.name !== undefined) updates.name = req.body.name;
        if (req.body.accessKeyId !== undefined) updates.accessKeyId = req.body.accessKeyId;
        if (req.body.secretAccessKey !== undefined) updates.secretAccessKey = req.body.secretAccessKey;
        if (req.body.sessionToken !== undefined) updates.sessionToken = req.body.sessionToken;
        if (req.body.bearerToken !== undefined) updates.bearerToken = req.body.bearerToken;
        if (req.body.region !== undefined) updates.region = req.body.region;
        if (req.body.isActive !== undefined) updates.isActive = req.body.isActive;

        await store.update(id, updates);

        log.info(`更新 Bedrock 凭据成功: ID ${id}`);
        res.json({ success: true });
    } catch (error) {
        log.error(`更新 Bedrock 凭据失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 删除 Bedrock 凭据
 */
router.delete('/credentials/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();
        
        const existing = await store.getById(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: '凭据不存在' });
        }
        
        await store.delete(id);
        
        log.info(`删除 Bedrock 凭据成功: ${existing.name} (ID: ${id})`);
        res.json({ success: true });
    } catch (error) {
        log.error(`删除 Bedrock 凭据失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 激活 Bedrock 凭据
 */
router.post('/credentials/:id/activate', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();
        
        const existing = await store.getById(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: '凭据不存在' });
        }
        
        await store.update(id, { isActive: true });
        
        log.info(`激活 Bedrock 凭据成功: ${existing.name} (ID: ${id})`);
        res.json({ success: true });
    } catch (error) {
        log.error(`激活 Bedrock 凭据失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 停用 Bedrock 凭据
 */
router.post('/credentials/:id/deactivate', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();
        
        const existing = await store.getById(id);
        if (!existing) {
            return res.status(404).json({ success: false, error: '凭据不存在' });
        }
        
        await store.update(id, { isActive: false });
        
        log.info(`停用 Bedrock 凭据成功: ${existing.name} (ID: ${id})`);
        res.json({ success: true });
    } catch (error) {
        log.error(`停用 Bedrock 凭据失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 测试 Bedrock 凭据
 */
router.post('/credentials/:id/test', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();
        
        const credential = await store.getById(id);
        if (!credential) {
            return res.status(404).json({ success: false, error: '凭据不存在' });
        }
        
        // 使用简单消息测试
        const client = BedrockClient.fromCredentials(credential);
        const response = await client.chat(
            [{ role: 'user', content: 'Hi, respond with just "OK".' }],
            'claude-3-haiku-20240307',
            { max_tokens: 10 }
        );
        
        // 重置错误计数
        await store.resetErrorCount(id);
        
        log.info(`测试 Bedrock 凭据成功: ${credential.name} (ID: ${id})`);
        res.json({
            success: true,
            data: {
                response: response.content?.[0]?.text || 'OK',
                usage: response.usage
            }
        });
    } catch (error) {
        const id = parseInt(req.params.id);
        const store = await BedrockCredentialStore.create();
        await store.incrementErrorCount(id, error.message);
        
        log.error(`测试 Bedrock 凭据失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 获取 Bedrock 凭据统计
 */
router.get('/statistics', async (req, res) => {
    try {
        const store = await BedrockCredentialStore.create();
        const stats = await store.getStatistics();
        res.json({ success: true, data: stats });
    } catch (error) {
        log.error(`获取 Bedrock 统计失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==================== 模型和区域信息 ====================

/**
 * 获取支持的模型列表
 */
router.get('/models', (req, res) => {
    res.json({
        success: true,
        data: BEDROCK_MODELS,
        mapping: BEDROCK_MODEL_MAPPING
    });
});

/**
 * 获取支持的区域列表
 */
router.get('/regions', (req, res) => {
    res.json({
        success: true,
        data: BEDROCK_CONSTANTS.SUPPORTED_REGIONS
    });
});

// ==================== 聊天 API ====================

/**
 * 聊天接口（非流式）- 使用指定凭据
 */
router.post('/chat/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { messages, model, system, max_tokens, temperature, tools } = req.body;
        
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: '缺少 messages 参数' });
        }
        
        const store = await BedrockCredentialStore.create();
        const credential = await store.getById(id);
        
        if (!credential) {
            return res.status(404).json({ success: false, error: '凭据不存在' });
        }
        
        if (!credential.isActive) {
            return res.status(400).json({ success: false, error: '凭据已停用' });
        }
        
        const client = BedrockClient.fromCredentials(credential);
        const modelToUse = model || BEDROCK_CONSTANTS.DEFAULT_MODEL;
        const response = await client.chat(messages, modelToUse, {
            system,
            max_tokens,
            temperature,
            tools
        });

        // 更新使用计数和 token 统计
        await store.incrementUseCount(id);
        if (response.usage) {
            const inputTokens = response.usage.input_tokens || 0;
            const outputTokens = response.usage.output_tokens || 0;
            const { totalCost } = calculateTokenCost(modelToUse, inputTokens, outputTokens);
            await store.updateTokenStats(id, inputTokens, outputTokens, totalCost);
        }

        res.json(response);
    } catch (error) {
        log.error(`Bedrock 聊天失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 聊天接口（流式）- 使用指定凭据
 */
router.post('/chat/:id/stream', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { messages, model, system, max_tokens, temperature, tools } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: '缺少 messages 参数' });
        }

        const store = await BedrockCredentialStore.create();
        const credential = await store.getById(id);

        if (!credential) {
            return res.status(404).json({ success: false, error: '凭据不存在' });
        }

        if (!credential.isActive) {
            return res.status(400).json({ success: false, error: '凭据已停用' });
        }

        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const client = BedrockClient.fromCredentials(credential);
        const modelToUse = model || BEDROCK_CONSTANTS.DEFAULT_MODEL;
        let inputTokens = 0;
        let outputTokens = 0;

        for await (const event of client.chatStream(messages, modelToUse, {
            system,
            max_tokens,
            temperature,
            tools
        })) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            // 捕获 token 统计
            if (event.type === 'message_delta' && event.usage) {
                inputTokens = event.usage.input_tokens || inputTokens;
                outputTokens = event.usage.output_tokens || outputTokens;
            }
        }

        // 更新使用计数和 token 统计
        await store.incrementUseCount(id);
        if (inputTokens > 0 || outputTokens > 0) {
            const { totalCost } = calculateTokenCost(modelToUse, inputTokens, outputTokens);
            await store.updateTokenStats(id, inputTokens, outputTokens, totalCost);
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        log.error(`Bedrock 流式聊天失败: ${error.message}`);

        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    }
});

/**
 * 使用随机活跃凭据聊天（非流式）
 */
router.post('/chat', async (req, res) => {
    try {
        const { messages, model, system, max_tokens, temperature, tools } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: '缺少 messages 参数' });
        }

        const store = await BedrockCredentialStore.create();
        const credential = await store.getRandomActive();

        if (!credential) {
            return res.status(400).json({ success: false, error: '没有可用的 Bedrock 凭据' });
        }

        const client = BedrockClient.fromCredentials(credential);
        const modelToUse = model || BEDROCK_CONSTANTS.DEFAULT_MODEL;
        const response = await client.chat(messages, modelToUse, {
            system,
            max_tokens,
            temperature,
            tools
        });

        // 更新使用计数和 token 统计
        await store.incrementUseCount(credential.id);
        if (response.usage) {
            const inputTokens = response.usage.input_tokens || 0;
            const outputTokens = response.usage.output_tokens || 0;
            const { totalCost } = calculateTokenCost(modelToUse, inputTokens, outputTokens);
            await store.updateTokenStats(credential.id, inputTokens, outputTokens, totalCost);
        }

        res.json(response);
    } catch (error) {
        log.error(`Bedrock 聊天失败: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * 使用随机活跃凭据聊天（流式）
 */
router.post('/chat/stream', async (req, res) => {
    try {
        const { messages, model, system, max_tokens, temperature, tools } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ success: false, error: '缺少 messages 参数' });
        }

        const store = await BedrockCredentialStore.create();
        const credential = await store.getRandomActive();

        if (!credential) {
            return res.status(400).json({ success: false, error: '没有可用的 Bedrock 凭据' });
        }

        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const client = BedrockClient.fromCredentials(credential);
        const modelToUse = model || BEDROCK_CONSTANTS.DEFAULT_MODEL;
        let inputTokens = 0;
        let outputTokens = 0;

        for await (const event of client.chatStream(messages, modelToUse, {
            system,
            max_tokens,
            temperature,
            tools
        })) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            // 捕获 token 统计
            if (event.type === 'message_delta' && event.usage) {
                inputTokens = event.usage.input_tokens || inputTokens;
                outputTokens = event.usage.output_tokens || outputTokens;
            }
        }

        // 更新使用计数和 token 统计
        await store.incrementUseCount(credential.id);
        if (inputTokens > 0 || outputTokens > 0) {
            const { totalCost } = calculateTokenCost(modelToUse, inputTokens, outputTokens);
            await store.updateTokenStats(credential.id, inputTokens, outputTokens, totalCost);
        }

        res.write('data: [DONE]\n\n');
        res.end();
    } catch (error) {
        log.error(`Bedrock 流式聊天失败: ${error.message}`);

        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message });
        } else {
            res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    }
});

// ==================== Claude API 兼容端点 (/v1/messages) ====================

/**
 * Claude API 兼容端点 - /v1/messages
 * 支持流式和非流式响应
 */
router.post('/v1/messages', async (req, res) => {
    const startTime = Date.now();
    const requestId = 'bedrock_' + Date.now() + Math.random().toString(36).substring(2, 8);
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    let apiLogStore = null;
    let logData = {
        requestId,
        ipAddress: clientIp,
        userAgent: req.headers['user-agent'] || '',
        method: 'POST',
        path: '/bedrock/v1/messages',
        channel: 'Bedrock',
        stream: false,
        inputTokens: 0,
        outputTokens: 0,
        statusCode: 200
    };

    try {
        apiLogStore = await ApiLogStore.create();
    } catch (e) { /* ignore */ }

    try {
        const { messages, model, system, max_tokens, temperature, top_p, stop_sequences, tools, stream } = req.body;

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({
                type: 'error',
                error: {
                    type: 'invalid_request_error',
                    message: 'messages is required and must be an array'
                }
            });
        }

        const store = await BedrockCredentialStore.create();
        const credential = await store.getRandomActive();

        if (!credential) {
            return res.status(503).json({
                type: 'error',
                error: {
                    type: 'api_error',
                    message: 'No available Bedrock credentials'
                }
            });
        }

        const client = BedrockClient.fromCredentials(credential);
        const modelToUse = model || BEDROCK_CONSTANTS.DEFAULT_MODEL;
        const options = {
            system,
            max_tokens: max_tokens || 4096,
            temperature,
            top_p,
            stop_sequences,
            tools
        };

        if (stream) {
            // 流式响应
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            const messageId = 'msg_' + Date.now() + Math.random().toString(36).substring(2, 8);
            let inputTokens = 0;
            let outputTokens = 0;
            let contentBlockIndex = 0;

            // 发送 message_start 事件
            res.write(`event: message_start\ndata: ${JSON.stringify({
                type: 'message_start',
                message: {
                    id: messageId,
                    type: 'message',
                    role: 'assistant',
                    content: [],
                    model: modelToUse,
                    stop_reason: null,
                    stop_sequence: null,
                    usage: { input_tokens: 0, output_tokens: 0 }
                }
            })}\n\n`);

            // 发送 content_block_start 事件
            res.write(`event: content_block_start\ndata: ${JSON.stringify({
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: { type: 'text', text: '' }
            })}\n\n`);

            try {
                for await (const event of client.chatStream(messages, modelToUse, options)) {
                    if (event.type === 'content_block_delta' && event.delta?.text) {
                        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                            type: 'content_block_delta',
                            index: contentBlockIndex,
                            delta: { type: 'text_delta', text: event.delta.text }
                        })}\n\n`);
                    } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                        // 结束当前文本块
                        res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                            type: 'content_block_stop',
                            index: contentBlockIndex
                        })}\n\n`);
                        contentBlockIndex++;
                        // 开始工具使用块
                        res.write(`event: content_block_start\ndata: ${JSON.stringify({
                            type: 'content_block_start',
                            index: contentBlockIndex,
                            content_block: event.content_block
                        })}\n\n`);
                    } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
                        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                            type: 'content_block_delta',
                            index: contentBlockIndex,
                            delta: event.delta
                        })}\n\n`);
                    } else if (event.type === 'message_delta' && event.usage) {
                        inputTokens = event.usage.input_tokens || inputTokens;
                        outputTokens = event.usage.output_tokens || outputTokens;
                    }
                }

                // 发送 content_block_stop 事件
                res.write(`event: content_block_stop\ndata: ${JSON.stringify({
                    type: 'content_block_stop',
                    index: contentBlockIndex
                })}\n\n`);

                // 发送 message_delta 事件
                res.write(`event: message_delta\ndata: ${JSON.stringify({
                    type: 'message_delta',
                    delta: { stop_reason: 'end_turn', stop_sequence: null },
                    usage: { output_tokens: outputTokens }
                })}\n\n`);

                // 发送 message_stop 事件
                res.write(`event: message_stop\ndata: ${JSON.stringify({
                    type: 'message_stop'
                })}\n\n`);

                // 更新使用计数和 token 统计
                await store.incrementUseCount(credential.id);
                if (inputTokens > 0 || outputTokens > 0) {
                    const { totalCost } = calculateTokenCost(modelToUse, inputTokens, outputTokens);
                    await store.updateTokenStats(credential.id, inputTokens, outputTokens, totalCost);
                }

                // 记录成功日志
                logData.credentialId = credential.id;
                logData.credentialName = credential.name;
                logData.model = modelToUse;
                logData.stream = true;
                logData.inputTokens = inputTokens;
                logData.outputTokens = outputTokens;
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });

            } catch (streamError) {
                log.error(`Bedrock 流式响应错误: ${streamError.message}`);
                res.write(`event: error\ndata: ${JSON.stringify({
                    type: 'error',
                    error: { type: 'api_error', message: streamError.message }
                })}\n\n`);
            }

            // 记录流式错误日志（如果上面 catch 了 streamError）
            res.end();
        } else {
            // 非流式响应
            const response = await client.chat(messages, modelToUse, options);

            // 更新使用计数和 token 统计
            await store.incrementUseCount(credential.id);
            const inTok = response.usage?.input_tokens || 0;
            const outTok = response.usage?.output_tokens || 0;
            if (inTok > 0 || outTok > 0) {
                const { totalCost } = calculateTokenCost(modelToUse, inTok, outTok);
                await store.updateTokenStats(credential.id, inTok, outTok, totalCost);
            }

            // 记录成功日志
            logData.credentialId = credential.id;
            logData.credentialName = credential.name;
            logData.model = modelToUse;
            logData.inputTokens = inTok;
            logData.outputTokens = outTok;
            if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });

            res.json(response);
        }
    } catch (error) {
        log.error(`Bedrock /v1/messages 失败: ${error.message}`);

        logData.statusCode = error.response?.status || 500;
        logData.errorMessage = error.message;
        if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });

        if (!res.headersSent) {
            const statusCode = error.response?.status || 500;
            res.status(statusCode).json({
                type: 'error',
                error: {
                    type: 'api_error',
                    message: error.message
                }
            });
        }
    }
});

export default router;
