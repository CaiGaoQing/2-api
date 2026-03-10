/**
 * Outlook 邮箱管理路由
 */

import { fetchMailList, fetchMailContent, deleteMail, deleteAllMails } from './outlook-mail.js';

export function setupOutlookRoutes(app, authMiddleware, outlookAccountStore) {

  // 获取所有账号
  app.get('/api/outlook/accounts', authMiddleware, async (req, res) => {
    try {
      const accounts = await outlookAccountStore.getAll();
      res.json({ success: true, data: accounts });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 获取统计
  app.get('/api/outlook/stats', authMiddleware, async (req, res) => {
    try {
      const stats = await outlookAccountStore.getStatistics();
      res.json({ success: true, data: stats });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 创建单个账号
  app.post('/api/outlook/accounts', authMiddleware, async (req, res) => {
    try {
      const { email, password, clientId, refreshToken, note } = req.body;
      if (!email) {
        return res.status(400).json({ success: false, error: 'email is required' });
      }
      const id = await outlookAccountStore.create({ email, password, clientId, refreshToken, note });
      const account = await outlookAccountStore.getById(id);
      res.json({ success: true, data: account });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 批量导入（粘贴格式：邮箱----密码----UUID----RefreshToken）
  app.post('/api/outlook/accounts/batch-import', authMiddleware, async (req, res) => {
    try {
      const { lines } = req.body;
      if (!Array.isArray(lines) || lines.length === 0) {
        return res.status(400).json({ success: false, error: 'lines must be a non-empty array' });
      }

      const accounts = [];
      for (const line of lines) {
        const parts = line.split('----');
        if (parts.length >= 1 && parts[0].trim()) {
          accounts.push({
            email: parts[0].trim(),
            password: parts[1]?.trim() || null,
            clientId: parts[2]?.trim() || null,
            refreshToken: parts[3]?.trim() || null,
          });
        }
      }

      if (accounts.length === 0) {
        return res.status(400).json({ success: false, error: 'No valid accounts found' });
      }

      const results = await outlookAccountStore.batchCreate(accounts);
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;

      res.json({
        success: true,
        message: `导入完成：${successCount} 成功，${failCount} 失败`,
        summary: { total: results.length, success: successCount, failed: failCount },
        results,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 更新账号
  app.put('/api/outlook/accounts/:id', authMiddleware, async (req, res) => {
    try {
      const account = await outlookAccountStore.getById(req.params.id);
      if (!account) {
        return res.status(404).json({ success: false, error: 'Account not found' });
      }
      await outlookAccountStore.update(req.params.id, req.body);
      const updated = await outlookAccountStore.getById(req.params.id);
      res.json({ success: true, data: updated });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 删除账号
  app.delete('/api/outlook/accounts/:id', authMiddleware, async (req, res) => {
    try {
      await outlookAccountStore.delete(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 批量删除
  app.post('/api/outlook/accounts/batch-delete', authMiddleware, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ success: false, error: 'ids must be a non-empty array' });
      }
      for (const id of ids) {
        await outlookAccountStore.delete(id);
      }
      res.json({ success: true, message: `已删除 ${ids.length} 个账号` });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============ 邮件操作 API ============

  // 获取邮件列表
  app.get('/api/outlook/accounts/:id/mails', authMiddleware, async (req, res) => {
    try {
      const account = await outlookAccountStore.getById(req.params.id);
      if (!account) {
        return res.status(404).json({ success: false, error: 'Account not found' });
      }
      if (!account.refreshToken) {
        return res.status(400).json({ success: false, error: '该账号未配置 Refresh Token，无法读取邮件' });
      }
      const folder = req.query.folder || 'INBOX';
      const limit = parseInt(req.query.limit) || 50;
      const result = await fetchMailList(account.email, account.refreshToken, account.clientId, folder, limit);
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 查看邮件内容
  app.get('/api/outlook/accounts/:id/mails/:uid', authMiddleware, async (req, res) => {
    try {
      const account = await outlookAccountStore.getById(req.params.id);
      if (!account) {
        return res.status(404).json({ success: false, error: 'Account not found' });
      }
      if (!account.refreshToken) {
        return res.status(400).json({ success: false, error: '该账号未配置 Refresh Token' });
      }
      const folder = req.query.folder || 'INBOX';
      const uid = parseInt(req.params.uid);
      const result = await fetchMailContent(account.email, account.refreshToken, account.clientId, uid, folder);
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 删除单封邮件
  app.delete('/api/outlook/accounts/:id/mails/:uid', authMiddleware, async (req, res) => {
    try {
      const account = await outlookAccountStore.getById(req.params.id);
      if (!account) {
        return res.status(404).json({ success: false, error: 'Account not found' });
      }
      if (!account.refreshToken) {
        return res.status(400).json({ success: false, error: '该账号未配置 Refresh Token' });
      }
      const folder = req.query.folder || 'INBOX';
      const uid = parseInt(req.params.uid);
      await deleteMail(account.email, account.refreshToken, account.clientId, uid, folder);
      res.json({ success: true, message: '邮件已删除' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 删除全部邮件
  app.delete('/api/outlook/accounts/:id/mails', authMiddleware, async (req, res) => {
    try {
      const account = await outlookAccountStore.getById(req.params.id);
      if (!account) {
        return res.status(404).json({ success: false, error: 'Account not found' });
      }
      if (!account.refreshToken) {
        return res.status(400).json({ success: false, error: '该账号未配置 Refresh Token' });
      }
      const folder = req.query.folder || 'INBOX';
      const result = await deleteAllMails(account.email, account.refreshToken, account.clientId, folder);
      res.json({ success: true, message: `已删除 ${result.deleted} 封邮件` });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
}
