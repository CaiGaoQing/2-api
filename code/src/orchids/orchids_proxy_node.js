#!/usr/bin/env node
/**
 * Orchids → Anthropic API 兼容代理服务器 (Node.js)
 * 让 Claude Code CLI 通过 Orchids 后端使用 AI 模型。
 *
 * 用法:
 *   1. npm install
 *   2. node orchids_proxy_node.js
 *   3. 配置 Claude Code:
 *      export ANTHROPIC_BASE_URL=http://localhost:8082
 *      export ANTHROPIC_API_KEY=dummy
 *      claude
 *
 * 依赖: npm install ws
 */

import { createServer } from 'http';
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync, statSync, globSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================
// 配置
// ============================================================

const PROXY_HOST = '0.0.0.0';
const PROXY_PORT = parseInt(process.env.ORCHIDS_PROXY_PORT || '8082', 10);

const CONFIG_FILE = join(__dirname, 'orchids_config.json');

const DEFAULT_CONFIG = {
  clerk_client_cookie: '',
  clerk_session_id: '',
  user_id: '',
  email: '',
  server_base: 'https://orchids-server.calmstone-6964e08a.westeurope.azurecontainerapps.io',
  clerk_base: 'https://clerk.orchids.app',
  ws_base: 'wss://orchids-server.calmstone-6964e08a.westeurope.azurecontainerapps.io',
  clerk_api_version: '2025-11-10',
  clerk_js_version: '5.117.0',
  orchids_api_version: '5',
  working_directory: '',
  template_id: 'nextjs',
  agent_mode: 'claude-sonnet-4-6',
  model_provider_overrides: {
    auto: 'orchids',
    'claude-sonnet-4-6': 'orchids',
    'claude-opus-4.6': 'orchids',
    'claude-haiku-4-5': 'orchids',
    'gemini-3.1-pro': 'orchids',
    'gemini-3-flash': 'orchids',
    'gpt-5.3-codex': 'chatgpt',
    'gpt-5.2-codex': 'orchids',
    'gpt-5.2': 'orchids',
    'grok-4.1-fast': 'orchids',
    'glm-5': 'orchids',
    'kimi-k2.5': 'orchids',
  },
};

// 模型映射: Anthropic model ID → Orchids agentMode
const MODEL_MAP = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-6',
  'claude-opus-4-20250515': 'claude-opus-4.6',
  'claude-opus-4-5-20251101': 'claude-opus-4.6',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4.6': 'claude-opus-4.6',
  'claude-haiku-4-5': 'claude-haiku-4-5',
};

function loadConfig() {
  const config = { ...DEFAULT_CONFIG };
  if (existsSync(CONFIG_FILE)) {
    try {
      const file = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      for (const [k, v] of Object.entries(file)) {
        if (v && k in config) config[k] = v;
      }
    } catch (e) {
      console.error(`[proxy] 配置文件读取失败: ${e.message}`);
    }
  }
  return config;
}

// ============================================================
// 工具函数
// ============================================================

function makeSSEEvent(eventType, data) {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

function hexId(len = 24) {
  return randomUUID().replace(/-/g, '').slice(0, len);
}

// ============================================================
// 简易 HTTP 客户端（不依赖 axios/node-fetch）
// ============================================================

function httpsRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false, // SSL_VERIFY=false
    };
    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        } else {
          try { resolve(JSON.parse(body)); }
          catch { resolve(body); }
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ============================================================
// Clerk 认证
// ============================================================

class ClerkAuth {
  constructor(config) {
    this.config = config;
    this._token = null;
    this._tokenExpiresAt = 0;
  }

  async getToken() {
    if (this._token && Date.now() / 1000 < this._tokenExpiresAt - 10) {
      return this._token;
    }
    return this._refreshToken();
  }

  async _refreshToken() {
    const sessionId = this.config.clerk_session_id;
    const url =
      `${this.config.clerk_base}/v1/client/sessions/${sessionId}/tokens` +
      `?debug=skip_cache` +
      `&__clerk_api_version=${this.config.clerk_api_version}` +
      `&_clerk_js_version=${this.config.clerk_js_version}`;

    const data = await httpsRequest(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: `__client=${this.config.clerk_client_cookie}`,
      },
      body: 'organization_id=',
    });
    this._token = data.jwt;
    this._tokenExpiresAt = Date.now() / 1000 + 50;
    return this._token;
  }
}

// ============================================================
// Orchids REST API
// ============================================================

class OrchidsAPI {
  constructor(config, auth) {
    this.config = config;
    this.auth = auth;
  }

  async _headers() {
    const token = await this.auth.getToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Origin: 'http://localhost:4928',
      Referer: 'http://localhost:4928/',
    };
  }

  async ensureUser() {
    const url = `${this.config.server_base}/auth/me`;
    return httpsRequest(url, { headers: await this._headers() });
  }

  async createProject(prompt) {
    const url = `${this.config.server_base}/projects/create`;
    const headers = await this._headers();
    return httpsRequest(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        userId: this.config.user_id,
        templateId: this.config.template_id,
      }),
    });
  }

  async getUserProjects() {
    const url = `${this.config.server_base}/projects/v2/${this.config.user_id}`;
    return httpsRequest(url, { headers: await this._headers() });
  }
}

// ============================================================
// 文件系统 Handler
// ============================================================

class FileSystemHandler {
  constructor(workingDirectory) {
    this.workingDir = workingDirectory;
  }

  handleFsOperation(msg) {
    const opId = msg.id;
    const operation = msg.operation;
    try {
      switch (operation) {
        case 'read': return this._handleRead(opId, msg.path);
        case 'write': return this._handleWrite(opId, msg.path, msg.content || '');
        case 'list': return this._handleList(opId, msg.path);
        case 'run_command': return this._handleRunCommand(opId, msg);
        case 'glob': return this._handleGlob(opId, msg.globParameters || {});
        default: return this._response(opId, true, null);
      }
    } catch (e) {
      return this._response(opId, false, e.message);
    }
  }

  _handleRead(opId, filePath) {
    try {
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const content = readFileSync(filePath, 'utf-8');
        return this._response(opId, true, content);
      }
      return this._response(opId, true, null);
    } catch {
      return this._response(opId, true, null);
    }
  }

  _handleWrite(opId, filePath, content) {
    try {
      const dir = dirname(filePath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, content, 'utf-8');
      return this._response(opId, true, null);
    } catch (e) {
      return this._response(opId, false, e.message);
    }
  }

  _handleList(opId, dirPath) {
    try {
      if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
        const entries = readdirSync(dirPath).sort();
        return this._response(opId, true, entries);
      }
      return this._response(opId, true, []);
    } catch {
      return this._response(opId, true, []);
    }
  }

  _handleRunCommand(opId, msg) {
    const command = msg.command || '';
    const isBackground = msg.is_background || false;
    try {
      if (isBackground) {
        spawn(command, { shell: true, cwd: this.workingDir, detached: true, stdio: 'ignore' }).unref();
        return this._response(opId, true, '');
      }
      const result = execSync(command, {
        cwd: this.workingDir,
        timeout: 120000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return this._response(opId, true, result);
    } catch (e) {
      if (e.stdout || e.stderr) {
        return this._response(opId, true, (e.stdout || '') + (e.stderr || ''));
      }
      return this._response(opId, false, e.message);
    }
  }

  _handleGlob(opId, params) {
    const pattern = params.pattern || '';
    const basePath = params.path || this.workingDir;
    try {
      // 匹配 Python glob.glob(os.path.join(base, pattern), recursive=True) 行为
      // Python 的 glob 不支持 {} 花括号展开，需转义花括号为字面量
      const escaped = pattern.replace(/\{/g, '\\{').replace(/\}/g, '\\}');
      const fullPattern = join(basePath, escaped);
      const matches = globSync(fullPattern);
      return this._response(opId, true, matches.join('\n'));
    } catch {
      return this._response(opId, true, '');
    }
  }

  _response(opId, success, data) {
    return { type: 'fs_operation_response', id: opId, success, data };
  }
}

// ============================================================
// OrchidsSession — WebSocket 会话管理（暂停/恢复）
// ============================================================

class OrchidsSession {
  constructor(ws, reqId, fsHandler, wd) {
    this.ws = ws;
    this.reqId = reqId;
    this.fsHandler = fsHandler;
    this.wd = wd;
    this._msgQueue = [];
    this._waitingConsumer = null; // resolve function waiting for next msg
    this._fsResumeResolve = null;
    this._fsResumeResult = null;
    this._waitingForResume = false;
    this.done = false;
    this._pendingWebSearches = {};
    this._pendingFsMsg = null;
    this._closed = false;
  }

  start() {
    this._readLoop();
  }

  async _readLoop() {
    // 顺序处理队列：确保一条消息处理完再处理下一条（匹配 Python 的 async for 行为）
    const pendingRaw = [];
    let processing = false;

    const processNext = async () => {
      if (processing || pendingRaw.length === 0) return;
      processing = true;
      while (pendingRaw.length > 0) {
        const raw = pendingRaw.shift();
        try {
          const msg = JSON.parse(raw.toString());
          await this._processMessage(msg);
        } catch (e) {
          console.log(`[ws#${this.reqId}] parse error: ${e.message}`);
        }
      }
      processing = false;
    };

    try {
      this.ws.on('message', (raw) => {
        pendingRaw.push(raw);
        if (!processing) processNext();
      });
      this.ws.on('close', () => {
        console.log(`[ws#${this.reqId}] WebSocket 连接已关闭`);
        this._enqueue(null);
      });
      this.ws.on('error', (e) => {
        console.log(`[ws#${this.reqId}] WebSocket 错误: ${e.message}`);
        this._enqueue(null);
      });
    } catch (e) {
      console.log(`[ws#${this.reqId}] reader 错误: ${e.message}`);
      this._enqueue(null);
    }
  }

  async _processMessage(msg) {
    const msgType = msg.type || '';

    // 已结束，忽略后续消息
    if (this.done) {
      if (msgType === 'fs_operation') {
        // complete 之后的 fs_operation，直接回复成功（不转发）
        const op = msg.operation || '';
        console.log(`[ws#${this.reqId}] ⚠ 忽略 complete 后的 fs_operation: ${op}`);
        if (op === 'write') {
          // 直接本地写入
          this.fsHandler.handleFsOperation(msg);
        }
        try {
          this.ws.send(JSON.stringify({ type: 'fs_operation_response', id: msg.id, success: true, data: null }));
        } catch { /* ws may be closed */ }
      }
      return;
    }

    // 跳过心跳和初始化消息
    if (msgType === 'heartbeat' || msgType === 'init' || msgType === 'request_ack') {
      return;
    }

    // 调试日志
    if (msgType !== 'output_text_delta') {
      const preview = JSON.stringify(msg).slice(0, 200);
      console.log(`[ws#${this.reqId}] ← ${msgType}: ${preview}`);
    }

    // 文件系统操作
    if (msgType === 'fs_operation') {
      const op = msg.operation || '';
      const fpath = msg.path || '';
      console.log(`[ws#${this.reqId}] fs_operation: ${op} → ${fpath}`);

      if (op === 'write' || op === 'run_command') {
        const proxyMsg = {
          type: '_proxy_tool_use',
          fs_op: op,
          fs_msg_id: msg.id,
          path: fpath,
        };
        if (op === 'write') {
          proxyMsg.cli_tool = 'Write';
          proxyMsg.cli_input = { file_path: fpath, content: msg.content || '' };
        } else {
          const cmd = msg.command || '';
          proxyMsg.cli_tool = 'Bash';
          proxyMsg.cli_input = { command: cmd, description: `Execute: ${cmd.slice(0, 80)}` };
        }

        this._pendingFsMsg = msg;
        this._enqueue(proxyMsg);

        // 阻塞：等待 Claude CLI 返回 tool_result
        this._waitingForResume = true;
        const resultData = await new Promise((resolve) => {
          this._fsResumeResolve = resolve;
        });
        this._waitingForResume = false;

        // 发送 fs_operation_response 给 Orchids
        this.ws.send(JSON.stringify({
          type: 'fs_operation_response',
          id: this._pendingFsMsg.id,
          success: true,
          data: resultData,
        }));
        this._pendingFsMsg = null;
        return;
      }

      // read / list / glob → 本地快速执行
      const response = this.fsHandler.handleFsOperation(msg);
      this.ws.send(JSON.stringify(response));
      return;
    }

    if (msgType === 'error_check') {
      this.ws.send(JSON.stringify({
        type: 'error_check_response',
        id: msg.id,
        errors: [],
      }));
      return;
    }

    // Web_Search 拦截
    if (msgType === 'model') {
      const event = msg.event || {};
      const evtType = event.type || '';
      if (evtType === 'tool-call') {
        const toolName = event.toolName || '';
        const callId = event.toolCallId || '';
        if (toolName === 'Web_Search' && callId) {
          let query = '';
          try { query = JSON.parse(event.input || '{}').query || ''; }
          catch { query = event.input || ''; }
          this._pendingWebSearches[callId] = query;
          console.log(`[ws#${this.reqId}] 🔍 Web_Search: ${query}`);
        }
      }
    }

    if (msgType === 'tool_call_output_item') {
      const rawItem = msg.rawItem || {};
      const callId = rawItem.callId || '';
      if (callId in this._pendingWebSearches) {
        const query = this._pendingWebSearches[callId];
        delete this._pendingWebSearches[callId];
        const output = rawItem.output || {};
        const resultText = typeof output === 'object'
          ? (output.text || output.value || '')
          : String(output);
        this._enqueue({
          type: '_proxy_web_search',
          query,
          call_id: callId,
          result_text: resultText,
        });
        return; // 不再作为普通 tool_call_output_item
      }
    }

    // 回合结束：先入队消息，再入队 null 终止信号
    if (msgType === 'complete' || msgType === 'cancelled') {
      this.done = true;
      this._enqueue(null);
      return;
    }

    // 放入队列
    this._enqueue(msg);
  }

  _enqueue(msg) {
    if (this._waitingConsumer) {
      const resolve = this._waitingConsumer;
      this._waitingConsumer = null;
      resolve(msg);
    } else {
      this._msgQueue.push(msg);
    }
  }

  nextMessage() {
    return new Promise((resolve) => {
      if (this._msgQueue.length > 0) {
        resolve(this._msgQueue.shift());
      } else {
        this._waitingConsumer = resolve;
      }
    });
  }

  resumeWithResult(resultData = null) {
    if (this._waitingForResume && this._fsResumeResolve) {
      this._fsResumeResolve(resultData);
      this._fsResumeResolve = null;
    }
  }

  close() {
    if (this._closed) return;
    this._closed = true;
    try { this.ws.close(); } catch { /* ignore */ }
    console.log(`[proxy] WebSocket #${this.reqId} 已关闭`);
  }
}

// ============================================================
// WebSocketSessionFactory
// ============================================================

class WebSocketSessionFactory {
  constructor(config, auth, projectId) {
    this.config = config;
    this.auth = auth;
    this.projectId = projectId;
    this._reqCounter = 0;
  }

  _createConnection() {
    return new Promise(async (resolve, reject) => {
      try {
        const token = await this.auth.getToken();
        const url =
          `${this.config.ws_base}/agent/ws/coding-agent` +
          `?token=${token}` +
          `&orchids_api_version=${this.config.orchids_api_version}`;

        const ws = new WebSocket(url, {
          origin: 'http://localhost:4928',
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
              'AppleWebKit/537.36 (KHTML, like Gecko) ' +
              'Orchids/1.0.7 Chrome/138.0.7204.251 ' +
              'Electron/37.10.3 Safari/537.36',
          },
          maxPayload: 10 * 1024 * 1024,
          rejectUnauthorized: false,
        });

        ws.once('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type !== 'connected') {
            ws.close();
            reject(new Error(`Expected 'connected', got: ${JSON.stringify(msg)}`));
            return;
          }
          ws.send(JSON.stringify({
            type: 'client_hello',
            data: {
              isLocal: true,
              projectId: this.projectId,
              localWorkingDirectory: this.config.working_directory || process.cwd(),
            },
          }));
          this._reqCounter++;
          console.log(`[proxy] WebSocket #${this._reqCounter} 已连接 (project=${this.projectId.slice(0, 8)}...)`);
          resolve(ws);
        });

        ws.once('error', (e) => reject(e));
      } catch (e) {
        reject(e);
      }
    });
  }

  async createSession(prompt, agentMode, systemPrompt = '', chatHistory = [], workingDir = '') {
    const ws = await this._createConnection();
    const reqId = this._reqCounter;
    const wd = workingDir || this.config.working_directory || process.cwd();
    const fsHandler = new FileSystemHandler(wd);
    console.log(`[proxy] 工作目录: ${wd}`);

    let fullPrompt = prompt;
    if (systemPrompt) {
      fullPrompt = `<system>${systemPrompt}</system>\n\n${prompt}`;
    }

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const envInfo =
      `<user_request>${fullPrompt}</user_request>\n\n` +
      `<important_instructions>\n` +
      `DO NOT use the AskUserQuestion tool. Instead, make your best judgment and execute directly.\n` +
      `DO NOT ask the user clarifying questions. Just pick the most reasonable approach and implement it.\n` +
      `</important_instructions>\n\n` +
      `<env>\n` +
      `Working directory: ${wd}\n` +
      `Platform: darwin\n` +
      `OS Version: Darwin 10.15\n` +
      `Today's date: ${dateStr}\n` +
      `</env>`;

    const requestId = randomUUID();
    ws.send(JSON.stringify({
      type: 'user_request',
      data: {
        projectId: this.projectId,
        prompt: envInfo,
        agentMode,
        mode: 'agent',
        chatHistory: chatHistory || [],
        chatSessionId: 0,
        email: this.config.email || '',
        isLocal: true,
        localWorkingDirectory: wd,
        isFixingErrors: false,
        forceCompaction: false,
        userId: this.config.user_id || '',
        templateId: this.config.template_id || 'nextjs',
        modelProviderOverrides: this.config.model_provider_overrides || {},
      },
      requestId,
    }));

    const session = new OrchidsSession(ws, reqId, fsHandler, wd);
    session.start();
    return session;
  }
}

// ============================================================
// Anthropic 消息格式转换
// ============================================================

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const block of content) {
      if (typeof block === 'object' && block !== null) {
        const btype = block.type || '';
        if (btype === 'text') parts.push(block.text);
        else if (btype === 'tool_use') {
          parts.push(`[调用工具 ${block.name || ''}: ${JSON.stringify(block.input || {}).slice(0, 200)}]`);
        } else if (btype === 'tool_result') {
          let rc = block.content || '';
          if (Array.isArray(rc)) rc = rc.filter(b => typeof b === 'object').map(b => b.text || '').join(' ');
          if (typeof rc === 'string' && rc.length > 500) rc = rc.slice(0, 500) + '...';
          parts.push(`[工具结果: ${rc}]`);
        }
      } else if (typeof block === 'string') {
        parts.push(block);
      }
    }
    return parts.join('\n');
  }
  return String(content);
}

function isSystemReminder(text) {
  return text.trim().startsWith('<system-reminder>');
}

function cleanUserText(text) {
  const parts = [];
  for (const segment of text.split('<system-reminder>')) {
    if (segment.includes('</system-reminder>')) {
      const after = segment.split('</system-reminder>')[1];
      if (after && after.trim()) parts.push(after.trim());
    } else {
      if (segment.trim()) parts.push(segment.trim());
    }
  }
  return parts.length > 0 ? parts.join('\n') : text.trim();
}

function anthropicToOrchidsMessages(messages) {
  if (!messages || messages.length === 0) return ['', []];

  const cleanTurns = [];
  for (const msg of messages) {
    const role = msg.role || 'user';
    const rawContent = extractText(msg.content || '');

    if (role === 'user') {
      const cleaned = cleanUserText(rawContent);
      if (cleaned && !isSystemReminder(cleaned)) {
        cleanTurns.push({ role: 'user', content: cleaned });
      }
    } else if (role === 'assistant') {
      let content = rawContent.trim();
      if (content && content !== '(no content)') {
        if (content.length > 800) content = content.slice(0, 800) + '...';
        cleanTurns.push({ role: 'assistant', content });
      }
    }
  }

  if (cleanTurns.length === 0) return ['', []];
  if (cleanTurns.length === 1 && cleanTurns[0].role === 'user') {
    return [cleanTurns[0].content, []];
  }

  let lastUser = '';
  const historyLines = [];
  for (const turn of cleanTurns) {
    if (turn.role === 'user') lastUser = turn.content;
    historyLines.push(`${turn.role === 'user' ? '用户' : 'AI'}: ${turn.content}`);
  }

  let prompt;
  if (cleanTurns.length > 2) {
    const context = historyLines.slice(0, -1).join('\n');
    prompt =
      `以下是之前的对话上下文：\n${context}\n\n` +
      `基于以上对话，用户的最新请求是：${lastUser}\n` +
      `请直接执行用户的请求，不要再次询问。`;
  } else {
    prompt = lastUser;
  }

  return [prompt, []];
}

// ============================================================
// ProxyHandler — HTTP 请求处理
// ============================================================

class ProxyHandler {
  constructor(config) {
    this.config = config;
    this.auth = new ClerkAuth(config);
    this.wsFactory = null;
    this._projectId = null;
    this._activeSession = null;
    this._sessionModel = '';
    this._msgCounter = 0;
  }

  async initialize() {
    const token = await this.auth.getToken();
    console.log('[proxy] Token 获取成功');

    const api = new OrchidsAPI(this.config, this.auth);
    try {
      try {
        const me = await api.ensureUser();
        const profile = (me && me.profile) || {};
        console.log(`[proxy] 用户已确认: ${profile.plan || '?'} plan, ${profile.credits || '?'} credits`);
      } catch (e) {
        console.log(`[proxy] ⚠ /auth/me 失败: ${e.message}`);
      }

      const resp = await api.getUserProjects();
      const projects = Array.isArray(resp) ? resp : (resp.projects || []);
      if (projects.length > 0) {
        this._projectId = projects[0].id;
        console.log(`[proxy] 使用项目: ${projects[0].name || ''} (${this._projectId.slice(0, 8)}...)`);
      } else {
        const project = await api.createProject('Claude Code proxy session');
        this._projectId = project.id;
        console.log(`[proxy] 创建项目: ${this._projectId.slice(0, 8)}...`);
      }
    } catch (e) {
      console.error(`[proxy] 初始化错误: ${e.message}`);
      throw e;
    }

    this.wsFactory = new WebSocketSessionFactory(this.config, this.auth, this._projectId);
  }

  async handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const url = parsedUrl.pathname;
    const method = req.method;

    if (method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'orchids-anthropic-proxy', project_id: this._projectId }));
      return;
    }

    if (method === 'GET' && url === '/v1/models') {
      const models = Object.keys(MODEL_MAP).map((id) => ({
        id, object: 'model', created: Math.floor(Date.now() / 1000), owned_by: 'orchids',
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: models }));
      return;
    }

    if (method === 'POST' && url === '/v1/messages') {
      return this._handleMessages(req, res);
    }

    res.writeHead(404);
    res.end('Not Found');
  }

  async _handleMessages(req, res) {
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: e.message } }));
      return;
    }

    // 保存请求日志
    this._msgCounter++;
    const logDir = join(__dirname, 'proxy_logs');
    mkdirSync(logDir, { recursive: true });
    const logFile = join(logDir, `req_${String(this._msgCounter).padStart(4, '0')}_${Math.floor(Date.now() / 1000)}.json`);
    writeFileSync(logFile, JSON.stringify(parsed, null, 2));
    console.log(`[proxy] 完整请求已保存: ${logFile.split('/').pop()}`);

    const model = parsed.model || 'claude-sonnet-4-20250514';
    const messages = parsed.messages || [];
    let system = parsed.system || '';
    const stream = parsed.stream || false;
    const maxTokens = parsed.max_tokens || 8192;

    // 检测 tool_result
    let hasToolResult = false;
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
        hasToolResult = lastMsg.content.some((b) => typeof b === 'object' && b.type === 'tool_result');
      }
    }

    if (hasToolResult) {
      if (this._activeSession) {
        const session = this._activeSession;
        this._activeSession = null;
        const sessionModel = this._sessionModel || model;

        // 提取最后一个 tool_result
        let resultData = null;
        const lastContent = messages[messages.length - 1].content || [];
        if (Array.isArray(lastContent)) {
          for (let i = lastContent.length - 1; i >= 0; i--) {
            const b = lastContent[i];
            if (typeof b === 'object' && b.type === 'tool_result') {
              let rc = b.content || '';
              if (Array.isArray(rc)) rc = rc.filter(x => typeof x === 'object').map(x => x.text || '').join('\n');
              resultData = rc || null;
              break;
            }
          }
        }

        console.log(`[proxy] tool_result 回传 → 恢复活跃会话 (result=${resultData ? '...' : 'None'})`);
        if (stream) {
          return this._handleStream(res, session, sessionModel, true, resultData);
        } else {
          session.resumeWithResult(resultData);
          let fullText = '';
          while (true) {
            const msg = await session.nextMessage();
            if (msg === null) break;
            if (msg.type === '_proxy_tool_use') { session.resumeWithResult(null); continue; }
            if (msg.type === 'output_text_delta') fullText += msg.delta || '';
          }
          session.close();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: `msg_${hexId()}`, type: 'message', role: 'assistant',
            content: [{ type: 'text', text: fullText || '操作完成。' }],
            model: sessionModel, stop_reason: 'end_turn', stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 5 },
          }));
          return;
        }
      }

      // 无活跃会话 → 返回确认
      const results = [];
      const lastContent = messages[messages.length - 1].content || [];
      if (Array.isArray(lastContent)) {
        for (const b of lastContent) {
          if (typeof b === 'object' && b.type === 'tool_result') {
            let rc = b.content || '';
            if (Array.isArray(rc)) rc = rc.filter(x => typeof x === 'object').map(x => x.text || '').join(' ');
            if (rc) results.push(rc);
          }
        }
      }
      const confirmText = results.length > 0 ? results.join('\n') : '操作完成。';
      console.log(`[proxy] tool_result 回传（无活跃会话）→ 返回确认: ${confirmText.slice(0, 80)}`);
      return sendSimpleSSE(res, model, confirmText, stream);
    }

    // 系统提示处理
    if (Array.isArray(system)) {
      system = system.filter(b => typeof b === 'object').map(b => b.text || '').join('\n');
    }

    const agentMode = MODEL_MAP[model] || 'claude-sonnet-4-6';
    const [prompt, chatHistory] = anthropicToOrchidsMessages(messages);

    if (!prompt) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'No user message found' } }));
      return;
    }

    // 标题分析请求
    const isTitleReq = (
      (typeof system === 'string' && (system.includes('isNewTopic') || system.includes('extract a 2-3 word title'))) ||
      (Array.isArray(parsed.tools) && parsed.tools.length === 0)
    );
    if (isTitleReq) {
      console.log('[proxy] 标题分析请求 → 本地处理');
      const titleText = JSON.stringify({ isNewTopic: true, title: prompt.slice(0, 30) });
      return sendSimpleSSE(res, model, titleText, stream);
    }

    // 从 system prompt 提取工作目录
    let workingDir = '';
    const wdMatch = typeof system === 'string' ? system.match(/Working directory:\s*(.+)/) : null;
    if (wdMatch) workingDir = wdMatch[1].trim();

    // 请求日志
    const now = new Date();
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[proxy] 请求 @ ${now.toTimeString().slice(0, 8)}`);
    console.log(`  model: ${model} → ${agentMode}`);
    console.log(`  stream: ${stream}`);
    console.log(`  working_dir: ${workingDir || '(未检测到)'}`);
    console.log(`  messages: ${messages.length} 条`);
    console.log(`  prompt→orchids: ${prompt.slice(0, 120)}${prompt.length > 120 ? '...' : ''}`);
    console.log('─'.repeat(60));

    if (!this.wsFactory) await this.initialize();

    if (stream) {
      const session = await this.wsFactory.createSession(prompt, agentMode, system, chatHistory, workingDir);
      return this._handleStream(res, session, model);
    } else {
      return this._handleSync(res, prompt, agentMode, system, chatHistory, model, maxTokens, workingDir);
    }
  }

  async _handleStream(res, session, model, resume = false, resumeResult = null) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    // 禁用 Nagle 算法 + 立即刷新 headers，确保 SSE 实时推送
    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();

    const msgId = `msg_${hexId()}`;
    let inputTokens = 0;
    let outputTokens = 0;
    let clientGone = false;
    let blockIndex = 0;
    let hasTextBlock = false;

    const safeWrite = (data) => {
      if (clientGone) return;
      try { res.write(data); }
      catch (e) { clientGone = true; console.log('[proxy] 客户端已断开'); }
    };

    // message_start
    safeWrite(makeSSEEvent('message_start', {
      type: 'message_start',
      message: {
        id: msgId, type: 'message', role: 'assistant', content: [],
        model, stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }));

    const ensureTextBlock = () => {
      if (!hasTextBlock) {
        safeWrite(makeSSEEvent('content_block_start', {
          type: 'content_block_start', index: blockIndex,
          content_block: { type: 'text', text: '' },
        }));
        hasTextBlock = true;
      }
    };

    const closeTextBlock = () => {
      if (hasTextBlock) {
        safeWrite(makeSSEEvent('content_block_stop', {
          type: 'content_block_stop', index: blockIndex,
        }));
        blockIndex++;
        hasTextBlock = false;
      }
    };

    const sendTextDelta = (text) => {
      if (!text) return;
      ensureTextBlock();
      safeWrite(makeSSEEvent('content_block_delta', {
        type: 'content_block_delta', index: blockIndex,
        delta: { type: 'text_delta', text },
      }));
    };

    // 恢复模式
    if (resume) {
      if (session._waitingForResume) {
        console.log('[proxy] _handleStream 恢复模式，传递 result 给 session (fs_operation)');
        session.resumeWithResult(resumeResult);
      } else {
        console.log('[proxy] _handleStream 恢复模式，继续流（信息型 tool_use）');
      }
    }

    // 辅助：发送 tool_use block
    const emitToolUse = (name, toolInput) => {
      const toolUseId = `toolu_${hexId()}`;
      safeWrite(makeSSEEvent('content_block_start', {
        type: 'content_block_start', index: blockIndex,
        content_block: { type: 'tool_use', id: toolUseId, name, input: {} },
      }));
      safeWrite(makeSSEEvent('content_block_delta', {
        type: 'content_block_delta', index: blockIndex,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(toolInput) },
      }));
      safeWrite(makeSSEEvent('content_block_stop', {
        type: 'content_block_stop', index: blockIndex,
      }));
      blockIndex++;
      console.log(`[proxy] → ${name} tool_use: ${JSON.stringify(toolInput).slice(0, 80)}`);
      return toolUseId;
    };

    // 暂停流的辅助函数
    const pauseForToolUse = (toolName, detail = '') => {
      this._activeSession = session;
      this._sessionModel = model;
      safeWrite(makeSSEEvent('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: outputTokens },
      }));
      safeWrite(makeSSEEvent('message_stop', { type: 'message_stop' }));
      res.end();
      console.log(`[proxy] ⏸ 暂停会话，等待 tool_result (${toolName}${detail ? ': ' + detail : ''})`);
    };

    try {
      while (true) {
        const msg = await session.nextMessage();
        if (msg === null) break;

        const msgType = msg.type || '';

        // ── 工具调用：立即发送 tool_use 并暂停 ──
        if (msgType === '_proxy_tool_use') {
          const cliTool = msg.cli_tool || '';
          const cliInput = msg.cli_input || {};
          const fsOp = msg.fs_op || '';
          const path = msg.path || '';

          closeTextBlock();

          // Write 操作：先 Read 再 Write
          if (fsOp === 'write' && existsSync(path)) {
            emitToolUse('Read', { file_path: path });
          }

          emitToolUse(cliTool, cliInput);
          pauseForToolUse(cliTool, path);
          return;
        }

        // ── WebSearch：文本指示（不暂停）──
        if (msgType === '_proxy_web_search') {
          const query = msg.query || '';
          sendTextDelta(`\n🔍 Web Search: ${query}\n`);
          console.log(`[proxy] 🔍 WebSearch: ${query.slice(0, 60)}`);
          continue;
        }

        // ── 文本输出 ──
        if (msgType === 'output_text_delta') {
          // 忽略，避免重复（使用 model.text-delta）
        } else if (msgType === 'model') {
          const event = msg.event || {};
          const evtType = event.type || '';
          if (evtType === 'text-delta') {
            sendTextDelta(event.delta || '');
          } else if (evtType === 'tool-call') {
            const toolName = event.toolName || '';
            const skipTools = ['Write', 'CreateFile', 'Web_Search', 'Bash', 'TodoWrite', 'LS', 'Read'];
            if (!skipTools.includes(toolName)) {
              sendTextDelta(`\n🔧 ${toolName}\n`);
            }
          }
        } else if (msgType === 'tool_call_output_item') {
          const rawItem = msg.rawItem || {};
          const toolName = rawItem.name || '';
          const skipOutput = ['Write', 'CreateFile', 'Bash', 'TodoWrite', 'LS', 'Read'];
          if (skipOutput.includes(toolName)) continue;
          const output = rawItem.output || {};
          let outputText = typeof output === 'object'
            ? (output.text || output.value || '')
            : String(output);
          if (outputText && outputText.length > 300) outputText = outputText.slice(0, 300) + '...';
          if (outputText) sendTextDelta(`${outputText}\n`);

        // ── Orchids 状态事件 ──
        } else if (msgType === 'coding_agent.web_search.started') {
          // 通过 _proxy_web_search 处理
        } else if (msgType === 'coding_agent.todo_write.completed') {
          const todosData = (msg.data || {}).todos || [];
          if (todosData.length > 0) {
            const cliTodos = todosData.map((t) => ({
              content: t.content || '',
              status: t.status || 'pending',
              activeForm: t.content || '',
            }));
            closeTextBlock();
            emitToolUse('TodoWrite', { todos: cliTodos });
            pauseForToolUse('TodoWrite');
            return;
          }
        } else if (msgType === 'coding_agent.reasoning.chunk') {
          // 静默
        } else if (msgType.startsWith('coding_agent.') && msgType.endsWith('.started')) {
          // 静默
        } else if (msgType.startsWith('coding_agent.') && msgType.endsWith('.completed')) {
          // 静默
        } else if (msgType === 'coding_agent.credits_exhausted') {
          const errorMsg = (msg.data || {}).message || '积分已用完';
          sendTextDelta(`\n⚠️ Orchids 错误: ${errorMsg}\n`);
        } else if (msgType === 'error') {
          const errorMsg = msg.message || msg.data || '未知错误';
          sendTextDelta(`\n❌ 错误: ${errorMsg}\n`);
        } else if (msgType === 'coding_agent.tokens_used') {
          const data = msg.data || {};
          inputTokens = data.input_tokens || 0;
          outputTokens = data.output_tokens || 0;
        } else if (msgType === 'response_done') {
          const usage = (msg.response || {}).usage || {};
          if (usage.inputTokens) inputTokens += usage.inputTokens;
          if (usage.outputTokens) outputTokens += usage.outputTokens;
        }
      }
    } catch (e) {
      console.log(`[proxy] 流式错误: ${e.message}`);
    }

    // ── 正常结束 ──
    if (blockIndex === 0 && !hasTextBlock) ensureTextBlock();
    closeTextBlock();

    safeWrite(makeSSEEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokens },
    }));
    safeWrite(makeSSEEvent('message_stop', { type: 'message_stop' }));
    res.end();

    this._activeSession = null;
    session.close();
  }

  async _handleSync(res, prompt, agentMode, system, chatHistory, model, maxTokens, workingDir) {
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const session = await this.wsFactory.createSession(prompt, agentMode, system, chatHistory, workingDir);
      while (true) {
        const msg = await session.nextMessage();
        if (msg === null) break;
        const msgType = msg.type || '';
        if (msgType === '_proxy_tool_use') { session.resumeWithResult(null); continue; }
        if (msgType === 'output_text_delta') fullText += msg.delta || '';
        else if (msgType === 'coding_agent.tokens_used') {
          const data = msg.data || {};
          inputTokens = data.input_tokens || 0;
          outputTokens = data.output_tokens || 0;
        }
      }
      session.close();
    } catch (e) {
      console.log(`[proxy] 同步错误: ${e.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'api_error', message: e.message } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: `msg_${hexId()}`, type: 'message', role: 'assistant',
      content: [{ type: 'text', text: fullText }],
      model, stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    }));
  }
}

// ============================================================
// 工具函数
// ============================================================

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function sendSimpleSSE(res, model, text, stream) {
  const msgId = `msg_${hexId()}`;
  if (stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (res.socket) res.socket.setNoDelay(true);
    res.flushHeaders();
    const events = [
      makeSSEEvent('message_start', { type: 'message_start', message: { id: msgId, type: 'message', role: 'assistant', content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } }),
      makeSSEEvent('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      makeSSEEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
      makeSSEEvent('content_block_stop', { type: 'content_block_stop', index: 0 }),
      makeSSEEvent('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }),
      makeSSEEvent('message_stop', { type: 'message_stop' }),
    ];
    for (const evt of events) res.write(evt);
    res.end();
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: msgId, type: 'message', role: 'assistant',
      content: [{ type: 'text', text }],
      model, stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 5 },
    }));
  }
}

// ============================================================
// 服务器启动
// ============================================================

async function startServer() {
  const config = loadConfig();

  const required = ['clerk_client_cookie', 'clerk_session_id', 'user_id'];
  const missing = required.filter((k) => !config[k]);
  if (missing.length > 0) {
    console.error(`❌ 缺少配置: ${missing.join(', ')}`);
    console.error(`   请先编辑 ${CONFIG_FILE}`);
    process.exit(1);
  }

  const handler = new ProxyHandler(config);
  await handler.initialize();

  const server = createServer((req, res) => {
    handler.handleRequest(req, res).catch((e) => {
      console.error(`[proxy] 请求处理错误: ${e.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'api_error', message: e.message } }));
      }
    });
  });

  server.listen(PROXY_PORT, PROXY_HOST, () => {
    console.log(`\n${'='.repeat(60)}`);
    console.log('  Orchids → Anthropic API 代理已启动 (Node.js)');
    console.log(`  地址: http://localhost:${PROXY_PORT}`);
    console.log('='.repeat(60));
    console.log('\n  配置 Claude Code:');
    console.log(`    export ANTHROPIC_BASE_URL=http://localhost:${PROXY_PORT}`);
    console.log('    export ANTHROPIC_API_KEY=orchids-proxy');
    console.log('    claude');
    console.log(`\n  或直接 curl 测试:`);
    console.log(`    curl http://localhost:${PROXY_PORT}/v1/messages \\`);
    console.log(`      -H 'Content-Type: application/json' \\`);
    console.log(`      -H 'x-api-key: dummy' \\`);
    console.log(`      -d '{"model":"claude-sonnet-4-20250514","max_tokens":1024,`);
    console.log(`           "messages":[{"role":"user","content":"说两个字：收到"}]}'`);
    console.log(`\n${'='.repeat(60)}`);
  });

  process.on('SIGINT', () => {
    console.log('\n[proxy] 关闭中...');
    server.close();
    process.exit(0);
  });
}

startServer().catch((e) => {
  console.error(`启动失败: ${e.message}`);
  process.exit(1);
});
