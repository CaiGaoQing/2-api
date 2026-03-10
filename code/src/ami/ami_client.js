/**
 * Ami API Node.js Client（组合版）
 * = ami_core.js + ami_monitor.js + ami_chat.js
 *
 * 依赖：npm install ws
 * 用法：
 *   const { AmiClient } = require('./ami_client');
 *   const client = new AmiClient(session);
 *
 *   // 对话
 *   for await (const e of client.chatStream('hi', chatId, pid)) { ... }
 *   const text = await client.chat('hi', chatId, pid);
 *   await client.chatPrint('hi', chatId, pid);
 *
 *   // 监控
 *   const status = await client.checkAccountStatus();
 *   client.watchUsage(60000, (s) => console.log(s.totalTokensToday));
 *
 * 单独使用子模块：
 *   const { AmiCore }    = require('./ami_core');
 *   const { AmiMonitor } = require('./ami_monitor');
 *   const { AmiChat }    = require('./ami_chat');
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const { AmiCore, AmiDaemonWS }  = require('./ami_core');
const { AmiMonitor }             = require('./ami_monitor');
const { AmiChat }                = require('./ami_chat');

// =====================================================================
// AmiClient — 组合 AmiCore + AmiMonitor + AmiChat
// =====================================================================

class AmiClient extends AmiCore {
  constructor(sessionCookie) {
    super(sessionCookie);
    this._monitor = new AmiMonitor(this);
    this._chat    = new AmiChat(this);
  }

  // ── 监控方法（委托给 AmiMonitor） ────────────────────────────────

  async getUsage()           { return this._monitor.getUsage(); }
  async getPricing()         { return this._monitor.getPricing(); }
  async checkAccountStatus() { return this._monitor.checkStatus(); }

  /**
   * 定期监控账户状态
   * @param {number}   intervalMs  轮询间隔（ms），默认 60000
   * @param {function} callback    (status) => void
   */
  watchUsage(intervalMs = 60000, callback = null) {
    return this._monitor.watch(intervalMs, callback);
  }

  stopWatchUsage() { return this._monitor.stopWatch(); }

  // ── 对话方法（委托给 AmiChat） ───────────────────────────────────

  /** 流式对话，AsyncGenerator */
  chatStream(message, chatId, projectId, opts = {}) {
    return this._chat.stream(message, chatId, projectId, opts);
  }

  /** 同步对话，返回完整文本 */
  async chat(message, chatId, projectId, opts = {}) {
    return this._chat.send(message, chatId, projectId, opts);
  }

  /** 流式打印对话 */
  async chatPrint(message, chatId, projectId, opts = {}) {
    return this._chat.print(message, chatId, projectId, opts);
  }
}

module.exports = { AmiClient, AmiDaemonWS };

// =====================================================================
// 内置测试套件
// =====================================================================

if (require.main === module) {
  (async () => {
    const SESSION = process.env.AMI_SESSION
      || (() => { try { return fs.readFileSync(path.join(__dirname, 'session.txt'), 'utf8').trim(); } catch { return ''; } })();

    if (!SESSION) { console.error('错误: 请设置 AMI_SESSION 或提供 session.txt'); process.exit(1); }

    const testDir = __dirname;
    const results = {};
    const client  = new AmiClient(SESSION);

    console.log('='.repeat(60));
    console.log('Ami Client 自动化测试 (Node.js)');
    console.log('='.repeat(60));

    // 测试 1
    console.log('\n[测试 1] 账户状态检查...');
    try {
      const s = await client.checkAccountStatus();
      console.log(`  用户: ${s.user}`);
      console.log(`  Token 剩余: ${s.tokenExpiresInHours}h`);
      console.log(`  付费订阅: ${s.hasSubscription ? '是' : '否 (免费额度)'}`);
      console.log(`  今日用量: ${s.totalTokensToday} tokens`);
      for (const w of s.warnings || []) console.log(`  ⚠ ${w}`);
      console.log('  ✓ 账户状态正常'); results['账户状态'] = '✓';
    } catch (e) { console.log(`  ✗ ${e.message}`); results['账户状态'] = '✗'; process.exit(1); }

    // 测试 2
    console.log('\n[测试 2] 项目管理 API...');
    let projectId, chatId;
    try {
      const projs = await client.getProjects();
      console.log(`  2a. 项目列表: ${projs.length} 个`);
      const c = await client.createProject('Node.js 自动测试', testDir);
      projectId = c.projectId; chatId = c.chatId;
      console.log(`  2b. 创建项目: ${projectId}\n      创建聊天: ${chatId}`);
      console.log(`  2c. 聊天列表: ${(await client.getChats(projectId)).length} 个`);
      console.log(`  2d. 聊天详情: title=${(await client.getChat(chatId, projectId)).title || 'N/A'}`);
      results['项目管理API'] = '✓'; console.log('  ✓ 项目管理 API 全部正常');
    } catch (e) { console.log(`  ✗ ${e.message}`); results['项目管理API'] = '✗'; }

    // 测试 3
    console.log('\n[测试 3] 简单对话 (无工具)...');
    if (!chatId) { results['简单对话'] = '跳过'; console.log('  ✗ 跳过'); }
    else {
      try {
        process.stdout.write("  发送: 'hi'\n  响应: ");
        const parts = [];
        for await (const e of client.chatStream('hi', chatId, projectId, { cwd: testDir }))
          if (e.type === 'text-delta') { process.stdout.write(e.delta || ''); parts.push(e.delta); }
        console.log();
        results['简单对话'] = parts.length ? '✓' : '✗ 无内容';
        console.log(`  ${results['简单对话'] === '✓' ? '✓ 对话成功' : '✗ 无响应内容'}`);
      } catch (e) { results['简单对话'] = `✗`; console.log(`\n  ✗ ${e.message}`); }
    }

    // 启动 Daemon
    if (chatId && results['简单对话'] === '✓') {
      console.log('\n[Daemon] 启动 CLI daemon...');
      try {
        const ok = await client.startDaemon(projectId, testDir);
        console.log(ok ? '  ✓ Daemon 已连接' : '  ⚠ Daemon 连接失败，工具将依赖服务端执行');
      } catch (e) { console.log(`  ⚠ ${e.message}`); }
    }

    // 测试 4
    console.log('\n[测试 4] 工具调用对话...');
    if (!chatId || !results['简单对话'] || results['简单对话'].startsWith('✗')) {
      results['工具调用'] = '跳过'; console.log('  ✗ 跳过');
    } else {
      try {
        console.log("  发送: '列出当前目录的 .js 和 .py 文件'");
        console.log('-'.repeat(40));
        for await (const e of client.chatStream('列出当前目录的 .js 和 .py 文件', chatId, projectId, { cwd: testDir })) {
          if (e.type === 'text-delta') process.stdout.write(e.delta || '');
          else if (e.type === 'tool-input-available') process.stdout.write(`\n  [工具: ${e.toolName}]`);
        }
        console.log('\n' + '-'.repeat(40));
        results['工具调用'] = '✓'; console.log('  ✓ 工具调用完成');
      } catch (e) { results['工具调用'] = '✗'; console.log(`\n  ✗ ${e.message}`); }
    }

    // 测试 5
    console.log('\n[测试 5] 同步对话接口...');
    if (!chatId || results['简单对话'] === '跳过') {
      results['同步接口'] = '跳过'; console.log('  ✗ 跳过');
    } else {
      try {
        const resp = await client.chat('1+1=?', chatId, projectId);
        console.log(`  响应: ${resp.slice(0, 200)}`);
        results['同步接口'] = resp.trim() ? '✓' : '✗ 空响应';
      } catch (e) { results['同步接口'] = '✗'; console.log(`  ✗ ${e.message}`); }
    }

    // 汇总
    console.log('\n' + '='.repeat(60));
    console.log('测试汇总');
    console.log('='.repeat(60));
    for (const [name, res] of Object.entries(results)) {
      const icon = res === '✓' ? '✓' : (res === '跳过' ? '⊘' : '✗');
      console.log(`  ${icon} ${name}: ${res}`);
    }
    const passed = Object.values(results).filter(v => v === '✓').length;
    console.log(`\n  通过: ${passed}/${Object.keys(results).length}`);
    console.log('='.repeat(60));

    client.close();
  })().catch(e => { console.error(e); process.exit(1); });
}
