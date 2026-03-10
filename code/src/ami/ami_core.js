/**
 * ami_core.js — 基础 HTTP 工具、AmiCore 客户端、AmiDaemonWS
 */
'use strict';

const https = require('https');
const http  = require('http');
const zlib  = require('zlib');
const path  = require('path');
const fs    = require('fs');
const { execSync } = require('child_process');

let WebSocket;
try { WebSocket = require('ws'); } catch (e) {}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE_URL = 'https://app.ami.dev';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Ami/0.0.15 Chrome/142.0.7444.235 Electron/39.2.7 Safari/537.36';

// ── 工具函数 ──────────────────────────────────────────────────────

function randomId(len = 21) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let r = '';
  for (let i = 0; i < len; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

function today() { return new Date().toISOString().slice(0, 10); }

function request(url, options = {}, bodyData = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: false,
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const enc = res.headers['content-encoding'] || '';
        const done = (buf) => resolve({ status: res.statusCode, headers: res.headers, body: buf.toString() });
        if      (enc === 'br')   zlib.brotliDecompress(raw, (e, b) => done(e ? raw : b));
        else if (enc === 'gzip') zlib.gunzip(raw, (e, b) => done(e ? raw : b));
        else done(raw);
      });
    });
    req.on('error', reject);
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

function streamRequest(url, options = {}, bodyData = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'POST',
      headers: options.headers || {},
      rejectUnauthorized: false,
      timeout: 120000,
    }, (res) => resolve({ status: res.statusCode, headers: res.headers, stream: res }));
    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Request timeout')));
    if (bodyData) req.write(bodyData);
    req.end();
  });
}

// ── AmiDaemonWS — CLI WebSocket daemon ───────────────────────────

class AmiDaemonWS {
  constructor(userId, bridgeToken, projects = {}) {
    this.userId = userId;
    this.bridgeToken = bridgeToken;
    this.projects = projects;
    this.ws = null;
    this.connected = false;
    this.authenticated = false;
  }

  addProject(projectId, localPath) { this.projects[projectId] = localPath; }

  start(timeout = 10000) {
    if (!WebSocket) throw new Error('请先安装 ws：npm install ws');
    return new Promise((resolve) => {
      const url = `wss://bridge.ami.dev/api/v1/user-streams?userId=${this.userId}`;
      this.ws = new WebSocket(url, { rejectUnauthorized: false });
      const timer = setTimeout(() => resolve(false), timeout);
      this.ws.on('open', () => { this.connected = true; });
      this.ws.on('message', (raw) => {
        let data; try { data = JSON.parse(raw); } catch { return; }
        const tag = data._tag || '';
        if (tag === 'auth_required') {
          this.ws.send(JSON.stringify({ _tag: 'auth', token: this.bridgeToken, type: 'cli' }));
        } else if (tag === 'auth_success') {
          this.authenticated = true;
          this.ws.send(JSON.stringify({ _tag: 'presence_request' }));
          clearTimeout(timer);
          resolve(true);
        } else if (tag === 'rpc_call') {
          this._handleRpc(data);
        }
      });
      this.ws.on('error', () => {});
      this.ws.on('close', () => { this.connected = false; this.authenticated = false; });
    });
  }

  _handleRpc(data) {
    const rid = data.requestId, method = data.method || '', input = data.input || {};
    let result;
    if (method === 'daemon:get_project') {
      const p = this.projects[input.projectId];
      result = p
        ? { exists: true, path: p, isGitRepo: fs.existsSync(path.join(p, '.git')) }
        : { exists: true, path: '/tmp', isGitRepo: false };
    } else if (method === 'daemon:cancel_all_bash') {
      result = { cancelledCount: 0 };
    } else if (method === 'daemon:tool_run' || method === 'daemon:execute_tool') {
      const toolName = input.toolName || '';
      let args = input.toolInput || input.args || {};
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
      result = { result: this._executeTool(toolName, args, input.cwd || '/tmp') };
    } else {
      result = { ok: true };
    }
    if (this.ws && this.connected)
      this.ws.send(JSON.stringify({ _tag: 'rpc_result', requestId: rid, data: result }));
  }

  _executeTool(toolName, args, cwd) {
    try {
      if (toolName.includes('Bash')) {
        const out = execSync(args.command || '', { cwd, timeout: 60000, encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
        return { type: 'success', result: { stdout: out.slice(-5000), stderr: '', interrupted: false, isImage: false } };
      }
      if (toolName.includes('Read')) {
        const lines = fs.readFileSync(args.file_path || '', 'utf8').split('\n');
        const start = Math.max(0, (args.offset || 1) - 1);
        const sel = lines.slice(start, start + (args.limit || 999999));
        return { type: 'success', result: { type: 'text', file: {
          filePath: args.file_path, content: sel.join('\n'),
          numLines: sel.length, startLine: start + 1, totalLines: lines.length
        }}};
      }
      if (toolName.includes('Write')) {
        fs.mkdirSync(path.dirname(args.file_path || '.'), { recursive: true });
        fs.writeFileSync(args.file_path || '', args.content || '', 'utf8');
        return { type: 'success', result: { success: true, message: `Wrote ${args.file_path}`, diff: '' } };
      }
      if (toolName.includes('Glob')) {
        const t0 = Date.now();
        const out = execSync(`find ${args.path || cwd} -name "${args.pattern || '*'}" -type f 2>/dev/null | head -1000`, { encoding: 'utf8', timeout: 30000 }).trim();
        const files = out ? out.split('\n') : [];
        return { type: 'success', result: { durationMs: Date.now() - t0, filenames: files, numFiles: files.length, truncated: files.length >= 1000 } };
      }
      if (toolName.includes('Grep')) {
        const out = execSync(`grep -rn --color=never ${JSON.stringify(args.pattern || '')} ${args.path || cwd} 2>/dev/null | head -200`, { encoding: 'utf8', timeout: 30000 });
        return { type: 'success', result: { stdout: out.slice(-5000), stderr: '', exitCode: 0 } };
      }
      return { type: 'error', error: { type: 'unknown', message: `Unsupported tool: ${toolName}` } };
    } catch (e) {
      return { type: 'error', error: { type: 'execution', message: e.message } };
    }
  }

  stop() { if (this.ws) { try { this.ws.close(); } catch {} } }
}

// ── AmiCore — 基础客户端（auth, session, projects, chats）─────────

class AmiCore {
  constructor(sessionCookie) {
    this.baseUrl = BASE_URL;
    this.sessionCookie = sessionCookie;
    this.headers = {
      'Host': 'app.ami.dev', 'Content-Type': 'application/json', 'Accept': '*/*',
      'Origin': BASE_URL, 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty', 'User-Agent': UA, 'Cookie': `wos-session=${sessionCookie}`,
    };
    this._userId = null;
    this._bridgeToken = null;
    this._cliToken = null;
    this.daemon = null;
  }

  async _get(p, params = {}) {
    const qs = Object.keys(params).length
      ? '?' + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
    const res = await request(`${this.baseUrl}${p}${qs}`, { headers: this.headers });
    if (res.status !== 200) throw new Error(`GET ${p} => ${res.status}: ${res.body.slice(0, 200)}`);
    return JSON.parse(res.body);
  }

  async _post(p, body) {
    const res = await request(`${this.baseUrl}${p}`, { method: 'POST', headers: this.headers }, JSON.stringify(body));
    if (res.status !== 200) throw new Error(`POST ${p} => ${res.status}: ${res.body.slice(0, 200)}`);
    return JSON.parse(res.body);
  }

  async getSession() {
    const d = (await this._get('/api/v1/trpc/user.session.get'))?.result?.data ?? {};
    this._userId = d?.user?.id;
    this._bridgeToken = d?.bridge_token;
    this._cliToken = d?.cli_token;
    return d;
  }

  async getProjects() {
    return (await this._get('/api/v1/trpc/projects.list', { input: JSON.stringify({ limit: 50 }) }))?.result?.data?.projects ?? [];
  }

  async getChats(projectId) {
    return (await this._get('/api/v1/trpc/chats.list', { input: JSON.stringify({ projectId }) }))?.result?.data?.chats ?? [];
  }

  async getChat(chatId, projectId) {
    return (await this._get('/api/v1/trpc/chats.get', { input: JSON.stringify({ chatId, projectId }) }))?.result?.data ?? {};
  }

  async createProject(title = 'New Project', cwd = '/tmp') {
    return (await this._post('/api/v1/trpc/projects.create', { cwd, title }))?.result?.data ?? {};
  }

  async createChat(projectId, title = 'New Chat') {
    return (await this._post('/api/v1/trpc/chats.create', { json: { projectId, title } }))?.result?.data?.json ?? {};
  }

  async startDaemon(projectId = null, localPath = null) {
    if (!this._userId || !this._bridgeToken) await this.getSession();
    this.daemon = new AmiDaemonWS(this._userId, this._bridgeToken);
    if (projectId && localPath) this.daemon.addProject(projectId, localPath);
    const ok = await this.daemon.start();
    if (ok) await new Promise(r => setTimeout(r, 1000));
    return ok;
  }

  close() { if (this.daemon) { this.daemon.stop(); this.daemon = null; } }
}

module.exports = { AmiCore, AmiDaemonWS, request, streamRequest, randomId, today, BASE_URL, UA };
