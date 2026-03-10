/**
 * Codex 路由模块
 */
import { CodexCredentialStore } from '../db.js';
import { CodexService, CODEX_MODELS, getActiveModels, disableModel, enableModel, resetDisabledModels, getDisabledModels, isModelDisabled } from './codex-service.js';
import { startCodexOAuth, completeCodexOAuth, refreshCodexToken } from './codex-auth.js';

// 可选导入：注册模块（Docker 容器中可能不存在）
let registerModule = null;
try {
    registerModule = await import('../../../register/codex/codex-register.js');
} catch (e) {
    console.log('[Codex] 注册模块未找到，注册功能不可用');
}

const {
    startCodexRegisterTask = () => { throw new Error('注册功能不可用'); },
    getCodexRegisterTask = () => null,
    getAllCodexRegisterTasks = () => [],
    cancelCodexRegisterTask = () => false,
    REGISTER_CONFIG = {},
    startLoginTask = () => { throw new Error('登录功能不可用'); },
    getLoginTask = () => null,
    getAllLoginTasks = () => []
} = registerModule || {};

/**
 * 从 formatUsage 结果提取数据库存储所需的字段
 */
function extractUsageForDb(usage) {
    if (!usage) return {};
    return {
        usagePercent: usage.summary?.usedPercent || 0,
        usageResetAt: usage.summary?.resetTime || null,
        planType: usage.planType || null,
        primaryUsagePercent: usage.primaryWindow?.usedPercent ?? null,
        primaryResetAt: usage.primaryWindow?.resetAtTimestamp ?? null,
        secondaryUsagePercent: usage.secondaryWindow?.usedPercent ?? null,
        secondaryResetAt: usage.secondaryWindow?.resetAtTimestamp ?? null
    };
}

/**
 * 设置 Codex 路由
 * @param {Object} app - Express 应用
 * @param {Function} authMiddleware - 管理后台认证中间件
 * @param {Function} verifyApiKey - API Key 验证函数
 * @param {Object} apiLogStore - API 日志存储
 */
export function setupCodexRoutes(app, authMiddleware, verifyApiKey, apiLogStore) {
    // ============ Codex 凭证管理 API ============

    // 获取所有凭证
    app.get('/api/codex/credentials', authMiddleware, async (req, res) => {
        try {
            const store = await CodexCredentialStore.create();
            const credentials = await store.getAll();
            const safeCredentials = credentials.map(c => ({
                ...c,
                accessToken: c.accessToken ? '***' : null,
                refreshToken: c.refreshToken ? '***' : null,
                idToken: c.idToken ? '***' : null
            }));
            res.json({ success: true, data: safeCredentials });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 获取单个凭证
    app.get('/api/codex/credentials/:id', authMiddleware, async (req, res) => {
        try {
            const store = await CodexCredentialStore.create();
            const credential = await store.getById(parseInt(req.params.id));
            if (!credential) {
                return res.status(404).json({ success: false, error: '凭证不存在' });
            }
            res.json({
                success: true,
                data: {
                    ...credential,
                    accessToken: credential.accessToken ? '***' : null,
                    refreshToken: credential.refreshToken ? '***' : null,
                    idToken: credential.idToken ? '***' : null
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 创建凭证
    app.post('/api/codex/credentials', authMiddleware, async (req, res) => {
        try {
            const { name, refreshToken, email, accountId, note } = req.body;
            if (!name || !refreshToken) {
                return res.status(400).json({ success: false, error: '名称和 refreshToken 是必填项' });
            }
            const store = await CodexCredentialStore.create();
            const existing = await store.getByName(name);
            if (existing) {
                return res.status(400).json({ success: false, error: '凭证名称已存在' });
            }
            const id = await store.create({ name, refreshToken, email: email || null, accountId: accountId || null, note: note || null });
            res.json({ success: true, data: { id }, message: '凭证创建成功' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 更新凭证
    app.put('/api/codex/credentials/:id', authMiddleware, async (req, res) => {
        try {
            const store = await CodexCredentialStore.create();
            const credential = await store.getById(parseInt(req.params.id));
            if (!credential) {
                return res.status(404).json({ success: false, error: '凭证不存在' });
            }
            await store.update(parseInt(req.params.id), req.body);
            res.json({ success: true, message: '凭证更新成功' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 删除凭证
    app.delete('/api/codex/credentials/:id', authMiddleware, async (req, res) => {
        try {
            const store = await CodexCredentialStore.create();
            await store.delete(parseInt(req.params.id));
            res.json({ success: true, message: '凭证删除成功' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 刷新凭证 Token
    app.post('/api/codex/credentials/:id/refresh', authMiddleware, async (req, res) => {
        try {
            const store = await CodexCredentialStore.create();
            const credential = await store.getById(parseInt(req.params.id));
            if (!credential) {
                return res.status(404).json({ success: false, error: '凭证不存在' });
            }
            const newTokens = await refreshCodexToken(credential.refreshToken);
            await store.updateTokens(credential.id, newTokens);
            res.json({ success: true, message: 'Token 刷新成功', data: { email: newTokens.email, expiresAt: newTokens.expiresAt } });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 批量刷新所有凭证 Token
    app.post('/api/codex/credentials/batch-refresh', authMiddleware, async (req, res) => {
        try {
            const store = await CodexCredentialStore.create();
            const credentials = await store.getAll();
            
            if (credentials.length === 0) {
                return res.json({ success: true, message: '没有凭证需要刷新', data: { total: 0, success: 0, failed: 0 } });
            }

            const results = { total: credentials.length, success: 0, failed: 0, details: [] };

            for (const credential of credentials) {
                try {
                    if (!credential.refreshToken) {
                        results.failed++;
                        results.details.push({ id: credential.id, email: credential.email, status: 'skipped', error: '无 refreshToken' });
                        continue;
                    }
                    const newTokens = await refreshCodexToken(credential.refreshToken);
                    await store.updateTokens(credential.id, newTokens);
                    results.success++;
                    results.details.push({ id: credential.id, email: credential.email || credential.name, status: 'success' });
                } catch (err) {
                    results.failed++;
                    results.details.push({ id: credential.id, email: credential.email || credential.name, status: 'failed', error: err.message });
                }
            }

            res.json({ 
                success: true, 
                message: `批量刷新完成: 成功 ${results.success}, 失败 ${results.failed}`,
                data: results 
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 测试凭证
    app.post('/api/codex/credentials/:id/test', authMiddleware, async (req, res) => {
        try {
            const service = await CodexService.fromDatabase(parseInt(req.params.id));
            const result = await service.testCredential();
            res.json({ success: result.success, message: result.message });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 获取凭证使用限制
    app.get('/api/codex/credentials/:id/usage', authMiddleware, async (req, res) => {
        try {
            const service = await CodexService.fromDatabase(parseInt(req.params.id));
            const usage = await service.getUsageLimits();
            res.json({ success: true, data: usage });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 获取统计信息
    app.get('/api/codex/statistics', authMiddleware, async (req, res) => {
        try {
            const store = await CodexCredentialStore.create();
            const stats = await store.getStatistics();
            res.json({ success: true, data: stats });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 获取单个凭证的用量（从 API 获取并更新数据库）
    app.get('/api/codex/credentials/:id/usage', authMiddleware, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const store = await CodexCredentialStore.create();
            const service = await CodexService.fromDatabase(id);
            const usage = await service.getUsageLimits();
            
            // 更新数据库中的用量信息
            if (usage) {
                await store.updateUsage(id, extractUsageForDb(usage));
            }
            
            res.json({ success: true, data: usage });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 刷新单个凭证的用量（获取最新用量并更新数据库）
    app.post('/api/codex/credentials/:id/refresh-usage', authMiddleware, async (req, res) => {
        try {
            const id = parseInt(req.params.id);
            const store = await CodexCredentialStore.create();
            const service = await CodexService.fromDatabase(id);
            const usage = await service.getUsageLimits();
            
            // 更新数据库中的用量信息
            if (usage) {
                await store.updateUsage(id, extractUsageForDb(usage));
            }
            
            // 返回更新后的凭证信息
            const updatedCredential = await store.getById(id);
            res.json({ success: true, data: updatedCredential, usage });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 获取所有凭证的用量（从数据库读取缓存的用量）
    app.get('/api/codex/usage', authMiddleware, async (req, res) => {
        try {
            const store = await CodexCredentialStore.create();
            const credentials = await store.getAll();
            
            const results = {
                timestamp: new Date().toISOString(),
                total: credentials.length,
                usages: credentials.map(c => ({
                    id: c.id,
                    email: c.email || c.name,
                    usagePercent: c.usagePercent,
                    usageResetAt: c.usageResetAt,
                    planType: c.planType,
                    primaryUsagePercent: c.primaryUsagePercent,
                    primaryResetAt: c.primaryResetAt,
                    secondaryUsagePercent: c.secondaryUsagePercent,
                    secondaryResetAt: c.secondaryResetAt,
                    quotaError: c.quotaError,
                    usageUpdatedAt: c.usageUpdatedAt
                }))
            };

            res.json({ success: true, data: results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 批量刷新所有凭证的用量（从 API 获取并更新数据库）
    app.post('/api/codex/usage/refresh', authMiddleware, async (req, res) => {
        try {
            const store = await CodexCredentialStore.create();
            const credentials = await store.getAll();
            
            const results = {
                timestamp: new Date().toISOString(),
                total: credentials.length,
                success: 0,
                failed: 0,
                usages: []
            };

            // 并发获取所有凭证的用量
            const usagePromises = credentials.map(async (credential) => {
                try {
                    const service = new CodexService(credential);
                    const usage = await service.getUsageLimits();
                    
                    // 更新数据库
                    if (usage) {
                        await store.updateUsage(credential.id, extractUsageForDb(usage));
                    }
                    
                    return { 
                        id: credential.id, 
                        email: credential.email || credential.name,
                        success: true, 
                        usage 
                    };
                } catch (error) {
                    return { 
                        id: credential.id, 
                        email: credential.email || credential.name,
                        success: false, 
                        error: error.message 
                    };
                }
            });

            const usageResults = await Promise.all(usagePromises);
            
            for (const result of usageResults) {
                if (result.success) {
                    results.success++;
                } else {
                    results.failed++;
                }
                results.usages.push(result);
            }

            res.json({ success: true, data: results });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============ OAuth 认证 ============

    app.post('/api/codex/oauth/start', authMiddleware, async (req, res) => {
        try {
            const result = await startCodexOAuth();
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/codex/oauth/callback', async (req, res) => {
        try {
            const { code, state } = req.query;
            if (!code || !state) {
                return res.status(400).json({ success: false, error: '缺少 code 或 state 参数' });
            }
            const credentials = await completeCodexOAuth(code, state);
            const store = await CodexCredentialStore.create();
            const name = credentials.email || `codex-${Date.now()}`;
            let existing = await store.getByEmail(credentials.email);
            if (existing) {
                await store.updateTokens(existing.id, credentials);
                res.json({ success: true, message: '凭证已更新', data: { id: existing.id, email: credentials.email } });
            } else {
                const id = await store.create({
                    name, email: credentials.email, accountId: credentials.accountId,
                    accessToken: credentials.accessToken, refreshToken: credentials.refreshToken,
                    idToken: credentials.idToken, expiresAt: credentials.expiresAt
                });
                res.json({ success: true, message: '凭证已保存', data: { id, email: credentials.email } });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============ 自动注册 ============

    // 获取注册配置
    app.get('/api/codex/register/config', authMiddleware, (req, res) => {
        res.json({
            success: true,
            data: {
                email: {
                    baseUrl: REGISTER_CONFIG.email.baseUrl,
                    suffix: REGISTER_CONFIG.email.suffix,
                    hasToken: !!REGISTER_CONFIG.email.token,
                },
                browser: REGISTER_CONFIG.browser,
                hasProxy: !!REGISTER_CONFIG.proxy,
            }
        });
    });

    // 启动注册任务
    app.post('/api/codex/register/start', authMiddleware, async (req, res) => {
        try {
            const { count = 1 } = req.body;
            if (count < 1 || count > 100) {
                return res.status(400).json({ success: false, error: '注册数量必须在 1-100 之间' });
            }
            const taskId = await startCodexRegisterTask(count);
            res.json({ success: true, message: '注册任务已启动', data: { taskId } });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 获取所有注册任务
    app.get('/api/codex/register/tasks', authMiddleware, (req, res) => {
        try {
            const tasks = getAllCodexRegisterTasks();
            res.json({ success: true, data: tasks });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 获取单个注册任务状态
    app.get('/api/codex/register/tasks/:taskId', authMiddleware, (req, res) => {
        try {
            const task = getCodexRegisterTask(req.params.taskId);
            if (!task) {
                return res.status(404).json({ success: false, error: '任务不存在' });
            }
            res.json({ success: true, data: task.toJSON() });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 取消注册任务
    app.post('/api/codex/register/tasks/:taskId/cancel', authMiddleware, (req, res) => {
        try {
            const success = cancelCodexRegisterTask(req.params.taskId);
            if (success) {
                res.json({ success: true, message: '任务取消请求已发送' });
            } else {
                res.status(400).json({ success: false, error: '任务不存在或无法取消' });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============ 批量 OAuth 登录 ============

    // 启动登录任务（从 accounts.txt 读取账号进行 OAuth 授权）
    app.post('/api/codex/login/start', authMiddleware, async (req, res) => {
        try {
            const { id: taskId } = await startLoginTask();
            res.json({ success: true, message: '登录任务已启动', data: { taskId } });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 获取所有登录任务
    app.get('/api/codex/login/tasks', authMiddleware, (req, res) => {
        try {
            const tasks = getAllLoginTasks();
            res.json({ success: true, data: tasks });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // 获取单个登录任务状态
    app.get('/api/codex/login/tasks/:taskId', authMiddleware, (req, res) => {
        try {
            const task = getLoginTask(req.params.taskId);
            if (!task) {
                return res.status(404).json({ success: false, error: '任务不存在' });
            }
            res.json({ success: true, data: task });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============ Codex 模型列表 ============

    // 获取所有模型（含禁用状态）
    app.get('/api/codex/models', (req, res) => {
        const disabled = getDisabledModels();
        res.json({
            success: true,
            data: CODEX_MODELS.map(id => ({
                id,
                object: 'model',
                created: Math.floor(Date.now() / 1000),
                owned_by: 'openai',
                disabled: disabled.includes(id)
            })),
            disabled
        });
    });

    // 测试单个模型是否可用
    app.post('/api/codex/models/test', authMiddleware, async (req, res) => {
        const { model } = req.body;
        if (!model || !CODEX_MODELS.includes(model)) {
            return res.status(400).json({ success: false, error: `不支持的模型: ${model}` });
        }
        try {
            const service = await CodexService.fromRandomActive();
            const testMessages = [{ role: 'user', content: 'Hi' }];
            let gotContent = false;
            for await (const event of service.chatStream(model, testMessages, { reasoningEffort: 'low' })) {
                if (event.type === 'content' && event.data) {
                    gotContent = true;
                    break;
                }
                if (event.type === 'done') break;
            }
            if (gotContent) {
                enableModel(model);
                res.json({ success: true, message: `模型 ${model} 可用` });
            } else {
                disableModel(model);
                res.json({ success: false, message: `模型 ${model} 无响应内容` });
            }
        } catch (error) {
            disableModel(model);
            res.json({ success: false, message: `模型 ${model} 请求失败: ${error.message}` });
        }
    });

    // 批量测试所有模型
    app.post('/api/codex/models/test-all', authMiddleware, async (req, res) => {
        const results = { total: CODEX_MODELS.length, success: 0, failed: 0, details: [] };
        for (const model of CODEX_MODELS) {
            try {
                const service = await CodexService.fromRandomActive();
                const testMessages = [{ role: 'user', content: 'Hi' }];
                let gotContent = false;
                for await (const event of service.chatStream(model, testMessages, { reasoningEffort: 'low' })) {
                    if (event.type === 'content' && event.data) {
                        gotContent = true;
                        break;
                    }
                    if (event.type === 'done') break;
                }
                if (gotContent) {
                    enableModel(model);
                    results.success++;
                    results.details.push({ model, status: 'success' });
                } else {
                    disableModel(model);
                    results.failed++;
                    results.details.push({ model, status: 'failed', error: '无响应内容' });
                }
            } catch (error) {
                disableModel(model);
                results.failed++;
                results.details.push({ model, status: 'failed', error: error.message });
            }
        }
        res.json({ success: true, data: results });
    });

    // 禁用指定模型
    app.post('/api/codex/models/disable', authMiddleware, (req, res) => {
        const { model } = req.body;
        if (!model) return res.status(400).json({ success: false, error: '缺少 model 参数' });
        const result = disableModel(model);
        res.json({ success: result, message: result ? `模型 ${model} 已禁用` : `模型 ${model} 不存在` });
    });

    // 启用指定模型
    app.post('/api/codex/models/enable', authMiddleware, (req, res) => {
        const { model } = req.body;
        if (!model) return res.status(400).json({ success: false, error: '缺少 model 参数' });
        const result = enableModel(model);
        res.json({ success: result, message: result ? `模型 ${model} 已启用` : `模型 ${model} 未在禁用列表中` });
    });

    // 重置所有禁用模型
    app.post('/api/codex/models/reset', authMiddleware, (req, res) => {
        const count = resetDisabledModels();
        res.json({ success: true, message: `已重置 ${count} 个禁用模型`, data: { count } });
    });

    // 清除请求失败的模型（移除已禁用模型 = 返回活跃列表）
    app.delete('/api/codex/models/failed', authMiddleware, (req, res) => {
        const disabled = getDisabledModels();
        res.json({ success: true, message: `当前有 ${disabled.length} 个禁用模型`, data: { disabled, active: getActiveModels() } });
    });

    // ============ Codex OpenAI 兼容聊天端点 ============

    app.post('/codex/v1/chat/completions', async (req, res) => {
        const startTime = Date.now();
        const requestId = 'chatcmpl-' + Date.now() + Math.random().toString(36).substring(2, 8);
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

        // 初始化日志数据
        const logData = {
            requestId,
            endpoint: '/codex/v1/chat/completions',
            method: 'POST',
            channel: 'codex',
            clientIp,
            model: req.body?.model || 'gpt-5',
            inputTokens: 0,
            outputTokens: 0,
            statusCode: 200,
            provider: 'codex'
        };

        try {
            // ============ API Key 验证 ============
            const authHeader = req.headers.authorization;
            const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

            if (!apiKey) {
                logData.statusCode = 401;
                logData.errorMessage = 'Missing API key';
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(401).json({ error: { message: 'Missing API key', type: 'authentication_error' } });
            }

            if (verifyApiKey) {
                const keyRecord = await verifyApiKey(apiKey);
                if (!keyRecord) {
                    logData.statusCode = 401;
                    logData.errorMessage = 'Invalid API key';
                    if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                    return res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
                }

                if (!keyRecord.isActive) {
                    logData.statusCode = 401;
                    logData.errorMessage = 'API key is disabled';
                    if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                    return res.status(401).json({ error: { message: 'API key is disabled', type: 'authentication_error' } });
                }

                logData.apiKeyId = keyRecord.id;
                logData.apiKeyPrefix = keyRecord.keyPrefix;
            }

            // ============ 请求验证 ============
            if (!req.body || typeof req.body !== 'object') {
                logData.statusCode = 400;
                logData.errorMessage = '请求体无效';
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(400).json({ error: { message: '请求体无效', type: 'invalid_request_error' } });
            }

            const { model, messages, stream } = req.body;
            const targetModel = model || 'gpt-5';
            logData.model = targetModel;

            if (!CODEX_MODELS.includes(targetModel)) {
                logData.statusCode = 400;
                logData.errorMessage = `不支持的模型: ${targetModel}`;
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(400).json({ error: { message: `不支持的模型: ${targetModel}`, type: 'invalid_request_error' } });
            }

            if (isModelDisabled(targetModel)) {
                logData.statusCode = 400;
                logData.errorMessage = `模型已禁用: ${targetModel}`;
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(400).json({ error: { message: `模型已禁用: ${targetModel}`, type: 'invalid_request_error' } });
            }

            const service = await CodexService.fromRandomActive();
            logData.credentialId = service.credential?.id;
            logData.credentialName = service.credential?.name || service.credential?.email;

            // 计算输入 token（估算）
            logData.inputTokens = Math.ceil(JSON.stringify(messages).length / 4);

            let systemPrompt = '';
            const convertedMessages = [];
            for (const msg of messages) {
                if (msg.role === 'system') {
                    systemPrompt += (systemPrompt ? '\n' : '') + (typeof msg.content === 'string' ? msg.content : msg.content.map(c => c.text || '').join(''));
                } else if (msg.role === 'user' || msg.role === 'assistant') {
                    let content = msg.content;
                    if (Array.isArray(content)) content = content.map(c => c.type === 'text' ? c.text : '').join('');
                    convertedMessages.push({ role: msg.role, content });
                }
            }

            if (stream) {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                let fullText = '';
                try {
                    for await (const event of service.chatStream(targetModel, convertedMessages, { system: systemPrompt })) {
                        if (event.type === 'content' && event.data) {
                            fullText += event.data;
                            res.write(`data: ${JSON.stringify({
                                id: requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: targetModel,
                                choices: [{ index: 0, delta: { content: event.data }, finish_reason: null }]
                            })}\n\n`);
                        }
                    }
                    res.write(`data: ${JSON.stringify({
                        id: requestId, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: targetModel,
                        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
                    })}\n\n`);
                    res.write('data: [DONE]\n\n');
                    res.end();

                    // 记录成功日志
                    logData.outputTokens = Math.ceil(fullText.length / 4);
                    const durationMs = Date.now() - startTime;
                    if (apiLogStore) await apiLogStore.create({ ...logData, durationMs });
                    console.log(`[Codex] ${requestId} | ${logData.apiKeyPrefix || 'no-key'} | ${clientIp} | ${durationMs}ms | in:${logData.inputTokens} out:${logData.outputTokens}`);
                } catch (streamError) {
                    logData.statusCode = 500;
                    logData.errorMessage = streamError.message;
                    if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                    res.write(`data: ${JSON.stringify({ error: { message: streamError.message, type: 'server_error' } })}\n\n`);
                    res.end();
                }
            } else {
                const response = await service.chat(targetModel, convertedMessages, { system: systemPrompt });
                const inputTokens = logData.inputTokens;
                const outputTokens = Math.ceil(response.length / 4);
                logData.outputTokens = outputTokens;

                res.json({
                    id: requestId, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: targetModel,
                    choices: [{ index: 0, message: { role: 'assistant', content: response }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens }
                });

                // 记录成功日志
                const durationMs = Date.now() - startTime;
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs });
                console.log(`[Codex] ${requestId} | ${logData.apiKeyPrefix || 'no-key'} | ${clientIp} | ${durationMs}ms | in:${inputTokens} out:${outputTokens}`);
            }
        } catch (error) {
            console.error(`[Codex] /codex/v1/chat/completions 错误:`, error.message);
            logData.statusCode = 500;
            logData.errorMessage = error.message;
            if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            if (!res.headersSent) {
                res.status(500).json({ error: { message: error.message, type: 'server_error' } });
            } else {
                res.end();
            }
        }
    });

    app.get('/codex/v1/models', (req, res) => {
        const activeModels = getActiveModels();
        res.json({
            object: 'list',
            data: activeModels.map(id => ({ id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'openai' }))
        });
    });

    // ============ Codex 原生 API 端点 ============
    // 完整支持工具调用 (function_call / function_call_output)

    app.post('/codex/responses', async (req, res) => {
        const startTime = Date.now();
        const responseId = 'resp_' + Date.now() + Math.random().toString(36).substring(2, 8);
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

        // 初始化日志数据
        const logData = {
            requestId: responseId,
            endpoint: '/codex/responses',
            method: 'POST',
            channel: 'codex',
            clientIp,
            model: req.body?.model || 'gpt-5',
            inputTokens: 0,
            outputTokens: 0,
            statusCode: 200,
            provider: 'codex'
        };

        let keyRecord = null;

        try {
            // ============ API Key 验证 ============
            const authHeader = req.headers.authorization;
            const apiKey = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;

            if (!apiKey) {
                logData.statusCode = 401;
                logData.errorMessage = 'Missing API key';
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(401).json({ error: { message: 'Missing API key', type: 'authentication_error' } });
            }

            if (verifyApiKey) {
                keyRecord = await verifyApiKey(apiKey);
                if (!keyRecord) {
                    logData.statusCode = 401;
                    logData.errorMessage = 'Invalid API key';
                    if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                    return res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
                }

                if (!keyRecord.isActive) {
                    logData.statusCode = 401;
                    logData.errorMessage = 'API key is disabled';
                    if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                    return res.status(401).json({ error: { message: 'API key is disabled', type: 'authentication_error' } });
                }

                logData.apiKeyId = keyRecord.id;
                logData.apiKeyPrefix = keyRecord.keyPrefix;
            }

            // ============ 请求验证 ============
            if (!req.body || typeof req.body !== 'object') {
                logData.statusCode = 400;
                logData.errorMessage = '请求体无效';
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(400).json({ error: { message: '请求体无效', type: 'invalid_request_error' } });
            }

            const { model, input, instructions, tools, tool_choice, reasoning } = req.body;
            const targetModel = model || 'gpt-5';
            logData.model = targetModel;

            if (!CODEX_MODELS.includes(targetModel)) {
                logData.statusCode = 400;
                logData.errorMessage = `不支持的模型: ${targetModel}`;
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(400).json({ error: { message: `不支持的模型: ${targetModel}`, type: 'invalid_request_error' } });
            }

            if (isModelDisabled(targetModel)) {
                logData.statusCode = 400;
                logData.errorMessage = `模型已禁用: ${targetModel}`;
                if (apiLogStore) await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                return res.status(400).json({ error: { message: `模型已禁用: ${targetModel}`, type: 'invalid_request_error' } });
            }

            const service = await CodexService.fromRandomActive();
            logData.credentialId = service.credential?.id;
            logData.credentialName = service.credential?.name || service.credential?.email;

            // 计算输入 token（估算）
            logData.inputTokens = Math.ceil(JSON.stringify(input || []).length / 4);

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // 解析 input（支持 function_call / function_call_output）
            const messages = Array.isArray(input) ? input : [];
            const outputItemId = 'item_' + Date.now();
            let fullText = '';
            let functionCallIndex = 0;
            const pendingToolCalls = [];

            const options = {
                system: instructions,
                tools: tools,
                toolChoice: tool_choice,
                reasoningEffort: reasoning?.effort || 'high',
                cwd: extractEnvValue(input, 'cwd'),
                sandboxMode: extractEnvValue(input, 'sandbox_mode'),
                approvalPolicy: extractEnvValue(input, 'approval_policy'),
                networkAccess: extractEnvValue(input, 'network_access'),
                parallelToolCalls: req.body.parallel_tool_calls
            };

            res.write(`data: ${JSON.stringify({
                type: 'response.created',
                response: { id: responseId, object: 'response', created_at: Math.floor(startTime / 1000), model: targetModel, status: 'in_progress' }
            })}\n\n`);

            try {
                for await (const event of service.chatStream(targetModel, messages, options)) {
                    if (event.type === 'content' && event.data) {
                        fullText += event.data;
                        res.write(`data: ${JSON.stringify({
                            type: 'response.output_text.delta', item_id: outputItemId, output_index: 0, content_index: 0, delta: event.data
                        })}\n\n`);
                    }

                    if (event.type === 'reasoning' && event.data) {
                        res.write(`data: ${JSON.stringify({
                            type: 'response.reasoning_summary_text.delta', item_id: outputItemId, output_index: 0, delta: event.data
                        })}\n\n`);
                    }

                    if (event.type === 'tool_call_done' && event.data) {
                        const tc = event.data;
                        pendingToolCalls.push(tc);
                        res.write(`data: ${JSON.stringify({
                            type: 'response.output_item.done', output_index: functionCallIndex,
                            item: { type: 'function_call', call_id: tc.call_id, name: tc.name, arguments: tc.arguments }
                        })}\n\n`);
                        functionCallIndex++;
                    }

                    if (event.type === 'response.output_item.done' && event.data?.item?.type === 'function_call') {
                        const item = event.data.item;
                        if (!pendingToolCalls.find(t => t.call_id === item.call_id)) {
                            pendingToolCalls.push({ call_id: item.call_id, name: item.name, arguments: item.arguments });
                            res.write(`data: ${JSON.stringify({
                                type: 'response.output_item.done', output_index: functionCallIndex,
                                item: { type: 'function_call', call_id: item.call_id, name: item.name, arguments: item.arguments }
                            })}\n\n`);
                            functionCallIndex++;
                        }
                    }
                }

                if (fullText) {
                    res.write(`data: ${JSON.stringify({
                        type: 'response.output_text.done', item_id: outputItemId, output_index: 0, content_index: 0, text: fullText
                    })}\n\n`);
                    res.write(`data: ${JSON.stringify({
                        type: 'response.output_item.done', output_index: pendingToolCalls.length,
                        item: { id: outputItemId, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: fullText }] }
                    })}\n\n`);
                }

                const outputItems = pendingToolCalls.map(tc => ({ type: 'function_call', call_id: tc.call_id, name: tc.name, arguments: tc.arguments }));
                if (fullText) {
                    outputItems.push({ id: outputItemId, type: 'message', role: 'assistant', content: [{ type: 'output_text', text: fullText }] });
                }

                const outputTokens = Math.ceil(fullText.length / 4);
                logData.outputTokens = outputTokens;

                res.write(`data: ${JSON.stringify({
                    type: 'response.completed',
                    response: {
                        id: responseId, object: 'response', created_at: Math.floor(startTime / 1000), model: targetModel, status: 'completed',
                        output: outputItems,
                        usage: { input_tokens: logData.inputTokens, output_tokens: outputTokens, total_tokens: logData.inputTokens + outputTokens }
                    }
                })}\n\n`);

                res.end();

                // 记录成功日志
                const durationMs = Date.now() - startTime;
                if (apiLogStore) {
                    await apiLogStore.create({ ...logData, durationMs });
                }
                console.log(`[Codex] ${responseId} | ${logData.apiKeyPrefix || 'no-key'} | ${clientIp} | ${durationMs}ms | in:${logData.inputTokens} out:${outputTokens}`);
            } catch (streamError) {
                console.error(`[Codex] /codex/responses 流式错误:`, streamError.message);
                logData.statusCode = 500;
                logData.errorMessage = streamError.message;
                if (apiLogStore) {
                    await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
                }
                res.write(`data: ${JSON.stringify({ type: 'error', error: { message: streamError.message, type: 'server_error' } })}\n\n`);
                res.end();
            }
        } catch (error) {
            console.error(`[Codex] /codex/responses 错误:`, error.message);
            logData.statusCode = 500;
            logData.errorMessage = error.message;
            if (apiLogStore && !logData.apiKeyId) {
                // 仅在未记录过日志时记录
                await apiLogStore.create({ ...logData, durationMs: Date.now() - startTime });
            }
            if (!res.headersSent) {
                res.status(500).json({ error: { message: error.message, type: 'server_error' } });
            } else {
                res.end();
            }
        }
    });

    console.log('[Codex] 路由已设置');
}

// 从 input 中提取环境变量值
function extractEnvValue(input, key) {
    if (!Array.isArray(input)) return undefined;
    for (const item of input) {
        if (item.type === 'message' && item.role === 'user' && Array.isArray(item.content)) {
            for (const c of item.content) {
                if (c.type === 'input_text' && c.text?.includes('<environment_context>')) {
                    const regex = new RegExp(`<${key}>([^<]+)</${key}>`);
                    const match = c.text.match(regex);
                    if (match) return match[1];
                }
            }
        }
    }
    return undefined;
}
