/**
 * DigitalOcean Serverless Inference Service
 * 支持 Chat Completions, Models, Images 等 API
 */

const DO_BASE_URL = 'https://inference.do-ai.run';

// DigitalOcean 支持的模型列表（常用）
export const DO_MODELS = [
    'anthropic-claude-3.5-haiku',
    'anthropic-claude-3.5-sonnet',
    'anthropic-claude-sonnet-4',
    'llama3.3-70b-instruct',
    'llama4-maverick-instruct-basic',
    'llama4-scout-instruct-basic',
    'mistral-small-3.1-24b-instruct',
    'openai-gpt-4.1',
    'openai-gpt-4.1-mini',
    'openai-gpt-4.1-nano',
    'openai-gpt-4o',
    'openai-gpt-4o-mini',
    'openai-o3-mini',
    'qwen3-235b-a22b',
    'alibaba-qwen3-32b'
];

export class DigitalOceanService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = DO_BASE_URL;
    }

    /**
     * 获取可用模型列表
     */
    async listModels() {
        const response = await fetch(`${this.baseUrl}/v1/models`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`DigitalOcean API error: ${response.status} - ${error}`);
        }

        return await response.json();
    }

    /**
     * Chat Completions API (非流式)
     */
    async chatCompletion(params) {
        const { model, messages, temperature, max_tokens, top_p, tools, tool_choice } = params;

        const body = {
            model,
            messages,
            temperature: temperature ?? 0.7,
            max_tokens: max_tokens ?? 4096
        };

        if (top_p !== undefined) body.top_p = top_p;
        if (tools) body.tools = tools;
        if (tool_choice) body.tool_choice = tool_choice;

        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`DigitalOcean API error: ${response.status} - ${error}`);
        }

        return await response.json();
    }

    /**
     * Chat Completions API (流式)
     */
    async *chatCompletionStream(params) {
        const { model, messages, temperature, max_tokens, top_p, tools, tool_choice } = params;

        const body = {
            model,
            messages,
            temperature: temperature ?? 0.7,
            max_tokens: max_tokens ?? 4096,
            stream: true
        };

        if (top_p !== undefined) body.top_p = top_p;
        if (tools) body.tools = tools;
        if (tool_choice) body.tool_choice = tool_choice;

        const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`DigitalOcean API error: ${response.status} - ${error}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: ')) continue;

                const data = trimmed.slice(6);
                if (data === '[DONE]') {
                    return;
                }

                try {
                    const parsed = JSON.parse(data);
                    yield parsed;
                } catch (e) {
                    // 忽略解析错误
                }
            }
        }
    }

    /**
     * Responses API (新版)
     */
    async responses(params) {
        const { model, input, max_output_tokens, temperature, stream } = params;

        const body = {
            model,
            input,
            max_output_tokens: max_output_tokens ?? 4096,
            temperature: temperature ?? 0.7,
            stream: stream ?? false
        };

        const response = await fetch(`${this.baseUrl}/v1/responses`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`DigitalOcean API error: ${response.status} - ${error}`);
        }

        return await response.json();
    }

    /**
     * 图像生成
     */
    async generateImage(params) {
        const { model, prompt, n, size } = params;

        const body = {
            model: model || 'openai-gpt-image-1',
            prompt,
            n: n ?? 1,
            size: size ?? '1024x1024'
        };

        const response = await fetch(`${this.baseUrl}/v1/images/generations`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`DigitalOcean API error: ${response.status} - ${error}`);
        }

        return await response.json();
    }

    /**
     * 异步调用 API (fal 模型)
     */
    async asyncInvoke(params) {
        const { model_id, input, tags } = params;

        const body = { model_id, input };
        if (tags) body.tags = tags;

        const response = await fetch(`${this.baseUrl}/v1/async-invoke`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`DigitalOcean API error: ${response.status} - ${error}`);
        }

        return await response.json();
    }

    /**
     * 获取异步任务状态
     */
    async getAsyncStatus(requestId) {
        const response = await fetch(`${this.baseUrl}/v1/async-invoke/${requestId}/status`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            }
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`DigitalOcean API error: ${response.status} - ${error}`);
        }

        return await response.json();
    }

    /**
     * 获取异步任务结果
     */
    async getAsyncResult(requestId) {
        const response = await fetch(`${this.baseUrl}/v1/async-invoke/${requestId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            }
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`DigitalOcean API error: ${response.status} - ${error}`);
        }

        return await response.json();
    }
}

/**
 * 模型名称映射：将通用模型名映射到 DigitalOcean 模型名
 */
export const MODEL_MAPPING = {
    // Claude 模型
    'claude-3-5-haiku-20241022': 'anthropic-claude-3.5-haiku',
    'claude-3-5-sonnet-20241022': 'anthropic-claude-3.5-sonnet',
    'claude-3-5-sonnet-20240620': 'anthropic-claude-3.5-sonnet',
    'claude-sonnet-4-20250514': 'anthropic-claude-sonnet-4',
    'claude-3-haiku': 'anthropic-claude-3.5-haiku',
    'claude-3-sonnet': 'anthropic-claude-3.5-sonnet',

    // OpenAI 模型
    'gpt-4': 'openai-gpt-4.1',
    'gpt-4-turbo': 'openai-gpt-4.1',
    'gpt-4o': 'openai-gpt-4o',
    'gpt-4o-mini': 'openai-gpt-4o-mini',
    'gpt-3.5-turbo': 'openai-gpt-4.1-mini',
    'o3-mini': 'openai-o3-mini',

    // Llama 模型
    'llama-3.3-70b': 'llama3.3-70b-instruct',
    'llama-4-maverick': 'llama4-maverick-instruct-basic',
    'llama-4-scout': 'llama4-scout-instruct-basic'
};

/**
 * 解析模型名称，返回 DigitalOcean 对应的模型名
 */
export function resolveModel(model) {
    return MODEL_MAPPING[model] || model;
}

export default DigitalOceanService;
