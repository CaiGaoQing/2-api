/**
 * DigitalOcean Serverless Inference 路由
 * 提供 OpenAI 兼容的 API 端点
 */

import { DigitalOceanService, resolveModel, DO_MODELS } from './do-service.js';
import { FullAccountStore } from '../db.js';

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
    if (forwarded) {
        return forwarded.split(',')[0].trim();
    }
    return req.headers['x-real-ip'] || req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * 从 full_accounts 表获取 DigitalOcean 凭证
 */
async function getDigitalOceanCredential() {
    const store = await FullAccountStore.create();
    const accounts = await store.getAllActive();

    // 筛选 DigitalOcean 类型的凭证
    const doAccounts = accounts.filter(a => a.type === 'digitalocean' && a.isActive);

    if (doAccounts.length === 0) {
        return null;
    }

    // 简单轮询：随机选择一个
    const selected = doAccounts[Math.floor(Math.random() * doAccounts.length)];
    return selected;
}

/**
 * 设置 DigitalOcean 路由
 */
export function setupDigitalOceanRoutes(app, verifyApiKey, apiLogStore) {

    // ============ 模型列表 ============
    app.get('/do/v1/models', async (req, res) => {
        try {
            const credential = await getDigitalOceanCredential();
            if (!credential) {
                return res.status(503).json({
                    error: { type: 'service_error', message: 'No available DigitalOcean credentials' }
                });
            }

            const service = new DigitalOceanService(credential.credentials.token);
            const result = await service.listModels();
            res.json(result);
        } catch (error) {
            console.error(`[${getTimestamp()}] [DO] 获取模型列表失败: ${error.message}`);
            res.status(500).json({
                error: { type: 'api_error', message: error.message }
            });
        }
    });

    // ============ Chat Completions (OpenAI 兼容) ============
    app.post('/do/v1/chat/completions', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'do_' + Date.now() + Math.random().toString(36).substring(2, 8);
        const clientIp = getClientIp(req);

        let logData = {
            requestId,
            ipAddress: clientIp,
            userAgent: req.headers['user-agent'] || '',
            method: 'POST',
            path: '/do/v1/chat/completions',
            channel: 'DO',
            stream: false,
            inputTokens: 0,
            outputTokens: 0,
            statusCode: 200
        };

        try {
            // API Key 验证（可选）
            const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace(/^bearer\s+/i, '');
            if (apiKey && verifyApiKey) {
                const keyRecord = await verifyApiKey(apiKey);
                if (keyRecord) {
                    logData.apiKeyId = keyRecord.id;
                    logData.apiKeyPrefix = keyRecord.keyPrefix;
                }
            }

            const credential = await getDigitalOceanCredential();
            if (!credential) {
                logData.statusCode = 503;
                logData.errorMessage = 'No available DigitalOcean credentials';
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(503).json({
                    error: { type: 'service_error', message: 'No available DigitalOcean credentials' }
                });
            }

            logData.credentialId = credential.id;
            logData.credentialName = credential.name;

            const { model, messages, stream, temperature, max_tokens, top_p, tools, tool_choice } = req.body;

            // 模型名称映射
            const targetModel = resolveModel(model);
            logData.model = targetModel;
            logData.stream = !!stream;

            // 估算输入 token
            const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);
            logData.inputTokens = inputTokens;

            console.log(`[${getTimestamp()}] [DO] ${requestId} | IP: ${clientIp} | Model: ${model} -> ${targetModel} | Stream: ${!!stream}`);

            const service = new DigitalOceanService(credential.credentials.token);

            if (stream) {
                // 流式响应
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                disableCompressionForSSE(res);

                let outputTokens = 0;

                try {
                    for await (const chunk of service.chatCompletionStream({
                        model: targetModel,
                        messages,
                        temperature,
                        max_tokens,
                        top_p,
                        tools,
                        tool_choice
                    })) {
                        res.write(`data: ${JSON.stringify(chunk)}\n\n`);

                        // 统计输出 token
                        if (chunk.choices?.[0]?.delta?.content) {
                            outputTokens += Math.ceil(chunk.choices[0].delta.content.length / 4);
                        }
                    }

                    res.write('data: [DONE]\n\n');
                    res.end();

                    logData.outputTokens = outputTokens;
                    logData.statusCode = 200;
                    console.log(`[${getTimestamp()}] [DO] ${requestId} | 完成 | ${Date.now() - startTime}ms | in:${inputTokens} out:${outputTokens}`);
                } catch (streamError) {
                    logData.statusCode = 500;
                    logData.errorMessage = streamError.message;
                    res.write(`data: ${JSON.stringify({ error: { message: streamError.message } })}\n\n`);
                    res.end();
                }
            } else {
                // 非流式响应
                const result = await service.chatCompletion({
                    model: targetModel,
                    messages,
                    temperature,
                    max_tokens,
                    top_p,
                    tools,
                    tool_choice
                });

                logData.outputTokens = result.usage?.completion_tokens || 0;
                logData.statusCode = 200;

                console.log(`[${getTimestamp()}] [DO] ${requestId} | 完成 | ${Date.now() - startTime}ms | in:${inputTokens} out:${logData.outputTokens}`);
                res.json(result);
            }

            if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });

        } catch (error) {
            logData.statusCode = 500;
            logData.errorMessage = error.message;
            if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });

            console.error(`[${getTimestamp()}] [DO] ${requestId} | 错误: ${error.message}`);

            if (!res.headersSent) {
                res.status(500).json({
                    error: { type: 'api_error', message: error.message }
                });
            }
        }
    });

    // ============ Responses API (新版) ============
    app.post('/do/v1/responses', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'do_resp_' + Date.now() + Math.random().toString(36).substring(2, 8);

        try {
            const credential = await getDigitalOceanCredential();
            if (!credential) {
                return res.status(503).json({
                    error: { type: 'service_error', message: 'No available DigitalOcean credentials' }
                });
            }

            const { model, input, max_output_tokens, temperature, stream } = req.body;
            const targetModel = resolveModel(model);

            console.log(`[${getTimestamp()}] [DO] ${requestId} | Responses API | Model: ${targetModel}`);

            const service = new DigitalOceanService(credential.credentials.token);
            const result = await service.responses({
                model: targetModel,
                input,
                max_output_tokens,
                temperature,
                stream
            });

            console.log(`[${getTimestamp()}] [DO] ${requestId} | 完成 | ${Date.now() - startTime}ms`);
            res.json(result);

        } catch (error) {
            console.error(`[${getTimestamp()}] [DO] ${requestId} | 错误: ${error.message}`);
            res.status(500).json({
                error: { type: 'api_error', message: error.message }
            });
        }
    });

    // ============ 图像生成 ============
    app.post('/do/v1/images/generations', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'do_img_' + Date.now() + Math.random().toString(36).substring(2, 8);

        try {
            const credential = await getDigitalOceanCredential();
            if (!credential) {
                return res.status(503).json({
                    error: { type: 'service_error', message: 'No available DigitalOcean credentials' }
                });
            }

            const { model, prompt, n, size } = req.body;

            console.log(`[${getTimestamp()}] [DO] ${requestId} | 图像生成 | Model: ${model || 'openai-gpt-image-1'} | Prompt: ${prompt?.substring(0, 50)}...`);

            const service = new DigitalOceanService(credential.credentials.token);
            const result = await service.generateImage({ model, prompt, n, size });

            console.log(`[${getTimestamp()}] [DO] ${requestId} | 完成 | ${Date.now() - startTime}ms`);
            res.json(result);

        } catch (error) {
            console.error(`[${getTimestamp()}] [DO] ${requestId} | 错误: ${error.message}`);
            res.status(500).json({
                error: { type: 'api_error', message: error.message }
            });
        }
    });

    // ============ 异步调用 (fal 模型) ============
    app.post('/do/v1/async-invoke', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'do_async_' + Date.now() + Math.random().toString(36).substring(2, 8);

        try {
            const credential = await getDigitalOceanCredential();
            if (!credential) {
                return res.status(503).json({
                    error: { type: 'service_error', message: 'No available DigitalOcean credentials' }
                });
            }

            const { model_id, input, tags } = req.body;

            console.log(`[${getTimestamp()}] [DO] ${requestId} | 异步调用 | Model: ${model_id}`);

            const service = new DigitalOceanService(credential.credentials.token);
            const result = await service.asyncInvoke({ model_id, input, tags });

            console.log(`[${getTimestamp()}] [DO] ${requestId} | 已提交 | request_id: ${result.request_id}`);
            res.json(result);
        } catch (error) {
            console.error(`[${getTimestamp()}] [DO] ${requestId} | 错误: ${error.message}`);
            res.status(500).json({
                error: { type: 'api_error', message: error.message }
            });
        }
    });

    // 获取异步任务状态
    app.get('/do/v1/async-invoke/:requestId/status', async (req, res) => {
        try {
            const credential = await getDigitalOceanCredential();
            if (!credential) {
                return res.status(503).json({
                    error: { type: 'service_error', message: 'No available DigitalOcean credentials' }
                });
            }

            const service = new DigitalOceanService(credential.credentials.token);
            const result = await service.getAsyncStatus(req.params.requestId);
            res.json(result);

        } catch (error) {
            res.status(500).json({
                error: { type: 'api_error', message: error.message }
            });
        }
    });

    // 获取异步任务结果
    app.get('/do/v1/async-invoke/:requestId', async (req, res) => {
        try {
            const credential = await getDigitalOceanCredential();
            if (!credential) {
                return res.status(503).json({
                    error: { type: 'service_error', message: 'No available DigitalOcean credentials' }
                });
            }

            const service = new DigitalOceanService(credential.credentials.token);
            const result = await service.getAsyncResult(req.params.requestId);
            res.json(result);

        } catch (error) {
            res.status(500).json({
                error: { type: 'api_error', message: error.message }
            });
        }
    });

    // ============ Claude 格式兼容 ============
    app.post('/do/v1/messages', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'do_claude_' + Date.now() + Math.random().toString(36).substring(2, 8);
        const clientIp = getClientIp(req);

        try {
            const credential = await getDigitalOceanCredential();
            if (!credential) {
                return res.status(503).json({
                    error: { type: 'service_error', message: 'No available DigitalOcean credentials' }
                });
            }

            const { model, messages, stream, system, max_tokens, temperature } = req.body;

            // 模型映射
            const targetModel = resolveModel(model);

            // 转换 Claude 格式消息到 OpenAI 格式
            const openaiMessages = [];

            // 添加 system 消息
            if (system) {
                const systemText = typeof system === 'string'
                    ? system
                    : (Array.isArray(system) ? system.map(s => s.text || s).join('\n') : String(system));
                openaiMessages.push({ role: 'system', content: systemText });
            }

            // 转换消息
            for (const msg of messages) {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    let content = msg.content;
                    if (Array.isArray(content)) {
                        content = content.map(c => c.type === 'text' ? c.text : '').join('');
                    }
                    openaiMessages.push({ role: msg.role, content });
                }
            }

            console.log(`[${getTimestamp()}] [DO] ${requestId} | Claude 格式 | IP: ${clientIp} | Model: ${model} -> ${targetModel} | Stream: ${!!stream}`);

            const service = new DigitalOceanService(credential.credentials.token);
            const messageId = 'msg_' + Date.now() + Math.random().toString(36).substring(2, 8);
            const inputTokens = Math.ceil(JSON.stringify(messages).length / 4);

            if (stream) {
                // 流式响应 - Claude 格式
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                disableCompressionForSSE(res);

                // 发送 message_start
                res.write(`event: message_start\ndata: ${JSON.stringify({
                    type: 'message_start',
                    message: {
                        id: messageId,
                        type: 'message',
                        role: 'assistant',
                        content: [],
                        model: model,
                        stop_reason: null,
                        usage: { input_tokens: inputTokens, output_tokens: 0 }
                    }
                })}\n\n`);

                // 发送 content_block_start
                res.write(`event: content_block_start\ndata: ${JSON.stringify({
                    type: 'content_block_start',
                    index: 0,
                    content_block: { type: 'text', text: '' }
                })}\n\n`);

                let outputTokens = 0;
                let fullText = '';

                try {
                    for await (const chunk of service.chatCompletionStream({
                        model: targetModel,
                        messages: openaiMessages,
                        temperature,
                        max_tokens
                    })) {
                        const text = chunk.choices?.[0]?.delta?.content || '';
                        if (text) {
                            fullText += text;
                            outputTokens += Math.ceil(text.length / 4);

                            res.write(`event: content_block_delta\ndata: ${JSON.stringify({
                                type: 'content_block_delta',
                                index: 0,
                                delta: { type: 'text_delta', text }
                            })}\n\n`);
                        }
                    }

                    // 发送结束事件
                    res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
                    res.write(`event: message_delta\ndata: ${JSON.stringify({
                        type: 'message_delta',
                        delta: { stop_reason: 'end_turn' },
                        usage: { output_tokens: outputTokens }
                    })}\n\n`);
                    res.write(`event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
                    res.end();

                    console.log(`[${getTimestamp()}] [DO] ${requestId} | 完成 | ${Date.now() - startTime}ms | in:${inputTokens} out:${outputTokens}`);

                } catch (streamError) {
                    res.write(`event: error\ndata: ${JSON.stringify({ type: 'error', error: { message: streamError.message } })}\n\n`);
                    res.end();
                }

            } else {
                // 非流式响应 - Claude 格式
                const result = await service.chatCompletion({
                    model: targetModel,
                    messages: openaiMessages,
                    temperature,
                    max_tokens
                });

                const responseText = result.choices?.[0]?.message?.content || '';
                const outputTokens = result.usage?.completion_tokens || Math.ceil(responseText.length / 4);

                console.log(`[${getTimestamp()}] [DO] ${requestId} | 完成 | ${Date.now() - startTime}ms | in:${inputTokens} out:${outputTokens}`);

                res.json({
                    id: messageId,
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'text', text: responseText }],
                    model: model,
                    stop_reason: 'end_turn',
                    usage: {
                        input_tokens: inputTokens,
                        output_tokens: outputTokens
                    }
                });
            }

        } catch (error) {
            console.error(`[${getTimestamp()}] [DO] ${requestId} | 错误: ${error.message}`);

            if (!res.headersSent) {
                res.status(500).json({
                    error: { type: 'api_error', message: error.message }
                });
            }
        }
    });

    console.log(`[${getTimestamp()}] DigitalOcean 路由已注册:`);
    console.log(`[${getTimestamp()}]   GET  /do/v1/models`);
    console.log(`[${getTimestamp()}]   POST /do/v1/chat/completions`);
    console.log(`[${getTimestamp()}]   POST /do/v1/messages (Claude 格式)`);
    console.log(`[${getTimestamp()}]   POST /do/v1/responses`);
    console.log(`[${getTimestamp()}]   POST /do/v1/images/generations`);
    console.log(`[${getTimestamp()}]   POST /do/v1/async-invoke`);
}

export default setupDigitalOceanRoutes;
