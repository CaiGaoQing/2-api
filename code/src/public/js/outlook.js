/**
 * Outlook 邮箱管理页面逻辑
 */

let allAccounts = [];
let currentFilter = 'all';
let searchQuery = '';
let editingId = null;
let currentMailAccountId = null;
let currentMailFolder = 'INBOX';

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
    if (!await checkAuth()) return;

    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = getSidebarHTML();
        initSidebar('outlook');
        updateSidebarStats();
    }

    await loadAccounts();
    bindEvents();
});

function bindEvents() {
    // 搜索
    document.getElementById('search-input').addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderTable();
    });

    // 状态筛选
    document.getElementById('status-filter').addEventListener('change', (e) => {
        currentFilter = e.target.value;
        renderTable();
    });

    // 添加账号
    document.getElementById('add-btn').addEventListener('click', () => openAddModal());
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-submit').addEventListener('click', submitAccount);

    // 批量导入
    document.getElementById('batch-import-btn').addEventListener('click', () => openBatchModal());
    document.getElementById('batch-modal-close').addEventListener('click', closeBatchModal);
    document.getElementById('batch-modal-cancel').addEventListener('click', closeBatchModal);
    document.getElementById('batch-modal-submit').addEventListener('click', submitBatchImport);

    // 点击遮罩关闭
    document.getElementById('add-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
    document.getElementById('batch-import-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeBatchModal();
    });

    // 邮件模态框
    document.getElementById('mail-modal-close').addEventListener('click', closeMailModal);
    document.getElementById('mail-back-btn').addEventListener('click', showMailListView);

    // Tab 切换
    document.querySelectorAll('.mail-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const folder = tab.dataset.folder;
            switchMailTab(folder);
        });
    });

    // 每个 Tab 的刷新和删除全部按钮
    ['INBOX', 'Junk'].forEach(folder => {
        document.getElementById(`mail-refresh-${folder}`).addEventListener('click', () => loadMailList(currentMailAccountId, folder));
        document.getElementById(`mail-delete-all-${folder}`).addEventListener('click', () => deleteAllMailsAction(folder));
    });
}

// ============ 数据加载 ============
async function loadAccounts() {
    try {
        const res = await fetch('/api/outlook/accounts', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();
        if (result.success) {
            allAccounts = result.data || [];
        } else {
            allAccounts = [];
            showToast(result.error || '加载失败', 'error');
        }
    } catch (e) {
        allAccounts = [];
        showToast('网络错误: ' + e.message, 'error');
    }
    updateStats();
    renderTable();
}

// ============ 统计 ============
function updateStats() {
    const total = allAccounts.length;
    const active = allAccounts.filter(a => a.status === 'active').length;
    const disabled = allAccounts.filter(a => a.status === 'disabled').length;
    const expired = allAccounts.filter(a => a.status === 'expired').length;

    document.getElementById('outlook-stat-total').textContent = total;
    document.getElementById('outlook-stat-active').textContent = active;
    document.getElementById('outlook-stat-disabled').textContent = disabled;
    document.getElementById('outlook-stat-expired').textContent = expired;
}

// ============ 表格渲染 ============
function renderTable() {
    let filtered = [...allAccounts];

    if (currentFilter !== 'all') {
        filtered = filtered.filter(a => a.status === currentFilter);
    }

    if (searchQuery) {
        filtered = filtered.filter(a =>
            (a.email || '').toLowerCase().includes(searchQuery) ||
            (a.clientId || '').toLowerCase().includes(searchQuery) ||
            (a.note || '').toLowerCase().includes(searchQuery)
        );
    }

    document.getElementById('displayed-count').textContent = filtered.length;

    const tbody = document.getElementById('account-tbody');
    const empty = document.getElementById('empty-state');
    const table = document.getElementById('account-table');

    if (filtered.length === 0) {
        table.style.display = 'none';
        empty.style.display = 'block';
        return;
    }
    table.style.display = 'table';
    empty.style.display = 'none';

    tbody.innerHTML = filtered.map(a => {
        const statusClass = a.status;
        const statusText = a.status === 'active' ? '活跃' : a.status === 'disabled' ? '停用' : '过期';
        const createdAt = a.createdAt ? formatDateTime(a.createdAt) : '-';
        const pwdDisplay = a.password ? '••••••' : '-';
        const clientIdDisplay = a.clientId ? a.clientId.substring(0, 8) + '...' : '-';
        const tokenDisplay = a.refreshToken ? '...' + a.refreshToken.slice(-8) : '-';

        return `<tr>
            <td>${a.id}</td>
            <td><strong>${escapeHtml(a.email)}</strong></td>
            <td><span class="cell-mono" title="点击复制" onclick="copyField(${a.id}, 'password')">${pwdDisplay}</span></td>
            <td><span class="cell-mono" title="点击复制" onclick="copyField(${a.id}, 'clientId')">${escapeHtml(clientIdDisplay)}</span></td>
            <td><span class="cell-mono" title="点击复制" onclick="copyField(${a.id}, 'refreshToken')">${escapeHtml(tokenDisplay)}</span></td>
            <td><span class="status-badge ${statusClass}"><span class="status-dot"></span>${statusText}</span></td>
            <td>${escapeHtml(a.note || '-')}</td>
            <td>${createdAt}</td>
            <td>
                <div class="action-btns">
                    <button class="action-btn" onclick="openMailModal(${a.id})" title="查看邮件" ${!a.refreshToken ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}>邮件</button>
                    <button class="action-btn" onclick="editAccount(${a.id})" title="编辑">编辑</button>
                    <button class="action-btn" onclick="toggleAccount(${a.id}, '${a.status}')" title="${a.status === 'active' ? '停用' : '启用'}">${a.status === 'active' ? '停用' : '启用'}</button>
                    <button class="action-btn" onclick="copyAllFields(${a.id})" title="复制整行">复制</button>
                    <button class="action-btn danger" onclick="deleteAccount(${a.id})" title="删除">删除</button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

// ============ 模态框 ============
function openAddModal() {
    editingId = null;
    document.getElementById('modal-title-text').textContent = '添加 Outlook 账号';
    document.getElementById('edit-id').value = '';
    document.getElementById('input-email').value = '';
    document.getElementById('input-password').value = '';
    document.getElementById('input-client-id').value = '';
    document.getElementById('input-refresh-token').value = '';
    document.getElementById('input-note').value = '';
    document.getElementById('add-modal').classList.add('active');
}

function closeModal() {
    document.getElementById('add-modal').classList.remove('active');
    editingId = null;
}

function openBatchModal() {
    document.getElementById('batch-input').value = '';
    document.getElementById('batch-import-modal').classList.add('active');
}

function closeBatchModal() {
    document.getElementById('batch-import-modal').classList.remove('active');
}

// ============ 提交操作 ============
async function submitAccount() {
    const id = document.getElementById('edit-id').value;
    const email = document.getElementById('input-email').value.trim();
    const password = document.getElementById('input-password').value.trim();
    const clientId = document.getElementById('input-client-id').value.trim();
    const refreshToken = document.getElementById('input-refresh-token').value.trim();
    const note = document.getElementById('input-note').value.trim();

    if (!email) return showToast('请输入邮箱', 'error');

    try {
        const body = {
            email,
            password: password || undefined,
            clientId: clientId || undefined,
            refreshToken: refreshToken || undefined,
            note: note || undefined,
        };
        let url, method;

        if (id) {
            url = `/api/outlook/accounts/${id}`;
            method = 'PUT';
        } else {
            url = '/api/outlook/accounts';
            method = 'POST';
        }

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify(body),
        });
        const result = await res.json();

        if (result.success) {
            showToast(id ? '更新成功' : '添加成功', 'success');
            closeModal();
            await loadAccounts();
        } else {
            showToast(result.error || '操作失败', 'error');
        }
    } catch (e) {
        showToast('网络错误: ' + e.message, 'error');
    }
}

async function submitBatchImport() {
    const raw = document.getElementById('batch-input').value.trim();
    if (!raw) return showToast('请输入账号列表', 'error');

    const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return showToast('未检测到有效数据', 'error');

    const btn = document.getElementById('batch-modal-submit');
    btn.disabled = true;
    btn.textContent = '导入中...';

    try {
        const res = await fetch('/api/outlook/accounts/batch-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ lines }),
        });
        const result = await res.json();

        if (result.success) {
            showToast(result.message || '导入完成', 'success');
            closeBatchModal();
            await loadAccounts();
        } else {
            showToast(result.error || '导入失败', 'error');
        }
    } catch (e) {
        showToast('网络错误: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>导入`;
    }
}

// ============ 行操作 ============
function editAccount(id) {
    const a = allAccounts.find(x => x.id === id);
    if (!a) return;
    editingId = id;
    document.getElementById('modal-title-text').textContent = '编辑 Outlook 账号';
    document.getElementById('edit-id').value = id;
    document.getElementById('input-email').value = a.email || '';
    document.getElementById('input-password').value = a.password || '';
    document.getElementById('input-client-id').value = a.clientId || '';
    document.getElementById('input-refresh-token').value = a.refreshToken || '';
    document.getElementById('input-note').value = a.note || '';
    document.getElementById('add-modal').classList.add('active');
}

async function toggleAccount(id, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
        const res = await fetch(`/api/outlook/accounts/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ status: newStatus }),
        });
        const result = await res.json();
        if (result.success) {
            showToast(newStatus === 'active' ? '已启用' : '已停用', 'success');
            await loadAccounts();
        } else {
            showToast(result.error || '操作失败', 'error');
        }
    } catch (e) {
        showToast('网络错误: ' + e.message, 'error');
    }
}

async function deleteAccount(id) {
    if (!confirm('确定要删除此邮箱账号吗？')) return;
    try {
        const res = await fetch(`/api/outlook/accounts/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        const result = await res.json();
        if (result.success) {
            showToast('已删除', 'success');
            await loadAccounts();
        } else {
            showToast(result.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('网络错误: ' + e.message, 'error');
    }
}

function copyField(id, field) {
    const a = allAccounts.find(x => x.id === id);
    if (!a || !a[field]) return showToast('无内容可复制', 'error');
    copyToClipboard(a[field]);
}

function copyAllFields(id) {
    const a = allAccounts.find(x => x.id === id);
    if (!a) return;
    const parts = [a.email, a.password, a.clientId, a.refreshToken].filter(Boolean);
    copyToClipboard(parts.join('----'));
}

// ============ 工具函数 ============
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(dateStr) {
    if (!dateStr) return '-';
    return formatDateTime(dateStr);
}

// ============ 邮件操作 ============

function openMailModal(accountId) {
    const a = allAccounts.find(x => x.id === accountId);
    if (!a || !a.refreshToken) return showToast('该账号未配置 Refresh Token', 'error');

    currentMailAccountId = accountId;
    currentMailFolder = 'INBOX';
    document.getElementById('mail-modal-title').textContent = `邮件 - ${a.email}`;
    document.getElementById('mail-modal').classList.add('active');

    // 重置 Tab 到 INBOX
    switchMailTab('INBOX');

    // 同时加载两个 Tab 的数据
    loadMailList(accountId, 'INBOX');
    loadMailList(accountId, 'Junk');
}

function closeMailModal() {
    document.getElementById('mail-modal').classList.remove('active');
    currentMailAccountId = null;
}

function switchMailTab(folder) {
    currentMailFolder = folder;

    // 切换 Tab 激活状态
    document.querySelectorAll('.mail-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.folder === folder);
    });

    // 切换面板
    document.querySelectorAll('.mail-tab-panel').forEach(p => {
        p.classList.toggle('active', p.id === `panel-${folder}`);
    });

    // 隐藏内容视图，显示列表
    showMailListView();
}

function showMailListView() {
    document.getElementById('mail-content-view').classList.remove('active');
    // 显示当前 Tab 面板
    document.querySelectorAll('.mail-tab-panel').forEach(p => {
        p.classList.toggle('active', p.id === `panel-${currentMailFolder}`);
    });
    document.querySelector('.mail-tabs').style.display = 'flex';
}

function showMailContentView() {
    // 隐藏所有 Tab 面板和 Tab 栏
    document.querySelectorAll('.mail-tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.mail-tabs').style.display = 'none';
    document.getElementById('mail-content-view').classList.add('active');
}

async function loadMailList(accountId, folder) {
    folder = folder || currentMailFolder;
    const container = document.getElementById(`mail-list-${folder}`);
    const info = document.getElementById(`mail-info-${folder}`);
    container.innerHTML = '<div class="mail-loading">加载中...</div>';
    info.textContent = '';

    try {
        const res = await fetch(`/api/outlook/accounts/${accountId}/mails?folder=${folder}&limit=50`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();

        if (!result.success) {
            container.innerHTML = `<div class="mail-empty">${escapeHtml(result.error)}</div>`;
            return;
        }

        const { mails, total, unseen } = result.data;
        info.textContent = `共 ${total} 封，${unseen} 封未读`;

        // 更新 Tab badge
        const badgeId = folder === 'INBOX' ? 'inbox-badge' : 'junk-badge';
        document.getElementById(badgeId).textContent = total;

        if (mails.length === 0) {
            container.innerHTML = '<div class="mail-empty">没有邮件</div>';
            return;
        }

        container.innerHTML = mails.map(m => {
            const unreadClass = m.seen ? '' : 'unread';
            const dateStr = m.date ? formatDateTime(m.date) : '';
            return `<div class="mail-item ${unreadClass}" onclick="viewMail(${accountId}, ${m.uid}, '${folder}')">
                <div class="mail-item-dot"></div>
                <div class="mail-item-content">
                    <div class="mail-item-subject">${escapeHtml(m.subject)}</div>
                    <div class="mail-item-from">${escapeHtml(m.from)}</div>
                </div>
                <div class="mail-item-date">${dateStr}</div>
                <div class="mail-item-actions">
                    <button onclick="event.stopPropagation(); deleteOneMail(${accountId}, ${m.uid}, '${folder}')" title="删除">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = `<div class="mail-empty">加载失败: ${escapeHtml(e.message)}</div>`;
    }
}

async function viewMail(accountId, uid, folder) {
    folder = folder || currentMailFolder;
    currentMailFolder = folder;
    showMailContentView();
    document.getElementById('mail-view-subject').textContent = '加载中...';
    document.getElementById('mail-view-from').textContent = '';
    document.getElementById('mail-view-date').textContent = '';
    document.getElementById('mail-view-body').textContent = '';

    try {
        const res = await fetch(`/api/outlook/accounts/${accountId}/mails/${uid}?folder=${folder}`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();

        if (!result.success) {
            document.getElementById('mail-view-subject').textContent = '加载失败';
            document.getElementById('mail-view-body').textContent = result.error;
            return;
        }

        const mail = result.data;
        document.getElementById('mail-view-subject').textContent = mail.subject;
        document.getElementById('mail-view-from').textContent = `From: ${mail.from}`;
        document.getElementById('mail-view-date').textContent = mail.date ? formatDateTime(mail.date) : '';

        if (mail.html) {
            const bodyEl = document.getElementById('mail-view-body');
            bodyEl.innerHTML = '';
            const iframe = document.createElement('iframe');
            iframe.style.cssText = 'width:100%;min-height:300px;border:none;background:white;border-radius:8px;';
            iframe.sandbox = 'allow-same-origin';
            bodyEl.appendChild(iframe);
            iframe.contentDocument.open();
            iframe.contentDocument.write(mail.html);
            iframe.contentDocument.close();
            setTimeout(() => {
                try { iframe.style.height = iframe.contentDocument.body.scrollHeight + 20 + 'px'; } catch(e) {}
            }, 200);
        } else {
            document.getElementById('mail-view-body').textContent = mail.body || '(无内容)';
        }
    } catch (e) {
        document.getElementById('mail-view-subject').textContent = '加载失败';
        document.getElementById('mail-view-body').textContent = e.message;
    }
}

async function deleteOneMail(accountId, uid, folder) {
    folder = folder || currentMailFolder;
    if (!confirm('确定要删除这封邮件吗？')) return;
    try {
        const res = await fetch(`/api/outlook/accounts/${accountId}/mails/${uid}?folder=${folder}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        const result = await res.json();
        if (result.success) {
            showToast('邮件已删除', 'success');
            loadMailList(accountId, folder);
        } else {
            showToast(result.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('网络错误: ' + e.message, 'error');
    }
}

async function deleteAllMailsAction(folder) {
    folder = folder || currentMailFolder;
    if (!currentMailAccountId) return;
    const folderName = folder === 'INBOX' ? '收件箱' : '垃圾箱';
    if (!confirm(`确定要删除 ${folderName} 中的全部邮件吗？此操作不可恢复！`)) return;
    try {
        const res = await fetch(`/api/outlook/accounts/${currentMailAccountId}/mails?folder=${folder}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` },
        });
        const result = await res.json();
        if (result.success) {
            showToast(result.message || '已删除全部邮件', 'success');
            loadMailList(currentMailAccountId, folder);
        } else {
            showToast(result.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('网络错误: ' + e.message, 'error');
    }
}
