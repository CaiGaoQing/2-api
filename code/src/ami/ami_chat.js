/**
 * ami_chat.js — 对话模块（流式、同步、打印）
 *
 * 用法：
 *   const { AmiChat } = require('./ami_chat');
 *   const chat = new AmiChat(sessionCookie);
 *   const { projectId, chatId } = await chat.createSession('My Project');
 *   for await (const event of chat.stream('hi', chatId, projectId)) { ... }
 *   const text = await chat.send('hi', chatId, projectId);
 *   await chat.print('hi', chatId, projectId);
 */
'use strict';

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const zlib = require('zlib');

const { AmiCore, streamRequest, randomId, today, BASE_URL } = require('./ami_core');

class AmiChat {
  /**
   * @param {string|AmiCore} sessionOrCore
   */
  constructor(sessionOrCore) {
    this._core = typeof sessionOrCore === 'string'
      ? new AmiCore(sessionOrCore)
      : sessionOrCore;
  }

  /**
   * 快速创建项目 + 聊天会话
   * @param {string} title   项目名称
   * @param {string} cwd     工作目录
   * @returns {{ projectId, chatId }}
   */
  async createSession(title = 'New Chat', cwd = '/tmp') {
    return this._core.createProject(title, cwd);
  }

  /**
   * 发送消息，返回 AsyncGenerator，每次 yield 一个 SSE 事件对象
   *
   * 事件 type 列表：
   *   start, start-step, finish-step, finish
   *   text-start, text-delta, text-end
   *   reasoning-start, reasoning-delta, reasoning-end
   *   tool-input-start, tool-input-delta, tool-input-available
   *   tool-output-available, tool-output-error
   *   data-initial, data-context-window, data-heartbeat, data-otel, data-lifecycle
   *   error
   *
   * @param {string} message
   * @param {string} chatId
   * @param {string} projectId
   * @param {object} opts - { model, cwd, homeDir }
   */
  async *stream(message, chatId, projectId, opts = {}) {
    const model   = opts.model   || 'anthropic/claude-sonnet-4';
    const cwd     = opts.cwd     || '/tmp';
    const homeDir = opts.homeDir || os.homedir();
    const isGit   = fs.existsSync(path.join(cwd, '.git'));

    const payload = {
      messages: [{
        id: randomId(21), role: 'user',
        parts: [{ type: 'text', text: message }],
      }],
      agentUrl: BASE_URL,
      context: {
        environment: {
          cwd, rules: { agents: null, claude: null, gemini: null, cursor: null },
          homeDir, workingDirectory: cwd, isGitRepo: isGit, platform: 'darwin',
          osVersion: 'Darwin Kernel Version 24.6.0: Wed Oct 15 21:12:21 PDT 2025; root:xnu-11417.140.69.703.14~1/RELEASE_X86_64',
          today: today(), isCodeServerAvailable: true,
          isCodebaseSearchEnabled: false, isBrowserToolsEnabled: true,
        },
        systemContext: [
          { type: 'Diagnostics', diagnostics: {} },
          { type: 'OpenBrowserTabsChanged', tabs: [] },
        ],
        attachments: [],
      },
      cwd, id: chatId, model, projectId, mode: 'agent',
    };

    const bodyGzip = await new Promise((res, rej) =>
      zlib.gzip(Buffer.from(JSON.stringify(payload), 'utf8'), (e, b) => e ? rej(e) : res(b)));

    const headers = {
      ...this._core.headers,
      'Content-Encoding': 'gzip',
      'Content-Type':     'application/json',
      'Referer':          `${BASE_URL}/chat/${projectId}?chat=${chatId}`,
      'Content-Length':   String(bodyGzip.length),
    };

    let streamRes;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await streamRequest(
        `${this._core.baseUrl}/api/v1/agent/v2`,
        { method: 'POST', headers },
        bodyGzip,
      );
      if (res.status === 200) { streamRes = res; break; }
      if (res.status === 429) {
        const wait = Math.min(10000 * (attempt + 1), 30000);
        process.stderr.write(`\n  [限流] 等待 ${wait / 1000}s...\n`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (res.status === 401) throw new Error('认证失败: session 可能已过期');
      throw new Error(`API error: ${res.status}`);
    }
    if (!streamRes) throw new Error('请求失败: 重试后仍被限流');

    let buf = '';
    for await (const chunk of streamRes.stream) {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') return;
        let event; try { event = JSON.parse(raw); } catch { continue; }
        const type = event.type || '';
        if (type === 'error') throw new Error(`流内错误: ${event.errorText || 'unknown'}`);
        if (type === 'tool-input-available' || type === 'tool-output-available') event._serverTool = true;
        yield event;
      }
    }
  }

  /**
   * 发送消息，等待完整响应，返回文本字符串
   *
   * @param {string} message
   * @param {string} chatId
   * @param {string} projectId
   * @param {object} opts
   * @returns {Promise<string>}
   */
  async send(message, chatId, projectId, opts = {}) {
    const parts = [];
    for await (const e of this.stream(message, chatId, projectId, opts))
      if (e.type === 'text-delta') parts.push(e.delta || '');
    return parts.join('').trim();
  }

  /**
   * 发送消息并实时打印到控制台（含工具调用信息）
   *
   * @param {string} message
   * @param {string} chatId
   * @param {string} projectId
   * @param {object} opts
   */
  async print(message, chatId, projectId, opts = {}) {
    const [C, Y, G, B, R] = ['\x1b[36m', '\x1b[33m', '\x1b[90m', '\x1b[1m', '\x1b[0m'];
    console.log(`\n${B}>>> ${message}${R}\n` + '='.repeat(60));

    for await (const e of this.stream(message, chatId, projectId, opts)) {
      const t = e.type || '';
      if      (t === 'text-delta')     process.stdout.write(e.delta || '');
      else if (t === 'reasoning-delta') process.stdout.write(`${G}${e.delta || ''}${R}`);
      else if (t === 'start')          console.log(`${C}[Model: ${e.messageMetadata?.model || ''}]${R}\n`);
      else if (t === 'tool-input-available') {
        const i = e.input || {};
        process.stdout.write(`\n${Y}[Tool: ${e.toolName}] ${i.description || i.command || JSON.stringify(i).slice(0, 80)}${R}\n`);
      } else if (t === 'tool-output-available') {
        const stdout = e.output?.result?.stdout || '';
        if (stdout) console.log(`${G}${stdout.trim().split('\n').slice(0, 5).join('\n')}${R}`);
      } else if (t === 'finish') {
        console.log(`\n\n${C}[Finished: ${e.finishReason || 'stop'}]${R}`);
      }
    }

    console.log('\n' + '='.repeat(60));
  }
}

module.exports = { AmiChat };
