/**
 * Krater Service - Krater AI API 代理服务
 *
 * Krater AI 提供 OpenAI 兼容的 API 接口：
 * - Base URL: https://api.krater.ai/v1
 * - 认证: Authorization: Bearer kr_live_...
 * - 支持 /v1/chat/completions, /v1/models 等标准端点
 * - 支持流式和非流式响应
 *
 * 核心功能：
 * - API Key 池管理（轮换、冷却、失败重试）
 * - OpenAI 兼容格式透传
 * - 流式/非流式支持
 */

import axios from 'axios';

// ============ 常量 ============

const KRATER_BASE_URL = 'https://api.krater.ai';

// Krater 支持的模型列表（Krater 使用 provider/model 前缀格式）
export const KRATER_MODELS = [
    // OpenAI 系列
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'openai/gpt-4.1',
    'openai/gpt-4.1-mini',
    'openai/gpt-4.1-nano',
    'openai/o1',
    'openai/o1-mini',
    'openai/o1-pro',
    'openai/o3',
    'openai/o3-mini',
    'openai/o4-mini',
    // Claude 系列
    'anthropic/claude-sonnet-4-20250514',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3.7-sonnet',
    'anthropic/claude-opus-4-20250514',
    // Gemini 系列
    'google/gemini-2.5-pro',
    'google/gemini-2.5-flash',
    'google/gemini-2.0-flash',
    // DeepSeek 系列
    'deepseek/deepseek-r1',
    'deepseek/deepseek-chat',
    // Meta 系列
    'meta-llama/llama-4-maverick',
    'meta-llama/llama-4-scout',
];

// 获取时间戳
function getTimestamp() {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// ============ Krater API Key 管理器 ============

export class KraterKeyManager {
    constructor() {
        this.keys = [];           // { apiKey, status, useCount, failCount, lastUsedAt, coolingUntil }
        this.keyMap = new Map();  // apiKey -> index
    }

    loadKeys(credentials) {
        this.keys = credentials.map(c => ({
            apiKey: c.apiKey,
            status: c.status || 'active',
            useCount: c.useCount || 0,
            failCount: c.failCount || 0,
            lastUsedAt: c.lastUsedAt ? new Date(c.lastUsedAt).getTime() : 0,
            coolingUntil: 0,
        }));
        this.keyMap.clear();
        this.keys.forEach((k, i) => this.keyMap.set(k.apiKey, i));
    }

    /**
     * 获取一个可用的 API Key（最少使用优先）
     */
    getKey(triedKeys = new Set()) {
        const now = Date.now();
        let best = null;
        let bestScore = Infinity;

        for (const key of this.keys) {
            if (key.status !== 'active') continue;
            if (triedKeys.has(key.apiKey)) continue;
            if (key.coolingUntil > now) continue;

            // 优先选择使用次数最少的
            const score = key.useCount * 1000 + key.failCount * 100;
            if (score < bestScore) {
                bestScore = score;
                best = key;
            }
        }

        return best ? best.apiKey : null;
    }

    /**
     * 记录使用成功
     */
    consume(apiKey) {
        const idx = this.keyMap.get(apiKey);
        if (idx !== undefined) {
            this.keys[idx].useCount++;
            this.keys[idx].failCount = 0;
            this.keys[idx].lastUsedAt = Date.now();
        }
    }

    /**
     * 标记限流（冷却 60 秒）
     */
    markRateLimited(apiKey) {
        const idx = this.keyMap.get(apiKey);
        if (idx !== undefined) {
            this.keys[idx].coolingUntil = Date.now() + 60000;
        }
    }

    /**
     * 记录失败
     */
    recordFail(apiKey, status) {
        const idx = this.keyMap.get(apiKey);
        if (idx !== undefined) {
            this.keys[idx].failCount++;
            // 连续失败超过 5 次，标记为 disabled
            if (this.keys[idx].failCount >= 5) {
                this.keys[idx].status = 'disabled';
            }
            // 401/403 直接标记为 expired
            if (status === 401 || status === 403) {
                this.keys[idx].status = 'expired';
            }
        }
    }

    getStats() {
        const now = Date.now();
        const total = this.keys.length;
        const active = this.keys.filter(k => k.status === 'active' && k.coolingUntil <= now).length;
        const cooling = this.keys.filter(k => k.status === 'active' && k.coolingUntil > now).length;
        const disabled = this.keys.filter(k => k.status === 'disabled').length;
        const expired = this.keys.filter(k => k.status === 'expired').length;
        return { total, active, cooling, disabled, expired };
    }
}

// ============ Krater Service ============

export class KraterService {
    constructor(config = {}) {
        this.baseUrl = config.baseUrl || KRATER_BASE_URL;
        this.timeout = config.timeout || 120000;
        this.streamTimeout = config.streamTimeout || 60000;
    }

    /**
     * 获取模型列表（从 Krater API）
     */
    async fetchModels(apiKey) {
        try {
            const response = await axios.get(`${this.baseUrl}/v1/models`, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                },
                timeout: 10000,
            });
            return response.data;
        } catch (error) {
            throw this._wrapError(error);
        }
    }

    /**
     * 非流式 Chat Completions
     */
    async chatCompletions(apiKey, body) {
        try {
            const response = await axios.post(`${this.baseUrl}/v1/chat/completions`, {
                ...body,
                stream: false,
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: this.timeout,
            });
            return response.data;
        } catch (error) {
            throw this._wrapError(error);
        }
    }

    /**
     * 流式 Chat Completions - 返回 axios 响应流
     */
    async chatCompletionsStream(apiKey, body) {
        try {
            const response = await axios.post(`${this.baseUrl}/v1/chat/completions`, {
                ...body,
                stream: true,
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                timeout: this.streamTimeout,
                responseType: 'stream',
            });
            return response.data;
        } catch (error) {
            throw this._wrapError(error);
        }
    }

    _wrapError(error) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;
            let message = `Krater API error (${status})`;
            if (data && data.error && data.error.message) {
                message = data.error.message;
            } else if (typeof data === 'string') {
                message = data.substring(0, 200);
            }
            const err = new Error(message);
            err.status = status;
            err.body = typeof data === 'string' ? data : JSON.stringify(data);
            return err;
        }
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            const err = new Error('Krater API request timeout');
            err.status = 504;
            return err;
        }
        return error;
    }
}

export default KraterService;
