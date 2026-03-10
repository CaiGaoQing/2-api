/**
 * ami_monitor.js — 账户状态、额度监控
 *
 * 用法：
 *   const { AmiMonitor } = require('./ami_monitor');
 *   const monitor = new AmiMonitor(sessionCookie);
 *   const status = await monitor.checkStatus();
 *   monitor.watch(30000, (status) => { if (!status.hasQuota) alert(); });
 */
'use strict';

const { AmiCore } = require('./ami_core');

class AmiMonitor {
  /**
   * @param {string|AmiCore} sessionOrCore  session cookie 字符串，或已有的 AmiCore 实例
   */
  constructor(sessionOrCore) {
    this._core = typeof sessionOrCore === 'string'
      ? new AmiCore(sessionOrCore)
      : sessionOrCore;
    this._watchTimer = null;
  }

  // ── 单次检查 ──────────────────────────────────────────────────

  /** 获取原始用量数据 */
  async getUsage() {
    try {
      return (await this._core._get('/api/v1/trpc/pricing.usage'))?.result?.data ?? {};
    } catch { return {}; }
  }

  /** 获取订阅/客户信息 */
  async getPricing() {
    try {
      return (await this._core._get('/api/v1/trpc/pricing.customer'))?.result?.data ?? {};
    } catch { return {}; }
  }

  /**
   * 检查账户完整状态
   * @returns {{ ok, user, userId, tokenExpiresInHours, hasSubscription, totalTokensToday, hasQuota, warnings, errors }}
   */
  async checkStatus() {
    const status = { ok: true, errors: [], warnings: [], hasQuota: true };

    // 1. Session 有效性
    try {
      const session = await this._core.getSession();
      const user = session?.user ?? {};
      status.user   = user.name || user.email;
      status.userId = user.id;
    } catch (e) {
      status.ok = false;
      status.hasQuota = false;
      status.errors.push(`Session 无效: ${e.message}`);
      return status;
    }

    // 2. CLI token 过期检查
    if (this._core._cliToken) {
      try {
        const pad = this._core._cliToken.split('.')[1];
        const decoded = JSON.parse(Buffer.from(pad, 'base64url').toString());
        const h = (decoded.exp - Date.now() / 1000) / 3600;
        status.tokenExpiresInHours = Math.round(h * 10) / 10;
        if (h <= 0) {
          status.ok = false;
          status.hasQuota = false;
          status.errors.push('cli_token 已过期');
        } else if (h < 1) {
          status.warnings.push(`cli_token 即将过期 (${h.toFixed(1)}h)`);
        }
      } catch { status.warnings.push('无法解析 cli_token'); }
    }

    // 3. 订阅状态
    const pricing = await this.getPricing();
    const subs = pricing?.subscriptions?.data ?? [];
    status.hasSubscription = subs.length > 0;
    if (!subs.length) status.warnings.push('无付费订阅，使用免费额度');

    // 4. 今日用量
    const usage = await this.getUsage();
    const rows  = usage?.rows ?? [];
    status.totalTokensToday = rows.reduce((s, r) => s + (r.value || 0), 0);
    status.usageRows = rows;

    return status;
  }

  /**
   * 打印状态摘要到控制台
   */
  async printStatus() {
    const s = await this.checkStatus();
    console.log('='.repeat(50));
    console.log('  账户状态');
    console.log('='.repeat(50));
    console.log(`  用户:     ${s.user || 'N/A'}`);
    console.log(`  Token:    ${s.tokenExpiresInHours ?? 'N/A'}h 剩余`);
    console.log(`  订阅:     ${s.hasSubscription ? '✓ 付费' : '免费额度'}`);
    console.log(`  今日用量: ${s.totalTokensToday.toLocaleString()} tokens`);
    for (const w of s.warnings) console.log(`  ⚠ ${w}`);
    for (const e of s.errors)   console.log(`  ✗ ${e}`);
    console.log(`  状态: ${s.ok ? '✓ 正常' : '✗ 异常'}`);
    console.log('='.repeat(50));
    return s;
  }

  /**
   * 定期监控，自动调用 callback
   * @param {number}   intervalMs  轮询间隔（毫秒），默认 60000（1 分钟）
   * @param {function} callback    (status) => void
   */
  watch(intervalMs = 60000, callback = null) {
    this.stopWatch();
    const poll = async () => {
      try {
        const s = await this.checkStatus();
        if (callback) callback(s);
        else {
          const ts = new Date().toISOString().slice(11, 19);
          const flag = s.ok ? '✓' : '✗';
          console.log(`[${ts}] ${flag} ${s.user} | 用量: ${s.totalTokensToday.toLocaleString()} tokens | ${s.hasSubscription ? '付费' : '免费'}`);
        }
      } catch (e) {
        console.error(`[监控错误] ${e.message}`);
      }
    };

    poll();
    this._watchTimer = setInterval(poll, intervalMs);
    return this;
  }

  /** 停止监控 */
  stopWatch() {
    if (this._watchTimer) { clearInterval(this._watchTimer); this._watchTimer = null; }
    return this;
  }

  /**
   * 额度告警：当 totalTokensToday 超过 threshold 时触发 callback
   * @param {number}   threshold  token 数量阈值
   * @param {function} callback   (status) => void
   * @param {number}   intervalMs 检查间隔
   */
  alertOnHighUsage(threshold = 500000, callback = null, intervalMs = 300000) {
    return this.watch(intervalMs, (status) => {
      if (status.totalTokensToday >= threshold) {
        const msg = `⚠ 用量告警: 今日已使用 ${status.totalTokensToday.toLocaleString()} tokens (阈值: ${threshold.toLocaleString()})`;
        console.warn(msg);
        if (callback) callback(status, msg);
      }
    });
  }
}

module.exports = { AmiMonitor };
