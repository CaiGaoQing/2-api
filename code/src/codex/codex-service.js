/**
 * Codex API 服务类
 */
import axios from 'axios';
import crypto from 'crypto';
import { logger } from '../logger.js';
import { getAxiosProxyConfig } from '../proxy.js';
import { refreshCodexToken } from './codex-auth.js';
import { CodexCredentialStore } from '../db.js';

const log = logger.client;

// Codex API 端点
const CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

// Codex 支持的模型
export const CODEX_MODELS = [
    'gpt-5', 'gpt-5-codex', 'gpt-5-codex-mini',
    'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-mini', 'gpt-5.1-codex-max',
    'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.3-codex'
];

// 被禁用的模型（请求失败的模型）
const disabledModels = new Set();

/**
 * 获取当前活跃可用的模型列表（排除已禁用的）
 */
export function getActiveModels() {
    return CODEX_MODELS.filter(m => !disabledModels.has(m));
}

/**
 * 禁用指定模型
 */
export function disableModel(model) {
    if (CODEX_MODELS.includes(model)) {
        disabledModels.add(model);
        log.info(`[Codex] 模型已禁用: ${model}`);
        return true;
    }
    return false;
}

/**
 * 启用指定模型
 */
export function enableModel(model) {
    const removed = disabledModels.delete(model);
    if (removed) log.info(`[Codex] 模型已启用: ${model}`);
    return removed;
}

/**
 * 重置所有禁用模型
 */
export function resetDisabledModels() {
    const count = disabledModels.size;
    disabledModels.clear();
    log.info(`[Codex] 已重置所有禁用模型 (${count} 个)`);
    return count;
}

/**
 * 获取禁用模型列表
 */
export function getDisabledModels() {
    return [...disabledModels];
}

/**
 * 检查模型是否被禁用
 */
export function isModelDisabled(model) {
    return disabledModels.has(model);
}

// 工具名称长度限制
const TOOL_NAME_LIMIT = 64;

// Codex 工具定义
const CODEX_TOOLS = [
    {
        type: "function",
        name: "shell",
        description: "Runs a shell command and returns its output.",
        strict: false,
        parameters: {
            type: "object",
            properties: {
                command: {
                    type: "array",
                    items: { type: "string" },
                    description: "The command to execute"
                },
                workdir: {
                    type: "string",
                    description: "The working directory to execute the command in"
                },
                with_escalated_permissions: {
                    type: "boolean",
                    description: "Whether to request escalated permissions. Set to true if command needs to be run without sandbox restrictions"
                },
                justification: {
                    type: "string",
                    description: "Only set if with_escalated_permissions is true. 1-sentence explanation of why we want to run this command."
                },
                timeout_ms: {
                    type: "number",
                    description: "The timeout for the command in milliseconds"
                }
            },
            required: ["command"],
            additionalProperties: false
        }
    },
    {
        type: "custom",
        name: "apply_patch",
        description: "Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.",
        format: {
            type: "grammar",
            syntax: "lark",
            definition: `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`
        }
    },
    {
        type: "function",
        name: "view_image",
        description: "Attach a local image (by filesystem path) to the conversation context for this turn.",
        strict: false,
        parameters: {
            type: "object",
            properties: {
                path: {
                    type: "string",
                    description: "Local filesystem path to an image file"
                }
            },
            required: ["path"],
            additionalProperties: false
        }
    }
];

// Codex 默认 instructions（包含沙箱配置）
const CODEX_DEFAULT_INSTRUCTIONS = `You are Codex, based on GPT-5. You are running as a coding agent in the Codex CLI on a user's computer.

## General

- The arguments to \`shell\` will be passed to execvp(). Most terminal commands should be prefixed with ["bash", "-lc"].
- Always set the \`workdir\` param when using the shell function. Do not use \`cd\` unless absolutely necessary.
- When searching for text or files, prefer using \`rg\` or \`rg --files\` respectively because \`rg\` is much faster than alternatives like \`grep\`. (If the \`rg\` command is not found, then use alternatives.)

## Editing constraints

- Default to ASCII when editing or creating files. Only introduce non-ASCII or other Unicode characters when there is a clear justification and the file already uses them.
- Try to use apply_patch for single file edits, but it is fine to explore other options to make the edit if it does not work well.
- You may be in a dirty git worktree.
    * NEVER revert existing changes you did not make unless explicitly requested.
    * If asked to make a commit or code edits and there are unrelated changes, don't revert those changes.

## Codex CLI harness, sandboxing, and approvals

Filesystem sandboxing defines which files can be read or written. The options for \`sandbox_mode\` are:
- **read-only**: The sandbox only permits reading files.
- **workspace-write**: The sandbox permits reading files, and editing files in \`cwd\` and \`writable_roots\`. Editing files in other directories requires approval.
- **danger-full-access**: No filesystem sandboxing - all commands are permitted.

Network sandboxing defines whether network can be accessed without approval. Options for \`network_access\` are:
- **restricted**: Requires approval
- **enabled**: No approval needed

Approvals are your mechanism to get user consent to run shell commands without the sandbox. Possible configuration options for \`approval_policy\` are:
- **untrusted**: The harness will escalate most commands for user approval.
- **on-failure**: The harness will allow all commands to run in the sandbox, and failures will be escalated.
- **on-request**: Commands will be run in the sandbox by default, and you can specify if you want to escalate.
- **never**: Non-interactive mode where you may NEVER ask the user for approval.

## Presenting your work

- Default: be very concise; friendly coding teammate tone.
- For code changes: Lead with a quick explanation of the change, then give more details on the context.
- When suggesting multiple options, use numeric lists so the user can quickly respond with a single number.
`;

/**
 * Codex API 服务类
 */
export class CodexService {
    constructor(credential) {
        this.credential = credential;
        this.baseUrl = CODEX_BASE_URL;
        this.conversationCache = new Map();

        // 工具名称映射
        this.toolNameMap = new Map(); // original -> short
        this.reverseToolNameMap = new Map(); // short -> original

        // 配置 axios
        const axiosConfig = { timeout: 120000 };
        const proxyConfig = getAxiosProxyConfig();
        if (proxyConfig) {
            axiosConfig.httpAgent = proxyConfig.httpAgent;
            axiosConfig.httpsAgent = proxyConfig.httpsAgent;
        }
        this.httpClient = axios.create(axiosConfig);
    }

    /**
     * 构建工具名称映射（处理超过 64 字符的工具名）
     */
    buildToolNameMap(tools) {
        this.toolNameMap.clear();
        this.reverseToolNameMap.clear();

        if (!tools || tools.length === 0) return;

        const names = [];
        for (const t of tools) {
            if (t.type === 'function' && t.function?.name) {
                names.push(t.function.name);
            } else if (t.name) {
                names.push(t.name);
            }
        }

        if (names.length === 0) return;

        const used = new Set();

        const baseCandidate = (n) => {
            if (n.length <= TOOL_NAME_LIMIT) return n;
            // 处理 MCP 工具名称格式: mcp__server__toolname
            if (n.startsWith('mcp__')) {
                const idx = n.lastIndexOf('__');
                if (idx > 0) {
                    let cand = 'mcp__' + n.slice(idx + 2);
                    return cand.length > TOOL_NAME_LIMIT ? cand.slice(0, TOOL_NAME_LIMIT) : cand;
                }
            }
            return n.slice(0, TOOL_NAME_LIMIT);
        };

        for (const n of names) {
            let cand = baseCandidate(n);
            let uniq = cand;
            if (used.has(uniq)) {
                for (let i = 1; ; i++) {
                    const suffix = '_' + i;
                    const allowed = TOOL_NAME_LIMIT - suffix.length;
                    const base = cand.slice(0, Math.max(0, allowed));
                    const tmp = base + suffix;
                    if (!used.has(tmp)) {
                        uniq = tmp;
                        break;
                    }
                }
            }
            used.add(uniq);
            this.toolNameMap.set(n, uniq);
            this.reverseToolNameMap.set(uniq, n);
        }
    }

    /**
     * 获取缩短后的工具名称
     */
    getShortToolName(originalName) {
        return this.toolNameMap.get(originalName) || originalName;
    }

    /**
     * 获取原始工具名称
     */
    getOriginalToolName(shortName) {
        return this.reverseToolNameMap.get(shortName) || shortName;
    }

    /**
     * 转换工具格式为 Codex 格式
     */
    convertTools(tools) {
        return tools.map(tool => {
            // 处理 web_search 类型
            if (tool.type === 'web_search_20250305' || tool.type === 'web_search') {
                return { type: 'web_search' };
            }

            if (tool.type !== 'function' && !tool.name && !tool.function) {
                return tool;
            }

            const func = tool.function || tool;
            const originalName = func.name;
            const shortName = this.getShortToolName(originalName);

            const result = {
                type: 'function',
                name: shortName,
                description: func.description || '',
                parameters: func.parameters || func.input_schema || { type: 'object', properties: {} },
                strict: func.strict !== undefined ? func.strict : false
            };

            // 清理参数中的 $schema
            if (result.parameters && result.parameters.$schema) {
                delete result.parameters.$schema;
            }

            return result;
        });
    }

    /**
     * 转换 tool_choice 格式
     */
    convertToolChoice(toolChoice) {
        if (typeof toolChoice === 'string') {
            return toolChoice;
        }

        if (toolChoice && toolChoice.type === 'function') {
            const name = toolChoice.function?.name;
            const shortName = name ? this.getShortToolName(name) : '';
            return {
                type: 'function',
                name: shortName
            };
        }

        return toolChoice;
    }

    /**
     * 从数据库创建服务实例
     */
    static async fromDatabase(credentialId) {
        const store = await CodexCredentialStore.create();
        const credential = await store.getById(credentialId);
        if (!credential) {
            throw new Error(`Codex 凭证 ID ${credentialId} 不存在`);
        }
        return new CodexService(credential);
    }

    /**
     * 获取随机可用凭证创建服务实例
     */
    static async fromRandomActive() {
        const store = await CodexCredentialStore.create();
        const credential = await store.getRandomActive();
        if (!credential) {
            throw new Error('没有可用的 Codex 凭证');
        }
        return new CodexService(credential);
    }

    /**
     * 构建请求头
     */
    buildHeaders(cacheId) {
        return {
            'version': '0.98.0',
            'x-codex-beta-features': 'powershell_utf8',
            'x-oai-web-search-eligible': 'true',
            'session_id': cacheId,
            'accept': 'text/event-stream',
            'authorization': `Bearer ${this.credential.accessToken}`,
            'chatgpt-account-id': this.credential.accountId,
            'content-type': 'application/json',
            'user-agent': 'codex_cli_rs/0.89.0 (Windows 10.0.26100; x86_64) WindowsTerminal',
            'originator': 'codex_cli_rs',
            'host': 'chatgpt.com',
            'Connection': 'close'
        };
    }

    /**
     * 获取或创建会话缓存 ID
     */
    getCacheId(model, userId = 'default') {
        const cacheKey = `${model}-${userId}`;
        let cache = this.conversationCache.get(cacheKey);

        if (!cache || cache.expire < Date.now()) {
            cache = {
                id: crypto.randomUUID(),
                expire: Date.now() + 3600000 // 1 小时
            };
            this.conversationCache.set(cacheKey, cache);
        }
        return cache.id;
    }

    /**
     * 检查 Token 是否即将过期
     */
    isTokenExpiringSoon(minutesThreshold = 20) {
        if (!this.credential.expiresAt) return true;
        const expiresAt = new Date(this.credential.expiresAt).getTime();
        const threshold = minutesThreshold * 60 * 1000;
        return (expiresAt - Date.now()) < threshold;
    }

    /**
     * 刷新 Token
     */
    async refreshToken() {
        try {
            const newTokens = await refreshCodexToken(this.credential.refreshToken);

            // 更新数据库
            const store = await CodexCredentialStore.create();
            await store.updateTokens(this.credential.id, newTokens);

            // 更新本地凭证
            this.credential.accessToken = newTokens.accessToken;
            this.credential.refreshToken = newTokens.refreshToken;
            this.credential.idToken = newTokens.idToken;
            this.credential.expiresAt = newTokens.expiresAt;

            log.info(`[Codex] Token 刷新成功: ${this.credential.email}`);
            return true;
        } catch (error) {
            log.error(`[Codex] Token 刷新失败:`, error.message);

            // 记录错误
            const store = await CodexCredentialStore.create();
            await store.incrementErrorCount(this.credential.id, error.message);

            throw error;
        }
    }

    /**
     * 发送聊天请求（流式）
     * @param {string} model - 模型名称
     * @param {Array} messages - 消息数组
     * @param {Object} options - 选项
     * @param {string} options.system - 系统提示
     * @param {Array} options.tools - 自定义工具列表
     * @param {string|Object} options.toolChoice - 工具选择策略
     * @param {string} options.cwd - 工作目录
     * @param {string} options.sandboxMode - 沙箱模式
     * @param {string} options.approvalPolicy - 审批策略
     * @param {string} options.networkAccess - 网络访问
     * @param {string} options.reasoningEffort - 推理强度
     * @param {string} options.userId - 用户 ID
     * @param {boolean} options.parallelToolCalls - 是否并行调用工具
     */
    async *chatStream(model, messages, options = {}) {
        // 检查 Token 是否需要刷新，或缺少 accountId
        if (this.isTokenExpiringSoon() || !this.credential.accountId) {
            log.info(`[Codex] Token 即将过期或缺少 accountId，正在刷新...`);
            await this.refreshToken();
        }

        const cacheId = this.getCacheId(model, options.userId);
        const headers = this.buildHeaders(cacheId);
        const url = `${this.baseUrl}/responses`;

        // 处理自定义工具
        let tools = [...CODEX_TOOLS];
        if (options.tools && options.tools.length > 0) {
            // 构建工具名称映射
            this.buildToolNameMap(options.tools);
            // 转换工具格式
            const customTools = this.convertTools(options.tools);
            tools = [...tools, ...customTools];
        }

        // 构建 Codex 格式的请求体
        const input = this.formatMessages(messages);

        // 在 input 开头注入特殊指令
        if (input.length > 0 && options.system) {
            input.unshift({
                type: 'message',
                role: 'user',
                content: [{
                    type: 'input_text',
                    text: 'EXECUTE ACCORDING TO THE FOLLOWING INSTRUCTIONS!!!'
                }]
            });
        }

        // 构建环境上下文
        const envContext = {
            cwd: options.cwd || process.cwd(),
            approval_policy: options.approvalPolicy || 'on-request',
            sandbox_mode: options.sandboxMode || 'workspace-write',
            network_access: options.networkAccess || 'enabled',
            shell: process.platform === 'win32' ? 'powershell.exe' : 'bash'
        };

        // 在 input 开头注入环境上下文
        const envMessage = {
            type: 'message',
            role: 'user',
            content: [{
                type: 'input_text',
                text: `<environment_context>
  <cwd>${envContext.cwd}</cwd>
  <approval_policy>${envContext.approval_policy}</approval_policy>
  <sandbox_mode>${envContext.sandbox_mode}</sandbox_mode>
  <network_access>${envContext.network_access}</network_access>
  <shell>${envContext.shell}</shell>
</environment_context>`
            }]
        };

        // 合并 instructions
        const finalInstructions = options.system
            ? `${CODEX_DEFAULT_INSTRUCTIONS}\n\n${options.system}`
            : CODEX_DEFAULT_INSTRUCTIONS;

        // 处理 tool_choice
        const toolChoice = options.toolChoice
            ? this.convertToolChoice(options.toolChoice)
            : 'auto';

        const body = {
            model: model,
            instructions: finalInstructions,
            input: [envMessage, ...input],
            tools: tools,
            tool_choice: toolChoice,
            parallel_tool_calls: options.parallelToolCalls !== false,
            stream: true,
            store: false,
            reasoning: {
                effort: options.reasoningEffort || 'medium',
                summary: 'auto'
            },
            include: ['reasoning.encrypted_content'],
            prompt_cache_key: cacheId
        };

        try {
            // 检查凭证完整性
            if (!this.credential.accessToken) {
                throw new Error('缺少 accessToken，请先刷新凭证');
            }
            if (!this.credential.accountId) {
                throw new Error('缺少 accountId，请检查凭证配置');
            }

            log.info(`[Codex] 发送请求到 ${url}, model: ${model}, accountId: ${this.credential.accountId?.substring(0, 8)}...`);
            log.debug(`[Codex] 请求体:`, JSON.stringify(body));

            const response = await this.httpClient.post(url, body, {
                headers,
                responseType: 'stream'
            });

            // 增加使用计数
            const store = await CodexCredentialStore.create();
            await store.incrementUseCount(this.credential.id);

            yield* this.parseSSEStream(response.data);
        } catch (error) {
            log.error(`[Codex] 请求失败:`, error.message);
            if (error.response) {
                log.error(`[Codex] 状态码: ${error.response.status}`);
                // 安全地获取响应数据
                try {
                    const responseData = error.response.data;
                    if (typeof responseData === 'string') {
                        log.error(`[Codex] 响应数据: ${responseData}`);
                    } else if (responseData && typeof responseData === 'object') {
                        // 如果是流，尝试读取
                        if (typeof responseData.on === 'function') {
                            let errorBody = '';
                            responseData.on('data', chunk => errorBody += chunk.toString());
                            responseData.on('end', () => log.error(`[Codex] 响应数据: ${errorBody}`));
                        } else {
                            log.error(`[Codex] 响应数据: ${JSON.stringify(responseData)}`);
                        }
                    }
                } catch (logError) {
                    log.error(`[Codex] 无法解析响应数据`);
                }
            }
            await this.handleError(error);
            throw error;
        }
    }

    /**
     * 发送聊天请求（非流式）
     */
    async chat(model, messages, options = {}) {
        const chunks = [];
        for await (const chunk of this.chatStream(model, messages, options)) {
            if (chunk.type === 'content') {
                chunks.push(chunk.data);
            }
        }
        return chunks.join('');
    }

    /**
     * 格式化消息为 Codex 格式
     * 支持: user, assistant, tool (function_call_output), function_call, reasoning
     */
    formatMessages(messages) {
        const input = [];

        for (const msg of messages) {
            const role = msg.role;
            const content = msg.content;

            // 处理工具调用结果 (OpenAI 格式: role=tool)
            if (role === 'tool') {
                input.push({
                    type: 'function_call_output',
                    call_id: msg.tool_call_id,
                    output: typeof content === 'string' ? content : JSON.stringify(content)
                });
                continue;
            }

            // 处理 Codex 原生格式的 function_call_output
            if (msg.type === 'function_call_output') {
                input.push({
                    type: 'function_call_output',
                    call_id: msg.call_id,
                    output: msg.output
                });
                continue;
            }

            // 处理 Codex 原生格式的 function_call
            if (msg.type === 'function_call') {
                input.push({
                    type: 'function_call',
                    call_id: msg.call_id,
                    name: msg.name,
                    arguments: msg.arguments
                });
                continue;
            }

            // 处理 Codex 原生格式的 reasoning
            if (msg.type === 'reasoning') {
                input.push({
                    type: 'reasoning',
                    summary: msg.summary,
                    content: msg.content || null,
                    encrypted_content: msg.encrypted_content || null
                });
                continue;
            }

            // 处理 user 和 assistant 消息
            if (role === 'user' || role === 'assistant') {
                const isAssistant = role === 'assistant';

                // 处理 assistant 消息中的 tool_calls (OpenAI 格式)
                if (isAssistant && msg.tool_calls && Array.isArray(msg.tool_calls)) {
                    // 先添加文本内容（如果有）
                    let textContent = '';
                    if (typeof content === 'string') {
                        textContent = content;
                    } else if (Array.isArray(content)) {
                        textContent = content
                            .filter(c => c.type === 'text')
                            .map(c => c.text || '')
                            .join('');
                    }

                    if (textContent) {
                        input.push({
                            type: 'message',
                            role: 'assistant',
                            content: [{
                                type: 'output_text',
                                text: textContent
                            }]
                        });
                    }

                    // 添加工具调用
                    for (const toolCall of msg.tool_calls) {
                        const func = toolCall.function || toolCall;
                        input.push({
                            type: 'function_call',
                            call_id: toolCall.id,
                            name: func.name,
                            arguments: typeof func.arguments === 'string'
                                ? func.arguments
                                : JSON.stringify(func.arguments)
                        });
                    }
                    continue;
                }

                // 普通文本消息
                let textContent = '';
                if (typeof content === 'string') {
                    textContent = content;
                } else if (Array.isArray(content)) {
                    textContent = content
                        .filter(c => c.type === 'text' || c.type === 'input_text' || c.type === 'output_text')
                        .map(c => c.text || '')
                        .join('');
                }

                if (textContent) {
                    input.push({
                        type: 'message',
                        role: role,
                        content: [{
                            type: isAssistant ? 'output_text' : 'input_text',
                            text: textContent
                        }]
                    });
                }
            }
        }

        return input;
    }

    /**
     * 解析 SSE 流
     */
    async *parseSSEStream(stream) {
        let buffer = '';

        for await (const chunk of stream) {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6).trim();
                    if (data && data !== '[DONE]') {
                        try {
                            const parsed = JSON.parse(data);
                            yield this.transformEvent(parsed);
                        } catch (e) {
                            // 忽略解析错误
                        }
                    }
                }
            }
        }

        // 处理剩余 buffer
        if (buffer.startsWith('data: ')) {
            const data = buffer.slice(6).trim();
            if (data && data !== '[DONE]') {
                try {
                    const parsed = JSON.parse(data);
                    yield this.transformEvent(parsed);
                } catch (e) {
                    // 忽略
                }
            }
        }
    }

    /**
     * 转换事件格式
     */
    transformEvent(event) {
        // 文本输出
        if (event.type === 'response.output_text.delta') {
            return { type: 'content', data: event.delta || '' };
        }
        // 完成事件
        if (event.type === 'response.completed') {
            // 恢复工具名称
            if (event.response?.output) {
                for (const item of event.response.output) {
                    if (item.type === 'function_call' && item.name) {
                        item.name = this.getOriginalToolName(item.name);
                    }
                }
            }
            return { type: 'done', data: event };
        }
        // 工具调用开始
        if (event.type === 'response.function_call_arguments.start') {
            return {
                type: 'tool_call_start',
                data: {
                    call_id: event.call_id,
                    name: this.getOriginalToolName(event.name)
                }
            };
        }
        // 工具调用参数增量
        if (event.type === 'response.function_call_arguments.delta') {
            return {
                type: 'tool_call_delta',
                data: {
                    call_id: event.call_id,
                    delta: event.delta || ''
                }
            };
        }
        // 工具调用完成
        if (event.type === 'response.function_call_arguments.done') {
            return {
                type: 'tool_call_done',
                data: {
                    call_id: event.call_id,
                    name: this.getOriginalToolName(event.name),
                    arguments: event.arguments
                }
            };
        }
        // apply_patch 自定义工具输出
        if (event.type === 'response.custom_tool_output.delta') {
            return {
                type: 'tool_output_delta',
                data: {
                    name: this.getOriginalToolName(event.name),
                    delta: event.delta || ''
                }
            };
        }
        if (event.type === 'response.custom_tool_output.done') {
            return {
                type: 'tool_output_done',
                data: {
                    name: this.getOriginalToolName(event.name),
                    output: event.output
                }
            };
        }
        // 处理 response.output_item.done 事件（包含完整的工具调用信息）
        if (event.type === 'response.output_item.done') {
            if (event.item?.type === 'function_call' && event.item.name) {
                event.item.name = this.getOriginalToolName(event.item.name);
            }
            return { type: event.type, data: event };
        }
        // 推理摘要
        if (event.type === 'response.reasoning_summary_text.delta') {
            return {
                type: 'reasoning',
                data: event.delta || ''
            };
        }
        // 其他事件
        return { type: event.type, data: event };
    }

    /**
     * 处理错误
     */
    async handleError(error) {
        if (error.response?.status === 401) {
            log.warn(`[Codex] 401 错误，标记凭证需要刷新`);
            const store = await CodexCredentialStore.create();
            await store.incrementErrorCount(this.credential.id, '401 Unauthorized');
        }
    }

    /**
     * 获取使用限制（原始数据）
     */
    async getUsageLimitsRaw() {
        // 检查 Token 是否需要刷新
        if (this.isTokenExpiringSoon()) {
            log.info(`[Codex] Token 即将过期，正在刷新...`);
            await this.refreshToken();
        }

        const headers = {
            'user-agent': 'codex_cli_rs/0.89.0 (Windows 10.0.26100; x86_64)',
            'authorization': `Bearer ${this.credential.accessToken}`,
            'chatgpt-account-id': this.credential.accountId,
            'accept': '*/*',
            'host': 'chatgpt.com'
        };

        try {
            const response = await this.httpClient.get(CODEX_USAGE_URL, { headers });
            return response.data;
        } catch (error) {
            log.error(`[Codex] 获取使用限制失败:`, error.message);
            // 如果是 401 错误，尝试刷新 Token 后重试一次
            if (error.response?.status === 401) {
                log.info(`[Codex] 401 错误，尝试刷新 Token 后重试...`);
                try {
                    await this.refreshToken();
                    // 更新 headers 中的 token
                    headers.authorization = `Bearer ${this.credential.accessToken}`;
                    const retryResponse = await this.httpClient.get(CODEX_USAGE_URL, { headers });
                    return retryResponse.data;
                } catch (retryError) {
                    log.error(`[Codex] 刷新 Token 后重试仍失败:`, retryError.message);
                    throw retryError;
                }
            }
            throw error;
        }
    }

    /**
     * 获取使用限制（格式化数据）
     */
    async getUsageLimits() {
        const raw = await this.getUsageLimitsRaw();
        log.info(`[Codex] 原始用量数据: ${JSON.stringify(raw)}`);
        const formatted = CodexService.formatUsage(raw, this.credential);
        log.info(`[Codex] 格式化后用量数据: ${JSON.stringify(formatted?.summary)}`);
        return formatted;
    }

    /**
     * 格式化用量数据
     */
    static formatUsage(raw, credential = {}) {
        if (!raw) return null;

        const result = {
            credentialId: credential.id,
            email: credential.email || credential.name,
            planType: raw.plan_type || 'unknown',
            lastUpdated: new Date().toISOString(),
            
            // 主窗口配额
            primaryWindow: null,
            // 次窗口配额
            secondaryWindow: null,
            // Credits
            credits: raw.credits || null,
            // 代码审查限制
            codeReviewLimit: null,
            
            // 汇总信息
            summary: {
                usedPercent: 0,
                remainingPercent: 100,
                resetTime: null,
                resetTimeFormatted: null
            }
        };

        // 解析单个配额窗口的通用函数
        const parseWindow = (w) => {
            if (!w) return null;
            let usedPercent = w.used_percent ?? w.usedPercent ?? 0;
            if (usedPercent > 0 && usedPercent <= 1) {
                usedPercent = usedPercent * 100;
            }
            const resetAt = w.reset_at ?? w.resets_at ?? null;
            return {
                usedPercent,
                remainingPercent: 100 - usedPercent,
                resetAt: resetAt ? new Date(resetAt * 1000).toISOString() : null,
                resetAtTimestamp: resetAt
            };
        };

        // 兼容两种字段名: primary_window/secondary_window 和 primary/secondary
        const rl = raw.rate_limit || raw.rate_limits || {};
        const primaryData = rl.primary_window || rl.primary || null;
        const secondaryData = rl.secondary_window || rl.secondary || null;
        log.info(`[Codex] rate_limit keys: ${JSON.stringify(Object.keys(rl))}, primary: ${!!primaryData}, secondary: ${!!secondaryData}`);

        // 解析主窗口
        if (primaryData) {
            result.primaryWindow = parseWindow(primaryData);
            if (result.primaryWindow) {
                result.summary.usedPercent = result.primaryWindow.usedPercent;
                result.summary.remainingPercent = result.primaryWindow.remainingPercent;
                if (result.primaryWindow.resetAtTimestamp) {
                    result.summary.resetTime = result.primaryWindow.resetAt;
                    result.summary.resetTimeFormatted = CodexService.formatResetTime(result.primaryWindow.resetAtTimestamp);
                }
            }
        }

        // 解析次窗口
        if (secondaryData) {
            result.secondaryWindow = parseWindow(secondaryData);
        }

        // 解析代码审查限制
        if (raw.code_review_rate_limit) {
            const cr = raw.code_review_rate_limit;
            let crUsedPercent = cr.used_percent || 0;
            if (crUsedPercent > 0 && crUsedPercent <= 1) {
                crUsedPercent = crUsedPercent * 100;
            }
            result.codeReviewLimit = {
                usedPercent: crUsedPercent,
                remainingPercent: 100 - crUsedPercent,
                resetAt: cr.reset_at ? new Date(cr.reset_at * 1000).toISOString() : null
            };
        }

        return result;
    }

    /**
     * 格式化重置时间为易读格式
     */
    static formatResetTime(timestamp) {
        if (!timestamp) return null;
        const resetDate = new Date(timestamp * 1000);
        const now = new Date();
        const diffMs = resetDate.getTime() - now.getTime();
        
        if (diffMs <= 0) return '已重置';
        
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        if (diffHours > 24) {
            const days = Math.floor(diffHours / 24);
            return `${days}天后`;
        } else if (diffHours > 0) {
            return `${diffHours}小时${diffMinutes}分钟后`;
        } else {
            return `${diffMinutes}分钟后`;
        }
    }

    /**
     * 列出可用模型
     */
    listModels() {
        return CODEX_MODELS.map(id => ({
            id,
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'openai'
        }));
    }

    /**
     * 测试凭证是否有效
     */
    async testCredential() {
        try {
            await this.getUsageLimits();
            return { success: true, message: '凭证有效' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * 带工具调用循环的聊天方法
     * 自动处理工具调用并执行，直到模型完成任务
     *
     * @param {string} model - 模型名称
     * @param {Array} messages - 初始消息
     * @param {Object} options - 选项
     * @param {Function} options.onToolCall - 工具调用回调，返回执行结果
     * @param {Function} options.onContent - 内容输出回调
     * @param {Function} options.onReasoning - 推理输出回调
     * @param {number} options.maxIterations - 最大迭代次数，默认 20
     * @returns {Object} - { content, toolCalls, iterations }
     */
    async chatWithTools(model, messages, options = {}) {
        const {
            onToolCall,
            onContent,
            onReasoning,
            maxIterations = 20,
            ...chatOptions
        } = options;

        if (!onToolCall) {
            throw new Error('chatWithTools 需要提供 onToolCall 回调函数');
        }

        // 使用 Codex 原生格式存储对话历史
        let conversationHistory = [];
        let iterations = 0;
        let finalContent = '';
        const allToolCalls = [];

        // 初始化：转换初始消息
        const initialInput = this.formatMessages(messages);

        while (iterations < maxIterations) {
            iterations++;
            log.info(`[Codex] 工具调用循环 - 迭代 ${iterations}`);

            // 收集本轮响应
            let currentContent = '';
            let currentReasoning = '';
            const pendingToolCalls = [];
            let hasToolCall = false;

            // 构建本轮输入
            const input = iterations === 1 ? initialInput : [];

            // 发送请求
            for await (const chunk of this.chatStream(model, [...messages, ...conversationHistory], {
                ...chatOptions,
                _rawInput: input  // 传递原始输入（如果需要）
            })) {
                switch (chunk.type) {
                    case 'content':
                        currentContent += chunk.data;
                        if (onContent) onContent(chunk.data);
                        break;

                    case 'reasoning':
                        currentReasoning += chunk.data;
                        if (onReasoning) onReasoning(chunk.data);
                        break;

                    case 'tool_call_done':
                        hasToolCall = true;
                        pendingToolCalls.push(chunk.data);
                        break;

                    case 'response.output_item.done':
                        // 处理完整的工具调用事件
                        if (chunk.data?.item?.type === 'function_call') {
                            hasToolCall = true;
                            pendingToolCalls.push({
                                call_id: chunk.data.item.call_id,
                                name: chunk.data.item.name,
                                arguments: chunk.data.item.arguments
                            });
                        }
                        break;
                }
            }

            // 保存本轮内容到历史
            if (currentContent) {
                finalContent += currentContent;
                conversationHistory.push({
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: currentContent }]
                });
            }

            // 如果没有工具调用，结束循环
            if (!hasToolCall || pendingToolCalls.length === 0) {
                log.info(`[Codex] 无工具调用，结束循环`);
                break;
            }

            // 处理工具调用
            for (const toolCall of pendingToolCalls) {
                log.info(`[Codex] 执行工具: ${toolCall.name}, call_id: ${toolCall.call_id}`);

                // 添加 function_call 到历史
                conversationHistory.push({
                    type: 'function_call',
                    call_id: toolCall.call_id,
                    name: toolCall.name,
                    arguments: toolCall.arguments
                });

                // 解析参数
                let args = toolCall.arguments;
                if (typeof args === 'string') {
                    try {
                        args = JSON.parse(args);
                    } catch (e) {
                        // 保持字符串格式（apply_patch 等自定义工具）
                    }
                }

                // 调用用户提供的工具执行函数
                let result;
                try {
                    result = await onToolCall({
                        name: toolCall.name,
                        arguments: args,
                        call_id: toolCall.call_id
                    });
                } catch (error) {
                    result = `Error: ${error.message}`;
                }

                // 添加 function_call_output 到历史
                const output = typeof result === 'string' ? result : JSON.stringify(result);
                conversationHistory.push({
                    type: 'function_call_output',
                    call_id: toolCall.call_id,
                    output: output
                });

                allToolCalls.push({
                    ...toolCall,
                    result: output
                });
            }
        }

        if (iterations >= maxIterations) {
            log.warn(`[Codex] 达到最大迭代次数 ${maxIterations}`);
        }

        return {
            content: finalContent,
            toolCalls: allToolCalls,
            iterations
        };
    }
}

export default CodexService;

/**
 * 工具调用使用示例
 *
 * @example
 * ```javascript
 * import { CodexService } from './codex-service.js';
 * import { exec } from 'child_process';
 * import { promisify } from 'util';
 * import fs from 'fs/promises';
 *
 * const execAsync = promisify(exec);
 *
 * // 创建服务实例
 * const service = await CodexService.fromRandomActive();
 *
 * // 工具执行函数
 * async function executeToolCall({ name, arguments: args, call_id }) {
 *     console.log(`执行工具: ${name}`);
 *
 *     if (name === 'shell') {
 *         const command = args.command.join(' ');
 *         const workdir = args.workdir || process.cwd();
 *         try {
 *             const { stdout, stderr } = await execAsync(command, { cwd: workdir, timeout: args.timeout_ms || 30000 });
 *             return `Exit code: 0\nOutput:\n${stdout}${stderr ? '\nStderr:\n' + stderr : ''}`;
 *         } catch (error) {
 *             return `Exit code: ${error.code || 1}\nError:\n${error.message}`;
 *         }
 *     }
 *
 *     if (name === 'apply_patch') {
 *         // args 是 patch 字符串，需要解析并应用
 *         // 这里需要实现 patch 解析逻辑
 *         return 'Patch applied successfully';
 *     }
 *
 *     if (name === 'view_image') {
 *         const imageData = await fs.readFile(args.path, 'base64');
 *         return `Image loaded: ${args.path}`;
 *     }
 *
 *     return `Unknown tool: ${name}`;
 * }
 *
 * // 执行带工具调用的对话
 * const result = await service.chatWithTools('gpt-5-codex', [
 *     { role: 'user', content: '列出当前目录的文件' }
 * ], {
 *     cwd: '/path/to/project',
 *     sandboxMode: 'workspace-write',
 *     onToolCall: executeToolCall,
 *     onContent: (text) => process.stdout.write(text),
 *     onReasoning: (text) => console.log('[Reasoning]', text)
 * });
 *
 * console.log('完成！');
 * console.log('总迭代次数:', result.iterations);
 * console.log('工具调用次数:', result.toolCalls.length);
 * ```
 */