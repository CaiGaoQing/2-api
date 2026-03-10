/**
 * Grok Service - Grok 逆向 API 核心服务
 * 移植自 grok2api-main (Python/FastAPI)
 * 
 * 核心功能：
 * - 构建 Grok app-chat 请求（headers, payload, cookie）
 * - SSE 流式响应解析
 * - OpenAI 兼容格式转换（流式/非流式）
 * - Token 池管理（选择、配额、冷却）
 * - Statsig 指纹生成
 */

import crypto from 'crypto';
import { spawn } from 'child_process';

// ============ 常量 ============

const CHAT_API = 'https://grok.com/rest/app-chat/conversations/new';

// 默认配置
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const DEFAULT_BROWSER = 'chrome136';

// 过滤标签
const DEFAULT_FILTER_TAGS = ['xaiartifact', 'xai:tool_usage_card', 'grok:render'];

// ============ 模型定义 ============

export const GROK_MODELS_INFO = [
    { modelId: 'grok-3', grokModel: 'grok-3', modelMode: 'MODEL_MODE_GROK_3', tier: 'basic', cost: 'low' },
    { modelId: 'grok-3-mini', grokModel: 'grok-3', modelMode: 'MODEL_MODE_GROK_3_MINI_THINKING', tier: 'basic', cost: 'low' },
    { modelId: 'grok-3-thinking', grokModel: 'grok-3', modelMode: 'MODEL_MODE_GROK_3_THINKING', tier: 'basic', cost: 'low' },
    { modelId: 'grok-4', grokModel: 'grok-4', modelMode: 'MODEL_MODE_GROK_4', tier: 'basic', cost: 'low' },
    { modelId: 'grok-4-mini', grokModel: 'grok-4-mini', modelMode: 'MODEL_MODE_GROK_4_MINI_THINKING', tier: 'basic', cost: 'low' },
    { modelId: 'grok-4-thinking', grokModel: 'grok-4', modelMode: 'MODEL_MODE_GROK_4_THINKING', tier: 'basic', cost: 'low' },
    { modelId: 'grok-4-heavy', grokModel: 'grok-4', modelMode: 'MODEL_MODE_HEAVY', tier: 'super', cost: 'high' },
    { modelId: 'grok-4.1-mini', grokModel: 'grok-4-1-thinking-1129', modelMode: 'MODEL_MODE_GROK_4_1_MINI_THINKING', tier: 'basic', cost: 'low' },
    { modelId: 'grok-4.1-fast', grokModel: 'grok-4-1-thinking-1129', modelMode: 'MODEL_MODE_FAST', tier: 'basic', cost: 'low' },
    { modelId: 'grok-4.1-expert', grokModel: 'grok-4-1-thinking-1129', modelMode: 'MODEL_MODE_EXPERT', tier: 'basic', cost: 'high' },
    { modelId: 'grok-4.1-thinking', grokModel: 'grok-4-1-thinking-1129', modelMode: 'MODEL_MODE_GROK_4_1_THINKING', tier: 'basic', cost: 'high' },
    { modelId: 'grok-4.20-beta', grokModel: 'grok-420', modelMode: 'MODEL_MODE_GROK_420', tier: 'basic', cost: 'low' },
    { modelId: 'grok-imagine-1.0', grokModel: 'grok-3', modelMode: 'MODEL_MODE_FAST', tier: 'basic', cost: 'high', isImage: true },
    { modelId: 'grok-imagine-1.0-edit', grokModel: 'imagine-image-edit', modelMode: 'MODEL_MODE_FAST', tier: 'basic', cost: 'high', isImageEdit: true },
];

export const GROK_MODELS = GROK_MODELS_INFO.map(m => m.modelId);

const GROK_MODEL_MAP = {};
for (const m of GROK_MODELS_INFO) {
    GROK_MODEL_MAP[m.modelId] = m;
}

/**
 * 获取模型信息
 */
export function getGrokModelInfo(modelId) {
    return GROK_MODEL_MAP[modelId] || null;
}

/**
 * 检查模型是否有效
 */
export function isValidGrokModel(modelId) {
    return modelId in GROK_MODEL_MAP;
}

/**
 * 获取模型对应的 Token 池候选列表
 */
export function getPoolCandidates(modelId) {
    const info = GROK_MODEL_MAP[modelId];
    if (info && info.tier === 'super') {
        return ['ssoSuper'];
    }
    return ['ssoBasic', 'ssoSuper'];
}

// ============ Statsig 指纹生成 ============

function generateStatsigId() {
    if (Math.random() < 0.5) {
        const rand = randomAlphanumeric(5);
        const message = `e:TypeError: Cannot read properties of null (reading 'children['${rand}']')`;
        return Buffer.from(message).toString('base64');
    } else {
        const rand = randomAlpha(10);
        const message = `e:TypeError: Cannot read properties of undefined (reading '${rand}')`;
        return Buffer.from(message).toString('base64');
    }
}

function randomAlphanumeric(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < len; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

function randomAlpha(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < len; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

// ============ Cookie / Headers 构建 ============

/**
 * 构建 SSO Cookie
 */
function buildSsoCookie(ssoToken, cfClearance) {
    let token = ssoToken;
    if (token.startsWith('sso=')) {
        token = token.substring(4);
    }
    let cookie = `sso=${token}; sso-rw=${token}`;
    if (cfClearance) {
        cookie += `;cf_clearance=${cfClearance}`;
    }
    return cookie;
}

/**
 * 构建 Client Hints 头
 */
function buildClientHints(browser, userAgent) {
    browser = (browser || '').trim().toLowerCase();
    const ua = (userAgent || '').toLowerCase();

    const isChromium = browser.includes('chrome') || browser.includes('chromium') || browser.includes('edge') ||
        ua.includes('chrome') || ua.includes('chromium') || ua.includes('edg');
    const isFirefox = ua.includes('firefox') || browser.includes('firefox');
    const isSafari = (ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium') && !ua.includes('edg'));

    if (!isChromium || isFirefox || isSafari) return {};

    // 提取版本号
    let version = null;
    if (browser) {
        const m = browser.match(/(\d{2,3})/);
        if (m) version = m[1];
    }
    if (!version && userAgent) {
        for (const pattern of [/Edg\/(\d+)/, /Chrome\/(\d+)/, /Chromium\/(\d+)/]) {
            const m = userAgent.match(pattern);
            if (m) { version = m[1]; break; }
        }
    }
    if (!version) return {};

    const isEdge = browser.includes('edge') || ua.includes('edg');
    const brand = isEdge ? 'Microsoft Edge' : 'Google Chrome';

    const secChUa = `"${brand}";v="${version}", "Chromium";v="${version}", "Not(A:Brand";v="24"`;

    // 检测平台
    let platform = null;
    if (ua.includes('windows')) platform = 'Windows';
    else if (ua.includes('mac os x') || ua.includes('macintosh')) platform = 'macOS';
    else if (ua.includes('linux')) platform = 'Linux';

    const mobile = '?0';

    const hints = {
        'Sec-Ch-Ua': secChUa,
        'Sec-Ch-Ua-Mobile': mobile,
    };
    if (platform) hints['Sec-Ch-Ua-Platform'] = `"${platform}"`;
    hints['Sec-Ch-Ua-Model'] = '';

    return hints;
}

/**
 * 构建完整请求头
 * 对应 grok2api-main/app/services/reverse/utils/headers.py 的 build_headers
 */
function buildHeaders(ssoToken, config = {}) {
    const userAgent = config.userAgent || DEFAULT_USER_AGENT;
    const browser = config.browser || DEFAULT_BROWSER;
    const cfClearance = config.cfClearance || '';

    const headers = {
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Baggage': 'sentry-environment=production,sentry-release=d6add6fb0460641fd482d767a335ef72b9b6abb8,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c',
        'Origin': 'https://grok.com',
        'Priority': 'u=1, i',
        'Referer': 'https://grok.com/',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'User-Agent': userAgent,
        'Content-Type': 'application/json',
        'Accept': '*/*',
        'Sec-Fetch-Dest': 'empty',
        'Cookie': buildSsoCookie(ssoToken, cfClearance),
        'x-statsig-id': generateStatsigId(),
        'x-xai-request-id': crypto.randomUUID(),
    };

    // 添加 Client Hints
    const hints = buildClientHints(browser, userAgent);
    Object.assign(headers, hints);

    return headers;
}

// ============ Payload 构建 ============

/**
 * 构建 Grok app-chat 请求体
 * 对应 grok2api-main/app/services/reverse/app_chat.py 的 build_payload
 */
function buildChatPayload(message, model, mode, options = {}) {
    const {
        fileAttachments = [],
        toolOverrides = {},
        modelConfigOverride = null,
        temporary = true,
        disableMemory = true,
    } = options;

    const payload = {
        deviceEnvInfo: {
            darkModeEnabled: false,
            devicePixelRatio: 2,
            screenWidth: 2056,
            screenHeight: 1329,
            viewportWidth: 2056,
            viewportHeight: 1083,
        },
        disableMemory,
        disableSearch: false,
        disableSelfHarmShortCircuit: false,
        disableTextFollowUps: false,
        enableImageGeneration: true,
        enableImageStreaming: true,
        enableSideBySide: true,
        fileAttachments: fileAttachments,
        forceConcise: false,
        forceSideBySide: false,
        imageAttachments: [],
        imageGenerationCount: 2,
        isAsyncChat: false,
        isReasoning: false,
        message,
        modelMode: mode,
        modelName: model,
        responseMetadata: {
            requestModelDetails: { modelId: model },
        },
        returnImageBytes: false,
        returnRawGrokInXaiRequest: false,
        sendFinalMetadata: true,
        temporary,
        toolOverrides,
    };

    if (modelConfigOverride) {
        payload.responseMetadata.modelConfigOverride = modelConfigOverride;
    }

    return payload;
}

// ============ 消息提取 ============

/**
 * 从 OpenAI 消息格式提取内容
 * 对应 grok2api-main/app/services/grok/services/chat.py 的 MessageExtractor
 */
export function extractMessages(messages) {
    const texts = [];
    const extracted = [];

    for (const msg of messages) {
        const role = msg.role || 'user';
        const content = msg.content;
        const parts = [];

        if (typeof content === 'string') {
            if (content.trim()) parts.push(content);
        } else if (Array.isArray(content)) {
            for (const item of content) {
                const itemType = item.type || '';
                if (itemType === 'text') {
                    const text = (item.text || '').trim();
                    if (text) parts.push(text);
                }
                // image_url, input_audio, file 暂不处理（chat-only 场景）
            }
        }

        if (parts.length > 0) {
            extracted.push({ role, text: parts.join('\n') });
        }
    }

    // 找到最后一条 user 消息的索引
    let lastUserIndex = -1;
    for (let i = extracted.length - 1; i >= 0; i--) {
        if (extracted[i].role === 'user') {
            lastUserIndex = i;
            break;
        }
    }

    for (let i = 0; i < extracted.length; i++) {
        const { role, text } = extracted[i];
        texts.push(i === lastUserIndex ? text : `${role}: ${text}`);
    }

    return texts.join('\n\n');
}

// ============ 工具文本提取 ============

function extractToolText(raw, rolloutId = '') {
    if (!raw) return '';

    const nameMatch = raw.match(/<xai:tool_name>([\s\S]*?)<\/xai:tool_name>/);
    const argsMatch = raw.match(/<xai:tool_args>([\s\S]*?)<\/xai:tool_args>/);

    let name = nameMatch ? nameMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    let args = argsMatch ? argsMatch[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';

    let payload = null;
    if (args) {
        try { payload = JSON.parse(args); } catch (e) { /* ignore */ }
    }

    let label = name;
    let text = args;
    const prefix = rolloutId ? `[${rolloutId}]` : '';

    if (name === 'web_search') {
        label = `${prefix}[WebSearch]`;
        if (payload && typeof payload === 'object') {
            text = payload.query || payload.q || '';
        }
    } else if (name === 'search_images') {
        label = `${prefix}[SearchImage]`;
        if (payload && typeof payload === 'object') {
            text = payload.image_description || payload.description || payload.query || '';
        }
    } else if (name === 'chatroom_send') {
        label = `${prefix}[AgentThink]`;
        if (payload && typeof payload === 'object') {
            text = payload.message || '';
        }
    }

    if (label && text) return `${label} ${text}`.trim();
    if (label) return label;
    if (text) return text;
    return raw.replace(/<[^>]+>/g, '').trim();
}

// ============ SSE 响应过滤 ============

/**
 * 过滤特殊标签
 */
function filterToken(tokenText, filterTags) {
    if (!tokenText || !filterTags || filterTags.length === 0) return tokenText;

    for (const tag of filterTags) {
        if (tag === 'xai:tool_usage_card') continue; // tool_usage_card 单独处理
        if (tokenText.includes(`<${tag}`) || tokenText.includes(`</${tag}`)) {
            return '';
        }
    }
    return tokenText;
}

// ============ 核心服务类 ============

export class GrokService {

    /**
     * @param {Object} config - 服务配置
     * @param {string} config.userAgent
     * @param {string} config.browser
     * @param {string} config.cfClearance
     * @param {string} config.baseProxyUrl
     * @param {number} config.timeout - 请求超时（ms）
     * @param {number} config.streamTimeout - 流式空闲超时（ms）
     * @param {boolean} config.temporary
     * @param {boolean} config.disableMemory
     * @param {boolean} config.thinking - 是否输出思维链
     * @param {string[]} config.filterTags
     */
    constructor(config = {}) {
        this.userAgent = config.userAgent || DEFAULT_USER_AGENT;
        this.browser = config.browser || DEFAULT_BROWSER;
        this.cfClearance = config.cfClearance || '';
        this.baseProxyUrl = config.baseProxyUrl || '';
        this.timeout = config.timeout || 120000;
        this.streamTimeout = config.streamTimeout || 60000;
        this.temporary = config.temporary !== undefined ? config.temporary : true;
        this.disableMemory = config.disableMemory !== undefined ? config.disableMemory : true;
        this.thinking = config.thinking !== undefined ? config.thinking : true;
        this.filterTags = config.filterTags || DEFAULT_FILTER_TAGS;
    }

    /**
     * 发送 Chat 请求并返回原始 SSE 流
     * 对应 grok2api-main/app/services/reverse/app_chat.py 的 AppChatReverse.request
     * 
     * @param {string} ssoToken - SSO Token
     * @param {string} message - 拼接后的消息文本
     * @param {string} grokModel - Grok 内部模型名
     * @param {string} modelMode - 模型模式
     * @param {Object} options
     * @returns {Promise<Response>} fetch Response 对象（可读流）
     */
    async sendChatRequest(ssoToken, message, grokModel, modelMode, options = {}) {
        const headers = buildHeaders(ssoToken, {
            userAgent: this.userAgent,
            browser: this.browser,
            cfClearance: this.cfClearance,
        });

        const modelConfigOverride = {};
        if (options.temperature !== undefined) modelConfigOverride.temperature = options.temperature;
        if (options.topP !== undefined) modelConfigOverride.topP = options.topP;
        if (options.reasoningEffort !== undefined) modelConfigOverride.reasoningEffort = options.reasoningEffort;

        const payload = buildChatPayload(message, grokModel, modelMode, {
            fileAttachments: options.fileAttachments || [],
            toolOverrides: options.toolOverrides || {},
            modelConfigOverride: Object.keys(modelConfigOverride).length > 0 ? modelConfigOverride : null,
            temporary: this.temporary,
            disableMemory: this.disableMemory,
        });

        return await this._pythonCurlCffiRequest(CHAT_API, headers, payload);
    }

    /**
     * 使用 Python curl_cffi 发送请求（TLS 指纹模拟 chrome136）
     * 通过子进程调用 grok_curl.py 脚本
     */
    async _pythonCurlCffiRequest(url, headers, payload) {
        const pythonBin = process.env.GROK_PYTHON_PATH || 'python3';
        const scriptPath = new URL('./grok_curl.py', import.meta.url).pathname;

        const input = JSON.stringify({
            url,
            headers,
            body: JSON.stringify(payload),
            proxy: this.baseProxyUrl || '',
            timeout: Math.ceil(this.timeout / 1000),
            impersonate: this.browser || 'chrome136',
        });

        return new Promise((resolve, reject) => {
            const proc = spawn(pythonBin, [scriptPath], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            proc.stdin.write(input);
            proc.stdin.end();

            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

            proc.on('error', (err) => {
                reject(new Error(`Python curl_cffi 进程错误: ${err.message}`));
            });

            proc.on('close', (code) => {
                if (code !== 0 && !stdout) {
                    return reject(new Error(`Python curl_cffi 退出码 ${code}: ${stderr.substring(0, 200)}`));
                }

                let result;
                try {
                    result = JSON.parse(stdout);
                } catch (e) {
                    return reject(new Error(`Python curl_cffi 输出解析失败: ${stdout.substring(0, 200)}`));
                }

                if (result.error) {
                    return reject(new Error(`Python curl_cffi 错误: ${result.error}`));
                }

                const httpStatus = result.status;
                const bodyStr = result.body || '';

                if (httpStatus < 200 || httpStatus >= 300) {
                    const error = new Error(`Grok API error: ${httpStatus}`);
                    error.status = httpStatus;
                    error.body = bodyStr.substring(0, 500);
                    return reject(error);
                }

                // 构建类 fetch Response 对象
                const bodyBuffer = Buffer.from(bodyStr, 'utf8');
                const readable = new ReadableStream({
                    start(controller) {
                        controller.enqueue(new Uint8Array(bodyBuffer));
                        controller.close();
                    }
                });

                resolve({
                    ok: true,
                    status: httpStatus,
                    body: readable,
                    text: async () => bodyStr,
                    json: async () => JSON.parse(bodyStr),
                });
            });

            // 超时保护
            setTimeout(() => {
                try { proc.kill('SIGTERM'); } catch (e) { /* ignore */ }
            }, this.timeout + 10000);
        });
    }

    /**
     * 流式 Chat Completions（OpenAI SSE 格式）
     * 对应 grok2api-main/app/services/grok/services/chat.py 的 StreamProcessor
     * 
     * @param {string} ssoToken
     * @param {string} modelId - 外部模型 ID（如 grok-4）
     * @param {Object[]} messages - OpenAI 格式消息
     * @param {Object} options - { temperature, topP, reasoningEffort }
     * @returns {AsyncGenerator<string>} SSE 数据块生成器
     */
    async *chatCompletionsStream(ssoToken, modelId, messages, options = {}) {
        const modelInfo = getGrokModelInfo(modelId);
        if (!modelInfo) throw new Error(`Unknown model: ${modelId}`);

        const message = extractMessages(messages);
        const showThink = options.reasoningEffort
            ? options.reasoningEffort !== 'none'
            : this.thinking;

        const response = await this.sendChatRequest(
            ssoToken, message, modelInfo.grokModel, modelInfo.modelMode, options
        );

        const responseId = 'chatcmpl-' + crypto.randomUUID().replace(/-/g, '').substring(0, 24);
        const created = Math.floor(Date.now() / 1000);
        let fingerprint = '';
        let rolloutId = '';
        let roleSent = false;
        let thinkOpened = false;

        const makeSseChunk = (content = '', role = null, finishReason = null) => {
            const delta = {};
            if (role) {
                delta.role = role;
                delta.content = '';
            } else if (content) {
                delta.content = content;
            }
            const chunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model: modelId,
                system_fingerprint: fingerprint,
                choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
            };
            return `data: ${JSON.stringify(chunk)}\n\n`;
        };

        // 解析 SSE 流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let lastDataTime = Date.now();

        try {
            while (true) {
                // 空闲超时检测
                const timeoutPromise = new Promise((_, reject) => {
                    const remaining = this.streamTimeout - (Date.now() - lastDataTime);
                    if (remaining <= 0) {
                        reject(new Error(`Stream idle timeout after ${this.streamTimeout / 1000}s`));
                    } else {
                        setTimeout(() => reject(new Error(`Stream idle timeout after ${this.streamTimeout / 1000}s`)), remaining);
                    }
                });

                let result;
                try {
                    result = await Promise.race([reader.read(), timeoutPromise]);
                } catch (timeoutErr) {
                    console.warn(`[Grok] ${timeoutErr.message}`);
                    break;
                }

                if (result.done) break;
                lastDataTime = Date.now();

                buffer += decoder.decode(result.value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line) continue;

                    let jsonStr = line;
                    if (jsonStr.startsWith('data:')) {
                        jsonStr = jsonStr.substring(5).trim();
                    }
                    if (jsonStr === '[DONE]') continue;

                    let data;
                    try { data = JSON.parse(jsonStr); } catch (e) { continue; }

                    const resp = data?.result?.response || {};
                    const isThinking = !!resp.isThinking;

                    // 提取元数据
                    if (resp.llmInfo && !fingerprint) {
                        fingerprint = resp.llmInfo.modelHash || '';
                    }
                    if (resp.responseId) {
                        // 可用于追踪
                    }
                    if (resp.rolloutId) {
                        rolloutId = String(resp.rolloutId);
                    }

                    // 发送 role
                    if (!roleSent) {
                        yield makeSseChunk('', 'assistant');
                        roleSent = true;
                    }

                    // 处理模型响应（非流式部分，如图片）
                    if (resp.modelResponse) {
                        // 如果有思维链打开，关闭
                        if (thinkOpened) {
                            yield makeSseChunk('\n</think>\n');
                            thinkOpened = false;
                        }

                        // 提取文本内容（非流式模型完整响应）
                        const msgContent = resp.modelResponse.message;
                        if (msgContent) {
                            // 非流式场景，model 一次性返回全部内容
                            const filtered = filterContent(msgContent, this.filterTags);
                            if (filtered) {
                                yield makeSseChunk(filtered);
                            }
                        }
                        continue;
                    }

                    // 处理 token（流式文本片段）
                    const tokenText = resp.token;
                    if (tokenText !== undefined && tokenText !== null) {
                        if (!tokenText) continue;

                        const filtered = filterToken(tokenText, this.filterTags);
                        if (!filtered) continue;

                        const inThink = isThinking;
                        if (inThink) {
                            if (!showThink) continue;
                            if (!thinkOpened) {
                                yield makeSseChunk('<think>\n');
                                thinkOpened = true;
                            }
                        } else {
                            if (thinkOpened) {
                                yield makeSseChunk('\n</think>\n');
                                thinkOpened = false;
                            }
                        }
                        yield makeSseChunk(filtered);
                    }
                }
            }

            // 关闭思维链
            if (thinkOpened) {
                yield makeSseChunk('</think>\n');
            }

            // 发送结束标记
            yield makeSseChunk('', null, 'stop');
            yield 'data: [DONE]\n\n';

        } finally {
            try { reader.cancel(); } catch (e) { /* ignore */ }
        }
    }

    /**
     * 非流式 Chat Completions（OpenAI JSON 格式）
     * 对应 grok2api-main/app/services/grok/services/chat.py 的 CollectProcessor
     * 
     * @param {string} ssoToken
     * @param {string} modelId
     * @param {Object[]} messages
     * @param {Object} options
     * @returns {Object} OpenAI 格式的完整响应
     */
    async chatCompletions(ssoToken, modelId, messages, options = {}) {
        const modelInfo = getGrokModelInfo(modelId);
        if (!modelInfo) throw new Error(`Unknown model: ${modelId}`);

        const message = extractMessages(messages);

        const response = await this.sendChatRequest(
            ssoToken, message, modelInfo.grokModel, modelInfo.modelMode, options
        );

        let responseId = '';
        let fingerprint = '';
        let content = '';

        // 读取完整响应
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const rawLine of lines) {
                    const line = rawLine.trim();
                    if (!line) continue;

                    let jsonStr = line;
                    if (jsonStr.startsWith('data:')) {
                        jsonStr = jsonStr.substring(5).trim();
                    }
                    if (jsonStr === '[DONE]') continue;

                    let data;
                    try { data = JSON.parse(jsonStr); } catch (e) { continue; }

                    const resp = data?.result?.response || {};

                    if (resp.llmInfo && !fingerprint) {
                        fingerprint = resp.llmInfo.modelHash || '';
                    }

                    if (resp.modelResponse) {
                        responseId = resp.modelResponse.responseId || '';
                        content = resp.modelResponse.message || '';

                        // 处理元数据中的 modelHash
                        const meta = resp.modelResponse.metadata;
                        if (meta?.llm_info?.modelHash) {
                            fingerprint = meta.llm_info.modelHash;
                        }
                    }
                }
            }
        } finally {
            try { reader.cancel(); } catch (e) { /* ignore */ }
        }

        // 过滤标签
        content = filterContent(content, this.filterTags);

        return {
            id: responseId || ('chatcmpl-' + crypto.randomUUID().replace(/-/g, '').substring(0, 24)),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            system_fingerprint: fingerprint,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content,
                    refusal: null,
                },
                finish_reason: 'stop',
            }],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
            },
        };
    }
}

// ============ 内容过滤 ============

/**
 * 过滤非流式响应中的特殊标签
 * 对应 CollectProcessor._filter_content
 */
function filterContent(content, filterTags) {
    if (!content || !filterTags || filterTags.length === 0) return content;

    let result = content;

    // 处理 tool_usage_card
    if (filterTags.includes('xai:tool_usage_card')) {
        result = result.replace(
            /<xai:tool_usage_card[^>]*>[\s\S]*?<\/xai:tool_usage_card>/g,
            (match) => {
                const line = extractToolText(match);
                return line ? `${line}\n` : '';
            }
        );
    }

    // 处理其他标签
    for (const tag of filterTags) {
        if (tag === 'xai:tool_usage_card') continue;
        const pattern = new RegExp(`<${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*>[\\s\\S]*?<\\/${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}>|<${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*\\/>`, 'g');
        result = result.replace(pattern, '');
    }

    return result;
}

// ============ Token 池管理（内存级轻量实现） ============

const BASIC_DEFAULT_QUOTA = 80;
const SUPER_DEFAULT_QUOTA = 140;
const EFFORT_COST = { low: 1, high: 4 };

export class GrokTokenManager {
    constructor() {
        // pools: { ssoBasic: [TokenInfo], ssoSuper: [TokenInfo] }
        this.pools = { ssoBasic: [], ssoSuper: [] };
    }

    /**
     * 从数据库加载 tokens
     * @param {Array} tokens - [{ token, pool, quota, status, ... }]
     */
    loadTokens(tokens) {
        this.pools = { ssoBasic: [], ssoSuper: [] };
        for (const t of tokens) {
            const poolName = t.pool || 'ssoBasic';
            if (!this.pools[poolName]) this.pools[poolName] = [];
            this.pools[poolName].push({
                token: t.token.startsWith('sso=') ? t.token.substring(4) : t.token,
                status: t.status || 'active',
                quota: t.quota !== undefined ? t.quota : (poolName === 'ssoSuper' ? SUPER_DEFAULT_QUOTA : BASIC_DEFAULT_QUOTA),
                useCount: t.useCount || 0,
                failCount: t.failCount || 0,
                lastUsedAt: t.lastUsedAt || null,
            });
        }
    }

    /**
     * 选择可用 Token
     * 策略：active 且有配额，优先选配额最多的，相同配额随机选
     */
    getToken(poolName = 'ssoBasic', exclude = new Set()) {
        const pool = this.pools[poolName];
        if (!pool) return null;

        const available = pool.filter(t =>
            t.status === 'active' && t.quota > 0 && !exclude.has(t.token)
        );
        if (available.length === 0) return null;

        const maxQuota = Math.max(...available.map(t => t.quota));
        const candidates = available.filter(t => t.quota === maxQuota);
        return candidates[Math.floor(Math.random() * candidates.length)].token;
    }

    /**
     * 按模型获取可用 Token（自动尝试多个池）
     */
    getTokenForModel(modelId, exclude = new Set()) {
        const pools = getPoolCandidates(modelId);
        for (const poolName of pools) {
            const token = this.getToken(poolName, exclude);
            if (token) return token;
        }
        return null;
    }

    /**
     * 消耗配额
     */
    consume(tokenStr, modelId) {
        const info = getGrokModelInfo(modelId);
        const cost = info ? EFFORT_COST[info.cost] || 1 : 1;

        for (const pool of Object.values(this.pools)) {
            const t = pool.find(t => t.token === tokenStr);
            if (t) {
                t.quota = Math.max(0, t.quota - cost);
                t.useCount += cost;
                t.lastUsedAt = Date.now();
                if (t.quota === 0) t.status = 'cooling';
                return t;
            }
        }
        return null;
    }

    /**
     * 标记为限流（429）
     */
    markRateLimited(tokenStr) {
        for (const pool of Object.values(this.pools)) {
            const t = pool.find(t => t.token === tokenStr);
            if (t) {
                t.status = 'cooling';
                t.quota = 0;
                return;
            }
        }
    }

    /**
     * 记录失败
     */
    recordFail(tokenStr, statusCode = 401) {
        if (statusCode !== 401 && statusCode !== 403) return;
        for (const pool of Object.values(this.pools)) {
            const t = pool.find(t => t.token === tokenStr);
            if (t) {
                t.failCount += 1;
                if (t.failCount >= 5) t.status = 'expired';
                return;
            }
        }
    }

    /**
     * 获取统计信息
     */
    getStats() {
        const stats = {};
        for (const [name, pool] of Object.entries(this.pools)) {
            stats[name] = {
                total: pool.length,
                active: pool.filter(t => t.status === 'active' && t.quota > 0).length,
                cooling: pool.filter(t => t.status === 'cooling').length,
                expired: pool.filter(t => t.status === 'expired').length,
                totalQuota: pool.reduce((sum, t) => sum + t.quota, 0),
            };
        }
        return stats;
    }

    /**
     * 获取所有 tokens 的快照（用于持久化）
     */
    snapshot() {
        const result = [];
        for (const [poolName, pool] of Object.entries(this.pools)) {
            for (const t of pool) {
                result.push({ ...t, pool: poolName });
            }
        }
        return result;
    }
}
