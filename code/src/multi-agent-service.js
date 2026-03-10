/**
 * 多代理循环系统 (Multi-Agent Loop System)
 * 
 * 实现原理：
 * 1. 用户提问 → 发送到 AI
 * 2. AI 返回响应（可能包含工具调用）
 * 3. 如果有工具调用 → 执行工具 → 将结果回传给 AI
 * 4. 循环直到 AI 返回最终答案（无工具调用）
 * 
 * 参考 Warp 的 /ai/multi-agent 接口实现
 */

import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

// ==================== 工具定义 ====================

/**
 * 可用工具列表
 */
const AVAILABLE_TOOLS = {
    // 文件系统工具
    list_dir: {
        name: 'list_dir',
        description: '列出目录内容',
        parameters: {
            path: { type: 'string', description: '目录路径', required: true }
        },
        handler: async (params) => {
            const files = await fs.readdir(params.path, { withFileTypes: true });
            return files.map(f => ({
                name: f.name,
                type: f.isDirectory() ? 'directory' : 'file'
            }));
        }
    },
    
    read_file: {
        name: 'read_file',
        description: '读取文件内容',
        parameters: {
            path: { type: 'string', description: '文件路径', required: true },
            limit: { type: 'number', description: '最大行数', required: false }
        },
        handler: async (params) => {
            const content = await fs.readFile(params.path, 'utf-8');
            if (params.limit) {
                return content.split('\n').slice(0, params.limit).join('\n');
            }
            return content;
        }
    },
    
    write_file: {
        name: 'write_file',
        description: '写入文件',
        parameters: {
            path: { type: 'string', description: '文件路径', required: true },
            content: { type: 'string', description: '文件内容', required: true }
        },
        handler: async (params) => {
            await fs.writeFile(params.path, params.content, 'utf-8');
            return { success: true, message: `文件已写入: ${params.path}` };
        }
    },
    
    // Shell 命令工具
    run_command: {
        name: 'run_command',
        description: '执行 shell 命令',
        parameters: {
            command: { type: 'string', description: '要执行的命令', required: true },
            cwd: { type: 'string', description: '工作目录', required: false }
        },
        handler: async (params) => {
            try {
                const { stdout, stderr } = await execAsync(params.command, {
                    cwd: params.cwd || process.cwd(),
                    timeout: 30000,
                    maxBuffer: 1024 * 1024
                });
                return { stdout, stderr, exitCode: 0 };
            } catch (error) {
                return { 
                    stdout: error.stdout || '', 
                    stderr: error.stderr || error.message,
                    exitCode: error.code || 1 
                };
            }
        }
    },
    
    // 搜索工具
    grep_search: {
        name: 'grep_search',
        description: '在文件中搜索内容',
        parameters: {
            pattern: { type: 'string', description: '搜索模式', required: true },
            path: { type: 'string', description: '搜索路径', required: true }
        },
        handler: async (params) => {
            try {
                const { stdout } = await execAsync(
                    `grep -rn "${params.pattern}" "${params.path}" 2>/dev/null | head -50`,
                    { maxBuffer: 1024 * 1024 }
                );
                return stdout || '未找到匹配内容';
            } catch (error) {
                return '未找到匹配内容';
            }
        }
    }
};

// ==================== 会话管理 ====================

/**
 * 会话存储
 */
class SessionStore {
    constructor() {
        this.sessions = new Map();
    }
    
    create(userId) {
        const sessionId = uuidv4();
        const session = {
            id: sessionId,
            userId,
            messages: [],      // 对话历史
            toolCalls: [],     // 工具调用历史
            context: {},       // 上下文信息
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.sessions.set(sessionId, session);
        return session;
    }
    
    get(sessionId) {
        return this.sessions.get(sessionId);
    }
    
    addMessage(sessionId, role, content, toolCallId = null) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        
        const message = {
            id: uuidv4(),
            role,
            content,
            toolCallId,
            timestamp: new Date()
        };
        session.messages.push(message);
        session.updatedAt = new Date();
        return message;
    }
    
    addToolCall(sessionId, toolCall) {
        const session = this.sessions.get(sessionId);
        if (!session) return null;
        
        session.toolCalls.push({
            ...toolCall,
            timestamp: new Date()
        });
        session.updatedAt = new Date();
        return toolCall;
    }
    
    getHistory(sessionId) {
        const session = this.sessions.get(sessionId);
        return session ? session.messages : [];
    }
    
    delete(sessionId) {
        return this.sessions.delete(sessionId);
    }
}

// ==================== 多代理循环核心 ====================

/**
 * 多代理服务
 */
export class MultiAgentService {
    constructor(options = {}) {
        this.sessionStore = new SessionStore();
        this.tools = { ...AVAILABLE_TOOLS, ...options.customTools };
        this.maxIterations = options.maxIterations || 10;  // 最大循环次数
        this.aiClient = options.aiClient;  // AI 客户端（如 OpenAI、Claude 等）
        this.onToolCall = options.onToolCall;  // 工具调用回调
        this.onIteration = options.onIteration;  // 每次迭代回调
    }
    
    /**
     * 注册自定义工具
     */
    registerTool(name, tool) {
        this.tools[name] = tool;
    }
    
    /**
     * 构建工具定义（用于发送给 AI）
     */
    buildToolDefinitions() {
        return Object.values(this.tools).map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: {
                    type: 'object',
                    properties: Object.fromEntries(
                        Object.entries(tool.parameters).map(([key, param]) => [
                            key,
                            { type: param.type, description: param.description }
                        ])
                    ),
                    required: Object.entries(tool.parameters)
                        .filter(([_, param]) => param.required)
                        .map(([key]) => key)
                }
            }
        }));
    }
    
    /**
     * 执行工具调用
     */
    async executeTool(toolName, params) {
        const tool = this.tools[toolName];
        if (!tool) {
            throw new Error(`未知工具: ${toolName}`);
        }
        
        try {
            const result = await tool.handler(params);
            return {
                success: true,
                result: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 核心：多代理循环处理
     * 
     * @param {string} userQuery - 用户问题
     * @param {object} options - 选项
     * @returns {AsyncGenerator} - 流式返回结果
     */
    async *processQuery(userQuery, options = {}) {
        const sessionId = options.sessionId || this.sessionStore.create(options.userId || 'anonymous').id;
        const session = this.sessionStore.get(sessionId);
        
        // 添加用户消息
        this.sessionStore.addMessage(sessionId, 'user', userQuery);
        
        let iteration = 0;
        let isComplete = false;
        
        while (!isComplete && iteration < this.maxIterations) {
            iteration++;
            
            // 发送迭代开始事件
            yield {
                type: 'iteration_start',
                iteration,
                sessionId
            };
            
            // 构建请求消息
            const messages = this.buildMessages(session);
            
            // 调用 AI
            const aiResponse = await this.callAI(messages, options);
            
            // 发送 AI 响应事件
            yield {
                type: 'ai_response',
                iteration,
                content: aiResponse.content,
                toolCalls: aiResponse.toolCalls
            };
            
            // 检查是否有工具调用
            if (aiResponse.toolCalls && aiResponse.toolCalls.length > 0) {
                // 添加 AI 消息（带工具调用）
                this.sessionStore.addMessage(sessionId, 'assistant', aiResponse.content || '', null);
                
                // 执行所有工具调用
                for (const toolCall of aiResponse.toolCalls) {
                    const toolCallId = toolCall.id || uuidv4();
                    
                    // 发送工具调用开始事件
                    yield {
                        type: 'tool_call_start',
                        iteration,
                        toolCallId,
                        toolName: toolCall.function.name,
                        arguments: toolCall.function.arguments
                    };
                    
                    // 回调通知
                    if (this.onToolCall) {
                        await this.onToolCall(toolCall);
                    }
                    
                    // 解析参数并执行工具
                    let params;
                    try {
                        params = typeof toolCall.function.arguments === 'string'
                            ? JSON.parse(toolCall.function.arguments)
                            : toolCall.function.arguments;
                    } catch (e) {
                        params = {};
                    }
                    
                    const toolResult = await this.executeTool(toolCall.function.name, params);
                    
                    // 记录工具调用
                    this.sessionStore.addToolCall(sessionId, {
                        id: toolCallId,
                        name: toolCall.function.name,
                        params,
                        result: toolResult
                    });
                    
                    // 添加工具结果消息
                    this.sessionStore.addMessage(
                        sessionId, 
                        'tool', 
                        toolResult.success ? toolResult.result : `错误: ${toolResult.error}`,
                        toolCallId
                    );
                    
                    // 发送工具调用完成事件
                    yield {
                        type: 'tool_call_end',
                        iteration,
                        toolCallId,
                        toolName: toolCall.function.name,
                        result: toolResult
                    };
                }
                
                // 继续循环，将工具结果发送给 AI
            } else {
                // 没有工具调用，AI 返回最终答案
                this.sessionStore.addMessage(sessionId, 'assistant', aiResponse.content);
                isComplete = true;
                
                // 发送完成事件
                yield {
                    type: 'complete',
                    iteration,
                    sessionId,
                    finalResponse: aiResponse.content
                };
            }
            
            // 迭代回调
            if (this.onIteration) {
                await this.onIteration(iteration, isComplete);
            }
        }
        
        // 超过最大迭代次数
        if (!isComplete) {
            yield {
                type: 'max_iterations_reached',
                iteration,
                sessionId
            };
        }
    }
    
    /**
     * 构建发送给 AI 的消息列表
     */
    buildMessages(session) {
        const messages = [];
        
        // 系统提示
        messages.push({
            role: 'system',
            content: this.buildSystemPrompt()
        });
        
        // 历史消息
        for (const msg of session.messages) {
            if (msg.role === 'user') {
                messages.push({ role: 'user', content: msg.content });
            } else if (msg.role === 'assistant') {
                messages.push({ role: 'assistant', content: msg.content });
            } else if (msg.role === 'tool') {
                messages.push({
                    role: 'tool',
                    tool_call_id: msg.toolCallId,
                    content: msg.content
                });
            }
        }
        
        return messages;
    }
    
    /**
     * 构建系统提示
     */
    buildSystemPrompt() {
        const toolDescriptions = Object.values(this.tools)
            .map(t => `- ${t.name}: ${t.description}`)
            .join('\n');
        
        return `你是一个智能助手，可以使用以下工具来帮助用户完成任务：

${toolDescriptions}

使用工具时：
1. 分析用户需求，决定需要使用哪些工具
2. 调用工具获取信息或执行操作
3. 根据工具返回的结果，继续分析或给出最终答案
4. 如果一个工具调用失败，尝试其他方法或向用户说明

请用中文回复用户。`;
    }
    
    /**
     * 调用 AI（需要根据实际使用的 AI 服务实现）
     */
    async callAI(messages, options = {}) {
        if (this.aiClient) {
            // 使用注入的 AI 客户端
            return await this.aiClient.chat(messages, {
                tools: this.buildToolDefinitions(),
                ...options
            });
        }
        
        // 默认实现：使用 OpenAI 兼容接口
        const response = await fetch(options.apiUrl || 'http://localhost:3456/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${options.apiKey || 'sk-test'}`
            },
            body: JSON.stringify({
                model: options.model || 'gpt-4',
                messages,
                tools: this.buildToolDefinitions(),
                tool_choice: 'auto'
            })
        });
        
        const data = await response.json();
        const choice = data.choices?.[0];
        
        return {
            content: choice?.message?.content || '',
            toolCalls: choice?.message?.tool_calls || []
        };
    }
    
    /**
     * 简化的同步处理方法（等待完成后返回最终结果）
     */
    async chat(userQuery, options = {}) {
        let finalResponse = '';
        let allToolCalls = [];
        
        for await (const event of this.processQuery(userQuery, options)) {
            if (event.type === 'complete') {
                finalResponse = event.finalResponse;
            } else if (event.type === 'tool_call_end') {
                allToolCalls.push({
                    name: event.toolName,
                    result: event.result
                });
            }
        }
        
        return {
            response: finalResponse,
            toolCalls: allToolCalls
        };
    }
}

// ==================== 流式响应包装器 ====================

/**
 * 将多代理循环转换为 SSE 流
 */
export function createSSEStream(multiAgentService, userQuery, options = {}) {
    return new ReadableStream({
        async start(controller) {
            const encoder = new TextEncoder();
            
            try {
                for await (const event of multiAgentService.processQuery(userQuery, options)) {
                    const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
                    controller.enqueue(encoder.encode(data));
                }
                controller.close();
            } catch (error) {
                const errorData = `event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`;
                controller.enqueue(encoder.encode(errorData));
                controller.close();
            }
        }
    });
}

// ==================== Express 路由集成 ====================

/**
 * 设置多代理路由
 */
export function setupMultiAgentRoutes(app, multiAgentService) {
    // 创建会话
    app.post('/api/agent/sessions', (req, res) => {
        const session = multiAgentService.sessionStore.create(req.body.userId);
        res.json({ success: true, sessionId: session.id });
    });
    
    // 发送消息（流式）
    app.post('/api/agent/chat/stream', async (req, res) => {
        const { query, sessionId, model } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'query is required' });
        }
        
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        try {
            for await (const event of multiAgentService.processQuery(query, { sessionId, model })) {
                res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
            }
            res.end();
        } catch (error) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
            res.end();
        }
    });
    
    // 发送消息（非流式）
    app.post('/api/agent/chat', async (req, res) => {
        const { query, sessionId, model } = req.body;
        
        if (!query) {
            return res.status(400).json({ error: 'query is required' });
        }
        
        try {
            const result = await multiAgentService.chat(query, { sessionId, model });
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
    
    // 获取会话历史
    app.get('/api/agent/sessions/:sessionId/history', (req, res) => {
        const history = multiAgentService.sessionStore.getHistory(req.params.sessionId);
        res.json({ success: true, history });
    });
}

// ==================== 使用示例 ====================

/*
// 基本使用
import { MultiAgentService } from './multi-agent-service.js';

const agent = new MultiAgentService({
    maxIterations: 10,
    // 可选：自定义 AI 客户端
    aiClient: {
        async chat(messages, options) {
            // 调用你的 AI 服务
            return { content: '...', toolCalls: [] };
        }
    }
});

// 同步调用
const result = await agent.chat('帮我看看当前目录有什么文件');
console.log(result.response);

// 流式调用
for await (const event of agent.processQuery('分析这个项目的结构')) {
    console.log(event.type, event);
}

// Express 集成
import express from 'express';
const app = express();
setupMultiAgentRoutes(app, agent);
*/

export default MultiAgentService;
