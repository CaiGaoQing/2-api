// AMI 账号管理页面 JavaScript

let credentials = [];
let currentView = 'grid';
let searchQuery = '';

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 检查认证
    if (!await checkAuth()) return;

    // 加载侧边栏
    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = getSidebarHTML();
        initSidebar('ami');
        updateSidebarStats();
    }

    // 绑定事件
    bindEvents();

    // 加载数据
    await loadCredentials();
});

// 绑定事件
function bindEvents() {
    // 添加账号按钮
    document.getElementById('add-account-btn')?.addEventListener('click', openAddModal);
    document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);

    // 刷新按钮
    document.getElementById('refresh-btn')?.addEventListener('click', loadCredentials);

    // 模态框关闭
    document.getElementById('modal-close')?.addEventListener('click', closeAddModal);
    document.getElementById('modal-cancel')?.addEventListener('click', closeAddModal);
    document.getElementById('edit-modal-close')?.addEventListener('click', closeEditModal);
    document.getElementById('edit-modal-cancel')?.addEventListener('click', closeEditModal);

    // 点击遮罩关闭
    document.getElementById('add-modal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeAddModal();
    });
    document.getElementById('edit-modal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeEditModal();
    });

    // 表单提交
    document.getElementById('add-account-form')?.addEventListener('submit', handleAddAccount);
    document.getElementById('edit-account-form')?.addEventListener('submit', handleEditAccount);

    // 粘贴按钮
    document.getElementById('paste-cookie-btn')?.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            document.getElementById('session-cookie').value = text;
        } catch (e) {
            showToast('无法访问剪贴板', 'error');
        }
    });

    // 粘贴导入按钮
    document.getElementById('paste-import-btn')?.addEventListener('click', openImportModal);
    document.getElementById('import-modal-close')?.addEventListener('click', closeImportModal);
    document.getElementById('import-modal-cancel')?.addEventListener('click', closeImportModal);
    document.getElementById('import-modal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeImportModal();
    });
    document.getElementById('import-paste-btn')?.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            document.getElementById('import-data').value = text;
        } catch (e) {
            showToast('无法访问剪贴板', 'error');
        }
    });
    document.getElementById('import-submit-btn')?.addEventListener('click', handleBatchImport);

    // 批量刷新
    document.getElementById('refresh-all-btn')?.addEventListener('click', handleRefreshAll);

    // 搜索
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderCredentials();
    });

    // 视图切换
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentView = btn.dataset.view;
            renderCredentials();
        });
    });
}

// 加载凭据列表
async function loadCredentials() {
    showLoading(true);

    try {
        const res = await fetch('/api/ami/credentials', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();

        if (data.success) {
            credentials = data.data || [];
            updateStats();
            renderCredentials();
        } else {
            showToast(data.error || '加载失败', 'error');
        }
    } catch (e) {
        showToast('加载凭据失败: ' + e.message, 'error');
    } finally {
        showLoading(false);
    }
}

// 格式化 token 数量（1234567 → 1.23M）
function formatTokens(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(n);
}

// 更新统计（使用 ami- 前缀 ID，避免与侧边栏 common.js 冲突）
function updateStats() {
    const total = credentials.length;
    const active = credentials.filter(c => c.status === 'active' && c.isActive).length;
    const error = credentials.filter(c => c.status === 'error' || c.errorCount > 0).length;
    const totalTokens = credentials.reduce((sum, c) => sum + (c.inputTokens || 0) + (c.outputTokens || 0), 0);

    document.getElementById('ami-stat-total').textContent = total;
    document.getElementById('ami-stat-active').textContent = active;
    document.getElementById('ami-stat-error').textContent = error;
    document.getElementById('ami-stat-usage').textContent = formatTokens(totalTokens);
}

// 渲染凭据列表
function renderCredentials() {
    const grid = document.getElementById('cards-grid');
    const list = document.getElementById('list-view');
    const empty = document.getElementById('empty-state');

    // 过滤
    let filtered = credentials;
    if (searchQuery) {
        filtered = credentials.filter(c =>
            c.name?.toLowerCase().includes(searchQuery) ||
            c.note?.toLowerCase().includes(searchQuery) ||
            c.projectId?.toLowerCase().includes(searchQuery)
        );
    }

    if (filtered.length === 0) {
        grid.style.display = 'none';
        list.style.display = 'none';
        empty.style.display = 'block';
        return;
    }

    empty.style.display = 'none';

    if (currentView === 'grid') {
        grid.style.display = 'grid';
        list.style.display = 'none';
        grid.innerHTML = filtered.map(c => renderCard(c)).join('');
    } else {
        grid.style.display = 'none';
        list.style.display = 'block';
        list.innerHTML = filtered.map(c => renderListItem(c)).join('');
    }

    // 绑定卡片事件
    bindCardEvents();
}

// 渲染卡片
function renderCard(credential) {
    const statusClass = credential.status === 'active' ? 'active' : 'error';
    const statusText = credential.status === 'active' ? '正常' : '异常';

    // 健康度：errorCount 0→100%, 3→0%
    const maxErrors = 3;
    const errCount = credential.errorCount || 0;
    const healthPct = Math.max(0, Math.round((1 - errCount / maxErrors) * 100));
    const healthColor = healthPct > 60 ? 'var(--accent-success)' : healthPct > 30 ? 'var(--accent-warning)' : 'var(--accent-danger)';

    // 今日用量 vs 2M 免费额度（2,000,000 tokens）
    const FREE_QUOTA = 2000000;
    const dailyUsage = credential.dailyUsage || 0;
    const quotaPct = Math.min(100, Math.round((dailyUsage / FREE_QUOTA) * 100));
    const quotaColor = quotaPct < 60 ? 'var(--accent-primary)' : quotaPct < 85 ? 'var(--accent-warning)' : 'var(--accent-danger)';

    // 账户类型
    const isPaid = credential.isPaid;
    const accountBadge = isPaid
        ? '<span class="ami-badge paid">PRO</span>'
        : '<span class="ami-badge free">FREE</span>';

    // Token 过期
    const tokenHours = credential.tokenExpiresHours || 0;

    return `
        <div class="ami-card" data-id="${credential.id}">
            <div class="ami-card-header">
                <div class="ami-card-info">
                    <div class="ami-card-name">${accountBadge} ${escapeHtml(credential.name)}</div>
                    <div class="ami-card-id">ID: ${credential.id}${tokenHours > 0 ? ` · Token ${tokenHours}h` : ''}</div>
                </div>
                <div class="ami-card-status ${statusClass}">
                    <span class="status-dot"></span>
                    ${statusText}
                </div>
            </div>
            <div class="ami-card-bars">
                <div class="ami-bar-row">
                    <span class="ami-bar-label">今日用量</span>
                    <div class="ami-bar-track">
                        <div class="ami-bar-fill" style="width:${quotaPct}%;background:${quotaColor}"></div>
                    </div>
                    <span class="ami-bar-value">${formatTokens(dailyUsage)}</span>
                </div>
                <div class="ami-bar-row">
                    <span class="ami-bar-label">健康度</span>
                    <div class="ami-bar-track">
                        <div class="ami-bar-fill" style="width:${healthPct}%;background:${healthColor}"></div>
                    </div>
                    <span class="ami-bar-value">${healthPct}%</span>
                </div>
            </div>
            ${credential.note ? `<div class="ami-card-note">${escapeHtml(credential.note)}</div>` : ''}
            <div class="ami-card-actions">
                <button class="btn-icon-only success" onclick="refreshQuota(${credential.id})" title="刷新额度">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                        <polyline points="22 2 22 8 16 8"/>
                    </svg>
                </button>
                <button class="btn-icon-only" onclick="testCredential(${credential.id})" title="测试">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                </button>
                <button class="btn-icon-only" onclick="openEditModal(${credential.id})" title="编辑">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                    </svg>
                </button>
                <button class="btn-icon-only danger" onclick="deleteCredential(${credential.id})" title="删除">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `;
}

// 渲染列表项
function renderListItem(credential) {
    const statusClass = credential.status === 'active' ? 'active' : 'error';
    const statusText = credential.status === 'active' ? '正常' : '异常';
    const badge = credential.isPaid ? '<span class="ami-badge paid">PRO</span>' : '<span class="ami-badge free">FREE</span>';

    return `
        <div class="ami-list-item" data-id="${credential.id}">
            <div class="ami-list-name">
                ${badge} ${escapeHtml(credential.name)}
                ${credential.note ? `<span class="ami-list-note">${escapeHtml(credential.note)}</span>` : ''}
            </div>
            <div class="ami-list-status ${statusClass}">
                <span class="status-dot"></span>
                ${statusText}
            </div>
            <div class="ami-list-value">${formatTokens(credential.dailyUsage || 0)}</div>
            <div class="ami-list-value">${credential.useCount || 0} 次</div>
            <div class="ami-list-value">${credential.lastUsedAt ? formatDateTime(credential.lastUsedAt) : '-'}</div>
            <div class="ami-list-actions">
                <button class="btn-icon-only success" onclick="refreshQuota(${credential.id})" title="刷新额度">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                        <polyline points="22 2 22 8 16 8"/>
                    </svg>
                </button>
                <button class="btn-icon-only" onclick="testCredential(${credential.id})" title="测试">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                </button>
                <button class="btn-icon-only" onclick="openEditModal(${credential.id})" title="编辑">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                    </svg>
                </button>
                <button class="btn-icon-only danger" onclick="deleteCredential(${credential.id})" title="删除">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                </button>
            </div>
        </div>
    `;
}

// 绑定卡片事件
function bindCardEvents() {
    // 卡片点击事件已通过 onclick 绑定
}

// 打开添加模态框
function openAddModal() {
    document.getElementById('add-modal').classList.add('active');
    document.getElementById('add-account-form').reset();
}

// 关闭添加模态框
function closeAddModal() {
    document.getElementById('add-modal').classList.remove('active');
}

// 打开编辑模态框
function openEditModal(id) {
    const credential = credentials.find(c => c.id === id);
    if (!credential) return;

    document.getElementById('edit-id').value = id;
    document.getElementById('edit-name').value = credential.name || '';
    document.getElementById('edit-session-cookie').value = '';
    document.getElementById('edit-project-id').value = credential.projectId || '';
    document.getElementById('edit-chat-id').value = credential.chatId || '';
    document.getElementById('edit-note').value = credential.note || '';
    document.getElementById('edit-account-name').textContent = credential.name;

    document.getElementById('edit-modal').classList.add('active');
}

// 关闭编辑模态框
function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('active');
}

// 添加账号
async function handleAddAccount(e) {
    e.preventDefault();

    const sessionCookie = document.getElementById('session-cookie').value.trim();
    const name = document.getElementById('account-name').value.trim();
    const projectId = document.getElementById('project-id').value.trim();
    const chatId = document.getElementById('chat-id').value.trim();
    const note = document.getElementById('account-note').value.trim();

    if (!sessionCookie) {
        showToast('请输入 wos-session Cookie', 'error');
        return;
    }

    try {
        const res = await fetch('/api/ami/credentials', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                name: name || undefined,
                sessionCookie,
                projectId: projectId || undefined,
                chatId: chatId || undefined,
                note: note || undefined
            })
        });

        const data = await res.json();

        if (data.success) {
            showToast('账号添加成功', 'success');
            closeAddModal();
            await loadCredentials();
        } else {
            showToast(data.error || '添加失败', 'error');
        }
    } catch (e) {
        showToast('添加失败: ' + e.message, 'error');
    }
}

// 编辑账号
async function handleEditAccount(e) {
    e.preventDefault();

    const id = document.getElementById('edit-id').value;
    const name = document.getElementById('edit-name').value.trim();
    const sessionCookie = document.getElementById('edit-session-cookie').value.trim();
    const projectId = document.getElementById('edit-project-id').value.trim();
    const chatId = document.getElementById('edit-chat-id').value.trim();
    const note = document.getElementById('edit-note').value.trim();

    try {
        const body = {
            name: name || undefined,
            projectId: projectId || undefined,
            chatId: chatId || undefined,
            note: note || undefined
        };

        // 只有填写了新的 Cookie 才更新
        if (sessionCookie) {
            body.sessionCookie = sessionCookie;
        }

        const res = await fetch(`/api/ami/credentials/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(body)
        });

        const data = await res.json();

        if (data.success) {
            showToast('账号更新成功', 'success');
            closeEditModal();
            await loadCredentials();
        } else {
            showToast(data.error || '更新失败', 'error');
        }
    } catch (e) {
        showToast('更新失败: ' + e.message, 'error');
    }
}

// 测试凭据
async function testCredential(id) {
    showToast('正在测试凭据...', 'info');

    try {
        const res = await fetch(`/api/ami/credentials/${id}/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const data = await res.json();

        if (data.success) {
            showToast('凭据测试成功', 'success');
            await loadCredentials();
        } else {
            showToast(data.error || '测试失败', 'error');
        }
    } catch (e) {
        showToast('测试失败: ' + e.message, 'error');
    }
}

// 删除凭据
async function deleteCredential(id) {
    if (!confirm('确定要删除这个账号吗？此操作不可恢复。')) {
        return;
    }

    try {
        const res = await fetch(`/api/ami/credentials/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const data = await res.json();

        if (data.success) {
            showToast('账号已删除', 'success');
            await loadCredentials();
        } else {
            showToast(data.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

// 显示/隐藏加载状态
function showLoading(show) {
    const loading = document.getElementById('loading-state');
    const grid = document.getElementById('cards-grid');
    const list = document.getElementById('list-view');
    const empty = document.getElementById('empty-state');

    if (show) {
        loading.style.display = 'block';
        grid.style.display = 'none';
        list.style.display = 'none';
        empty.style.display = 'none';
    } else {
        loading.style.display = 'none';
    }
}

// HTML 转义
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 打开粘贴导入模态框
function openImportModal() {
    document.getElementById('import-modal').classList.add('active');
    document.getElementById('import-data').value = '';
    document.getElementById('import-progress').style.display = 'none';
    document.getElementById('import-submit-btn').disabled = false;
}

// 关闭粘贴导入模态框
function closeImportModal() {
    document.getElementById('import-modal').classList.remove('active');
}

// 批量导入处理
async function handleBatchImport() {
    const raw = document.getElementById('import-data').value.trim();
    if (!raw) {
        showToast('请粘贴账号数据', 'error');
        return;
    }

    // 解析每行：email----cookie
    const lines = raw.split('\n').map(l => l.trim()).filter(l => l && l.includes('----'));
    if (lines.length === 0) {
        showToast('未找到有效数据，请检查格式（邮箱----Cookie）', 'error');
        return;
    }

    const entries = lines.map(line => {
        const idx = line.indexOf('----');
        const email = line.substring(0, idx).trim();
        const cookie = line.substring(idx + 4).trim();
        return { email, cookie };
    }).filter(e => e.email && e.cookie);

    if (entries.length === 0) {
        showToast('解析后无有效条目', 'error');
        return;
    }

    // 显示进度
    const progressEl = document.getElementById('import-progress');
    const progressText = document.getElementById('import-progress-text');
    const progressBar = document.getElementById('import-progress-bar');
    progressEl.style.display = 'block';
    document.getElementById('import-submit-btn').disabled = true;

    let success = 0;
    let fail = 0;

    for (let i = 0; i < entries.length; i++) {
        const { email, cookie } = entries[i];
        progressText.textContent = `${i + 1}/${entries.length}`;
        progressBar.style.width = `${((i + 1) / entries.length) * 100}%`;

        try {
            const res = await fetch('/api/ami/credentials', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify({
                    name: email,
                    sessionCookie: cookie,
                })
            });
            const data = await res.json();
            if (data.success) {
                success++;
            } else {
                fail++;
            }
        } catch {
            fail++;
        }
    }

    showToast(`导入完成：成功 ${success} 个，失败 ${fail} 个`, success > 0 ? 'success' : 'error');
    document.getElementById('import-submit-btn').disabled = false;

    if (success > 0) {
        closeImportModal();
        await loadCredentials();
    }
}

// ============ 批量刷新账户状态 ============

async function handleRefreshAll() {
    const btn = document.getElementById('refresh-all-btn');
    if (!btn) return;
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/><polyline points="22 2 22 8 16 8"/></svg> 刷新中...`;

    try {
        const res = await fetch('/api/ami/credentials/refresh-all', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });
        const data = await res.json();

        if (data.success) {
            const ok = data.data.filter(r => r.success).length;
            const fail = data.data.filter(r => !r.success).length;
            showToast(`刷新完成：成功 ${ok} 个，失败 ${fail} 个`, ok > 0 ? 'success' : 'error');
            await loadCredentials();
        } else {
            showToast('批量刷新失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (e) {
        showToast('批量刷新请求失败: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
    }
}

async function refreshQuota(id) {
    showToast('正在刷新额度...', 'info');

    try {
        const res = await fetch(`/api/ami/credentials/${id}/refresh`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const data = await res.json();

        if (data.success) {
            showToast('额度刷新成功', 'success');
            const updated = data.data;
            if (updated) {
                const idx = credentials.findIndex(c => c.id === id);
                if (idx !== -1) {
                    Object.assign(credentials[idx], updated);
                    updateStats();
                    const card = document.querySelector(`.ami-card[data-id="${id}"], .ami-list-item[data-id="${id}"]`);
                    if (card) {
                        const newHtml = currentView === 'grid' ? renderCard(credentials[idx]) : renderListItem(credentials[idx]);
                        card.outerHTML = newHtml;
                    }
                }
            }
        } else {
            showToast(data.error || '刷新失败', 'error');
        }
    } catch (e) {
        showToast('刷新失败: ' + e.message, 'error');
    }
}
