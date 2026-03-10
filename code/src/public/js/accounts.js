// ============ 账号管理页面 JS ============

// 状态变量
let credentials = [];
let selectedIds = new Set();
let currentFilter = 'all';
let searchQuery = '';
let contextMenuTarget = null;

// DOM 元素
let accountsTbody, emptyState, addModal, batchImportModal, contextMenu, searchInput;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 获取 DOM 元素
    accountsTbody = document.getElementById('accounts-tbody');
    emptyState = document.getElementById('empty-state');
    addModal = document.getElementById('add-modal');
    batchImportModal = document.getElementById('batch-import-modal');
    contextMenu = document.getElementById('context-menu');
    searchInput = document.getElementById('search-input');

    // 先加载站点设置
    await loadSiteSettings();

    // 注入侧边栏
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('accounts');

    // 更新页面标题和副标题
    const settings = window.siteSettings;
    document.title = `账号管理 - ${settings.siteName} ${settings.siteSubtitle}`;
    const pageSubtitle = document.querySelector('.page-subtitle');
    if (pageSubtitle) {
        pageSubtitle.textContent = `管理您的 ${settings.siteName} API 凭证`;
    }

    if (!await checkAuth()) return;

    loadCredentials();
    setupEventListeners();
    updateSidebarStats();
});

// 事件监听器
function setupEventListeners() {
    // 添加账号按钮
    document.getElementById('add-account-btn').addEventListener('click', openAddModal);
    document.getElementById('empty-add-btn')?.addEventListener('click', openAddModal);

    // 批量导入按钮
    document.getElementById('batch-import-btn').addEventListener('click', openBatchImportModal);
    document.getElementById('batch-modal-close').addEventListener('click', closeBatchImportModal);
    document.getElementById('batch-modal-cancel').addEventListener('click', closeBatchImportModal);
    document.getElementById('batch-modal-submit').addEventListener('click', handleBatchImport);
    batchImportModal.addEventListener('click', (e) => {
        if (e.target === batchImportModal) closeBatchImportModal();
    });

    // 模态框控制
    document.getElementById('modal-close').addEventListener('click', closeAddModal);
    document.getElementById('modal-cancel').addEventListener('click', closeAddModal);
    document.getElementById('modal-submit').addEventListener('click', handleAddAccount);
    addModal.addEventListener('click', (e) => {
        if (e.target === addModal) closeAddModal();
    });

    // 认证方式切换
    document.getElementById('auth-method').addEventListener('change', (e) => {
        const clientCreds = document.getElementById('client-credentials');
        clientCreds.style.display = ['builder-id', 'IdC'].includes(e.target.value) ? 'block' : 'none';
    });

    // 搜索
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase();
        renderTable();
    });

    // 键盘快捷键
    document.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
            e.preventDefault();
            searchInput.focus();
        }
        if (e.key === 'Escape') {
            closeAddModal();
            closeBatchImportModal();
            hideContextMenu();
        }
    });

    // 筛选标签
    document.querySelectorAll('.header-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.header-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderTable();
        });
    });

    // 全选
    document.getElementById('select-all').addEventListener('change', (e) => {
        const filtered = getFilteredCredentials();
        if (e.target.checked) {
            filtered.forEach(c => selectedIds.add(c.id));
        } else {
            selectedIds.clear();
        }
        // 同步表格全选
        const tableSelectAll = document.getElementById('table-select-all');
        if (tableSelectAll) tableSelectAll.checked = e.target.checked;
        renderTable();
        updateBatchDeleteBtn();
    });

    // 表格全选
    document.getElementById('table-select-all')?.addEventListener('change', (e) => {
        const filtered = getFilteredCredentials();
        if (e.target.checked) {
            filtered.forEach(c => selectedIds.add(c.id));
        } else {
            selectedIds.clear();
        }
        // 同步头部全选
        document.getElementById('select-all').checked = e.target.checked;
        renderTable();
        updateBatchDeleteBtn();
    });

    // 封禁检测
    document.getElementById('ban-check-btn').addEventListener('click', batchBanCheck);

    // 批量刷新额度
    document.getElementById('refresh-usage-btn').addEventListener('click', batchRefreshUsageSSE);

    // 批量刷新Token
    document.getElementById('refresh-all-btn').addEventListener('click', batchRefreshAllSSE);

    // 批量删除
    document.getElementById('batch-delete-btn').addEventListener('click', batchDelete);

    // 进度弹窗关闭
    document.getElementById('progress-modal-close').addEventListener('click', closeProgressModal);
    document.getElementById('progress-modal-done').addEventListener('click', closeProgressModal);

    // 右键菜单
    document.addEventListener('click', hideContextMenu);
    contextMenu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => handleContextAction(item.dataset.action));
    });

    // 初始化 IdC 导入功能
    initIdcImport();
}

// API 函数
async function loadCredentials() {
    try {
        const res = await fetch('/api/credentials', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        credentials = Array.isArray(result) ? result : (result.data || []);
        updateCounts();
        renderTable();
    } catch (err) {
        console.error('Load credentials error:', err);
        showToast('加载账号失败', 'error');
    }
}

// ============ 进度弹窗控制 ============
function openProgressModal(title) {
    const modal = document.getElementById('progress-modal');
    document.getElementById('progress-title').textContent = title;
    document.getElementById('progress-text').textContent = '准备中...';
    document.getElementById('progress-percent').textContent = '0%';
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-success').textContent = '0';
    document.getElementById('progress-fail').textContent = '0';
    document.getElementById('progress-remaining').textContent = '0';
    document.getElementById('progress-log').innerHTML = '';
    document.getElementById('progress-modal-done').style.display = 'none';
    modal.style.display = 'flex';
    modal.classList.add('active');
}

function closeProgressModal() {
    const modal = document.getElementById('progress-modal');
    modal.style.display = 'none';
    modal.classList.remove('active');
    loadCredentials();
    updateSidebarStats();
}

function updateProgress(current, total, successCount, failCount) {
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    document.getElementById('progress-text').textContent = current + ' / ' + total;
    document.getElementById('progress-percent').textContent = percent + '%';
    document.getElementById('progress-bar').style.width = percent + '%';
    document.getElementById('progress-success').textContent = successCount;
    document.getElementById('progress-fail').textContent = failCount;
    document.getElementById('progress-remaining').textContent = Math.max(0, total - current);
}

function appendProgressLog(text, type) {
    const log = document.getElementById('progress-log');
    const color = type === 'success' ? 'var(--accent-success)' : type === 'error' ? 'var(--accent-danger)' : type === 'banned' ? '#f59e0b' : 'var(--text-muted)';
    log.innerHTML += '<div style="color: ' + color + '; margin-bottom: 2px;">' + text + '</div>';
    log.scrollTop = log.scrollHeight;
}

function showProgressDone() {
    document.getElementById('progress-modal-done').style.display = 'inline-flex';
}

// ============ 封禁检测 (SSE) ============
async function batchBanCheck() {
    openProgressModal('封禁检测');
    appendProgressLog('开始批量封禁检测...', 'info');

    try {
        const evtSource = new EventSource('/api/credentials/batch-ban-check');

        evtSource.onmessage = function(event) {
            const data = JSON.parse(event.data);

            if (data.type === 'start') {
                appendProgressLog('共 ' + data.total + ' 个账号待检测', 'info');
            } else if (data.type === 'progress') {
                updateProgress(data.checked, data.total, data.activeCount, data.bannedCount + data.errorCount);
                const c = data.current;
                const icon = c.status === 'active' ? '✅' : c.status === 'banned' ? '🚫' : '⚠️';
                appendProgressLog(icon + ' ' + c.email + ' → ' + c.status + (c.message ? ' (' + c.message.substring(0, 60) + ')' : ''), c.status === 'active' ? 'success' : c.status === 'banned' ? 'banned' : 'error');
            } else if (data.type === 'done') {
                appendProgressLog('', 'info');
                appendProgressLog('检测完成: ' + data.activeCount + ' 正常, ' + data.bannedCount + ' 封禁, ' + data.errorCount + ' 异常', data.bannedCount > 0 ? 'banned' : 'success');
                showProgressDone();
                evtSource.close();
                loadCredentials();
            } else if (data.type === 'error') {
                appendProgressLog('错误: ' + data.message, 'error');
                showProgressDone();
                evtSource.close();
            }
        };

        evtSource.onerror = function() {
            appendProgressLog('连接断开', 'error');
            showProgressDone();
            evtSource.close();
        };
    } catch (err) {
        appendProgressLog('请求失败: ' + err.message, 'error');
        showProgressDone();
    }
}

// ============ 批量刷新额度 (SSE) ============
async function batchRefreshUsageSSE() {
    openProgressModal('批量刷新 Token + 额度');
    appendProgressLog('开始批量刷新...', 'info');

    try {
        const evtSource = new EventSource('/api/credentials/batch-refresh');

        evtSource.onmessage = function(event) {
            const data = JSON.parse(event.data);

            if (data.type === 'start') {
                appendProgressLog('共 ' + data.total + ' 个账号待刷新', 'info');
            } else if (data.type === 'progress') {
                updateProgress(data.refreshed, data.total, data.successCount, data.failCount);
                const c = data.current;
                const icon = c.status === 'success' ? '✅' : c.status === 'banned' ? '🚫' : c.status === 'usage_failed' ? '⚠️' : '❌';
                appendProgressLog(icon + ' ' + c.email + ' → ' + c.status + (c.message ? ' (' + c.message.substring(0, 60) + ')' : ''), c.status === 'success' ? 'success' : c.status === 'banned' ? 'banned' : 'error');
            } else if (data.type === 'done') {
                appendProgressLog('', 'info');
                appendProgressLog('刷新完成: ' + data.successCount + ' 成功, ' + data.failCount + ' 失败', data.failCount > 0 ? 'error' : 'success');
                showProgressDone();
                evtSource.close();
                loadCredentials();
            } else if (data.type === 'error') {
                appendProgressLog('错误: ' + data.message, 'error');
                showProgressDone();
                evtSource.close();
            }
        };

        evtSource.onerror = function() {
            appendProgressLog('连接断开', 'error');
            showProgressDone();
            evtSource.close();
        };
    } catch (err) {
        appendProgressLog('请求失败: ' + err.message, 'error');
        showProgressDone();
    }
}

// ============ 批量刷新 Token (SSE) ============
async function batchRefreshAllSSE() {
    openProgressModal('批量刷新 Token + 额度');
    appendProgressLog('开始批量刷新 Token...', 'info');

    try {
        const evtSource = new EventSource('/api/credentials/batch-refresh');

        evtSource.onmessage = function(event) {
            const data = JSON.parse(event.data);

            if (data.type === 'start') {
                appendProgressLog('共 ' + data.total + ' 个账号待刷新', 'info');
            } else if (data.type === 'progress') {
                updateProgress(data.refreshed, data.total, data.successCount, data.failCount);
                const c = data.current;
                const icon = c.status === 'success' ? '✅' : c.status === 'banned' ? '🚫' : '❌';
                appendProgressLog(icon + ' ' + c.email + ' → ' + c.message.substring(0, 80), c.status === 'success' ? 'success' : 'error');
            } else if (data.type === 'done') {
                appendProgressLog('', 'info');
                appendProgressLog('刷新完成: ' + data.successCount + ' 成功, ' + data.failCount + ' 失败', data.failCount > 0 ? 'error' : 'success');
                showProgressDone();
                evtSource.close();
                loadCredentials();
            } else if (data.type === 'error') {
                appendProgressLog('错误: ' + data.message, 'error');
                showProgressDone();
                evtSource.close();
            }
        };

        evtSource.onerror = function() {
            appendProgressLog('连接断开', 'error');
            showProgressDone();
            evtSource.close();
        };
    } catch (err) {
        appendProgressLog('请求失败: ' + err.message, 'error');
        showProgressDone();
    }
}

// 刷新单个账户额度
async function refreshSingleUsage(id) {
    const row = document.querySelector('tr[data-id="' + id + '"]');
    const usageCell = row?.querySelector('.usage-cell');
    if (usageCell) usageCell.innerHTML = '<span style="color: var(--text-muted);">加载中...</span>';

    try {
        const res = await fetch('/api/credentials/' + id + '/usage', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success && result.data) {
            const cred = credentials.find(c => c.id === id);
            if (cred) {
                cred.usage = result.data;
                cred.usageData = result.data;
            }
            showToast('额度刷新成功', 'success');
            renderTable();
        } else {
            showToast('额度刷新失败: ' + (result.error || '获取失败'), 'error');
            // 刷新失败可能账户已被移到异常表，重新加载列表
            await loadCredentials();
            updateSidebarStats();
        }
    } catch (err) {
        showToast('额度刷新失败: ' + err.message, 'error');
        // 刷新失败可能账户已被移到异常表，重新加载列表
        await loadCredentials();
        updateSidebarStats();
    }
}

// 刷新单个账户Token
async function refreshSingleToken(id) {
    showToast('正在刷新Token...', 'warning');
    try {
        const res = await fetch('/api/credentials/' + id + '/refresh', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            showToast('Token刷新成功', 'success');
            await loadCredentials();
        } else {
            showToast('Token刷新失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (err) {
        showToast('Token刷新失败: ' + err.message, 'error');
    }
}

// 显示额度加载错误
function updateCardUsageError(id, errorMsg) {
    const card = document.querySelector('.account-card[data-id="' + id + '"]');
    if (!card) return;
    const usageValue = card.querySelector('.usage-value');
    if (usageValue) {
        usageValue.textContent = '获取失败';
        usageValue.style.color = 'var(--accent-danger)';
        usageValue.title = errorMsg;
    }
}

// 更新卡片用量显示
function updateCardUsage(id, usage) {
    const card = document.querySelector('.account-card[data-id="' + id + '"]');
    if (!card) return;

    const usageSection = card.querySelector('.card-usage');
    if (!usageSection || !usage) return;

    let usagePercent = 0;
    let usedCount = 0;
    let totalCount = 0;
    let displayName = 'Credits';
    let isFreeTrialActive = false;
    let nextReset = null;

    if (usage.usageBreakdownList && usage.usageBreakdownList.length > 0) {
        const breakdown = usage.usageBreakdownList[0];
        displayName = breakdown.displayNamePlural || breakdown.displayName || 'Credits';

        if (breakdown.freeTrialInfo && breakdown.freeTrialInfo.freeTrialStatus === 'ACTIVE') {
            isFreeTrialActive = true;
            usedCount = breakdown.freeTrialInfo.currentUsageWithPrecision || breakdown.freeTrialInfo.currentUsage || 0;
            totalCount = breakdown.freeTrialInfo.usageLimitWithPrecision || breakdown.freeTrialInfo.usageLimit || 500;
        } else {
            usedCount = breakdown.currentUsageWithPrecision || breakdown.currentUsage || 0;
            totalCount = breakdown.usageLimitWithPrecision || breakdown.usageLimit || 50;
        }

        if (breakdown.nextDateReset) {
            nextReset = new Date(breakdown.nextDateReset * 1000);
        }

        usagePercent = totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0;
    }

    const usageClass = usagePercent > 80 ? 'danger' : usagePercent > 50 ? 'warning' : '';
    const resetText = nextReset ? formatResetDate(nextReset) : '';
    const trialBadge = isFreeTrialActive ? '<span style="background: var(--accent-success-bg); color: var(--accent-success); padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px;">试用中</span>' : '';

    usageSection.innerHTML = '<div class="usage-header">' +
        '<span class="usage-label">' + displayName + trialBadge + '</span>' +
        '<span class="usage-value ' + usageClass + '">' + usagePercent + '%</span>' +
        '</div>' +
        '<div class="usage-bar">' +
        '<div class="usage-bar-fill ' + usageClass + '" style="width: ' + Math.min(usagePercent, 100) + '%"></div>' +
        '</div>' +
        '<div class="usage-details">' +
        '<span class="usage-used">已用 ' + usedCount.toFixed(2) + ' / ' + totalCount + '</span>' +
        '<span class="usage-remaining">' + (resetText ? '重置: ' + resetText : '剩余 ' + (totalCount - usedCount).toFixed(2)) + '</span>' +
        '</div>';
}

function formatResetDate(date) {
    const now = new Date();
    const diff = date - now;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days < 0) return '已重置';
    if (days === 0) return '今天';
    if (days === 1) return '明天';
    return days + '天后';
}

async function handleAddAccount(e) {
    e.preventDefault();
    const authMethod = document.getElementById('auth-method').value;
    const email = document.getElementById('account-email').value;
    const region = document.getElementById('account-region').value;
    const provider = document.getElementById('account-provider').value;
    const refreshToken = document.getElementById('refresh-token').value;

    const data = { email: email, region: region, provider: provider, refreshToken: refreshToken, authMethod: authMethod };

    if (['builder-id', 'IdC'].includes(authMethod)) {
        data.clientId = document.getElementById('client-id').value;
        data.clientSecret = document.getElementById('client-secret').value;
    }

    try {
        const res = await fetch('/api/credentials', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify(data)
        });

        if (res.ok) {
            showToast('账号添加成功', 'success');
            closeAddModal();
            loadCredentials();
            updateSidebarStats();
        } else {
            const err = await res.json();
            showToast(err.error || '添加失败', 'error');
        }
    } catch (err) {
        showToast('网络错误', 'error');
    }
}

// refreshAllCredentials 已被 batchRefreshAllSSE 替代

async function batchDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm('确定要删除选中的 ' + selectedIds.size + ' 个账号吗？')) return;

    for (const id of selectedIds) {
        try {
            await fetch('/api/credentials/' + id, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
        } catch (err) {}
    }
    selectedIds.clear();
    await loadCredentials();
    showToast('批量删除完成', 'success');
    updateBatchDeleteBtn();
    updateSidebarStats();
}

// 右键菜单操作
async function handleContextAction(action) {
    if (!contextMenuTarget) return;
    const id = contextMenuTarget;

    switch (action) {
        case 'activate':
            await fetch('/api/credentials/' + id + '/activate', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            showToast('已设为活跃账号', 'success');
            break;
        case 'refresh':
            showToast('正在刷新令牌...', 'warning');
            await fetch('/api/credentials/' + id + '/refresh', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            showToast('令牌刷新成功', 'success');
            break;
        case 'test':
            showToast('正在测试连接...', 'warning');
            const testRes = await fetch('/api/credentials/' + id + '/test', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            const testData = await testRes.json();
            showToast(testData.success ? '连接测试成功' : '连接测试失败', testData.success ? 'success' : 'error');
            break;
        case 'usage':
            const usageRes = await fetch('/api/credentials/' + id + '/usage', {
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            const usage = await usageRes.json();
            alert(JSON.stringify(usage, null, 2));
            break;
        case 'delete':
            if (confirm('确定要删除此账号吗？')) {
                await fetch('/api/credentials/' + id, {
                    method: 'DELETE',
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                showToast('账号已删除', 'success');
                updateSidebarStats();
            }
            break;
        case 'ban-check':
            showToast('正在检测封禁状态...', 'warning');
            try {
                const banRes = await fetch('/api/credentials/' + id + '/ban-check', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                const banData = await banRes.json();
                if (banData.success) {
                    const s = banData.data.status;
                    if (s === 'active') {
                        showToast('账号状态正常', 'success');
                    } else if (s === 'banned') {
                        showToast('账号已被封禁，已移至错误凭证: ' + banData.data.message, 'error');
                        loadCredentials();
                    } else if (s === 'refresh_failed') {
                        showToast('Token 刷新失败，已移至错误凭证: ' + (banData.data.message || ''), 'error');
                        loadCredentials();
                    } else {
                        showToast('检测异常，已移至错误凭证: ' + (banData.data.message || ''), 'warning');
                        loadCredentials();
                    }
                } else {
                    showToast('检测失败: ' + banData.error, 'error');
                }
            } catch (banErr) {
                showToast('检测失败: ' + banErr.message, 'error');
            }
            break;
        case 'chat':
            window.location.href = '/pages/chat.html?account=' + id;
            break;
    }
    await loadCredentials();
    hideContextMenu();
}

// 渲染函数
function getFilteredCredentials() {
    return credentials.filter(function(c) {
        let matchesFilter = false;
        if (currentFilter === 'all') {
            matchesFilter = true;
        } else if (currentFilter === 'idc') {
            matchesFilter = c.authMethod === 'IdC' || c.authMethod === 'builder-id' || c.provider === 'BuilderId' || c.provider === 'Enterprise';
        } else {
            matchesFilter = c.provider && c.provider.toLowerCase() === currentFilter;
        }
        const matchesSearch = !searchQuery ||
            (c.email && c.email.toLowerCase().includes(searchQuery)) ||
            (c.provider && c.provider.toLowerCase().includes(searchQuery)) ||
            (c.name && c.name.toLowerCase().includes(searchQuery));
        return matchesFilter && matchesSearch;
    });
}

function renderTable() {
    const filtered = getFilteredCredentials();
    document.getElementById('displayed-count').textContent = filtered.length;
    const tableContainer = document.getElementById('accounts-table-container');

    if (filtered.length === 0) {
        tableContainer.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    tableContainer.style.display = 'block';
    emptyState.style.display = 'none';

    accountsTbody.innerHTML = filtered.map(function(cred) { return createRowHTML(cred); }).join('');

    // 添加事件监听器
    accountsTbody.querySelectorAll('tr[data-id]').forEach(function(row) {
        const id = parseInt(row.dataset.id);

        row.querySelector('.row-checkbox')?.addEventListener('change', function(e) {
            e.stopPropagation();
            if (e.target.checked) {
                selectedIds.add(id);
            } else {
                selectedIds.delete(id);
            }
            updateBatchDeleteBtn();
        });

        row.addEventListener('contextmenu', function(e) {
            e.preventDefault();
            showContextMenu(e, id);
        });

        row.querySelectorAll('.btn-icon-sm[data-action]').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                contextMenuTarget = id;
                handleContextAction(btn.dataset.action);
            });
        });

        const copyBtn = row.querySelector('.copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                const cred = credentials.find(function(c) { return c.id === id; });
                if (cred && cred.email) copyToClipboard(cred.email);
            });
        }

        const refreshUsageBtn = row.querySelector('.btn-refresh-usage');
        if (refreshUsageBtn) {
            refreshUsageBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                refreshSingleUsage(id);
            });
        }

        const refreshTokenBtn = row.querySelector('.btn-refresh-token');
        if (refreshTokenBtn) {
            refreshTokenBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                refreshSingleToken(id);
            });
        }
    });
}

// 生成表格用量显示HTML
function generateTableUsageHTML(usage) {
    if (!usage) {
        return '<span style="color: var(--text-muted);">--</span>';
    }

    let usagePercent = 0;
    let usedCount = 0;
    let totalCount = 0;

    if (usage.usageBreakdownList && usage.usageBreakdownList.length > 0) {
        const breakdown = usage.usageBreakdownList[0];

        // 基础配额
        const baseUsed = breakdown.currentUsageWithPrecision || breakdown.currentUsage || 0;
        const baseQuota = breakdown.usageLimitWithPrecision || breakdown.usageLimit || 50;

        // 试用配额
        const freeTrialInfo = breakdown.freeTrialInfo;
        const isFreeTrialActive = freeTrialInfo && freeTrialInfo.freeTrialStatus === 'ACTIVE';
        const trialUsed = isFreeTrialActive ? (freeTrialInfo.currentUsageWithPrecision || freeTrialInfo.currentUsage || 0) : 0;
        const trialQuota = isFreeTrialActive ? (freeTrialInfo.usageLimitWithPrecision || freeTrialInfo.usageLimit || 0) : 0;

        // 奖励配额（bonuses 是数组）
        const bonuses = breakdown.bonuses || [];
        const bonusQuota = bonuses.reduce((sum, b) => sum + (b.usageLimit || 0), 0);
        const bonusUsed = bonuses.reduce((sum, b) => sum + (b.currentUsage || 0), 0);

        // 总计 = 基础 + 试用 + 奖励
        usedCount = baseUsed + trialUsed + bonusUsed;
        totalCount = baseQuota + trialQuota + bonusQuota;
        usagePercent = totalCount > 0 ? Math.round((usedCount / totalCount) * 100) : 0;
    }

    const remaining = totalCount - usedCount;
    const usageClass = usagePercent > 80 ? 'danger' : usagePercent > 50 ? 'warning' : 'success';
    const colorVar = usageClass === 'danger' ? 'var(--accent-danger)' : usageClass === 'warning' ? 'var(--accent-warning)' : 'var(--accent-success)';

    return '<div style="display: flex; flex-direction: column; gap: 4px;">' +
        '<div style="display: flex; align-items: center; gap: 8px;">' +
        '<div style="flex: 1; height: 6px; background: var(--bg-tertiary); border-radius: 3px; min-width: 60px;">' +
        '<div style="height: 100%; width: ' + Math.min(usagePercent, 100) + '%; background: ' + colorVar + '; border-radius: 3px;"></div>' +
        '</div>' +
        '<span style="color: ' + colorVar + '; font-weight: 500; font-size: 12px; min-width: 36px;">' + usagePercent + '%</span>' +
        '</div>' +
        '<div style="font-size: 11px; color: var(--text-muted);">剩余 ' + remaining.toFixed(1) + ' / ' + totalCount + '</div>' +
        '</div>';
}

function getSubscriptionBadge(usageData) {
    if (!usageData) return '';
    const subInfo = usageData.subscriptionInfo;
    if (!subInfo || !subInfo.type) return '';
    const title = subInfo.subscriptionTitle || 'Free';
    let bgColor = 'var(--bg-tertiary)';
    let textColor = 'var(--text-muted)';
    if (title.includes('PRO+') || title.includes('Pro+')) {
        bgColor = 'linear-gradient(135deg, #8b5cf6, #ec4899)';
        textColor = '#fff';
    } else if (title.includes('PRO') || title.includes('Pro')) {
        bgColor = '#3b82f6';
        textColor = '#fff';
    }
    const isGradient = bgColor.includes('gradient');
    return '<span style="display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; ' + (isGradient ? 'background: ' + bgColor : 'background: ' + bgColor) + '; color: ' + textColor + '; margin-left: 4px; vertical-align: middle;">' + title + '</span>';
}

function getStatusInfo(cred) {
    // 检查是否过期
    if (cred.expiresAt) {
        const expiresDate = new Date(cred.expiresAt);
        if (expiresDate < new Date()) {
            return { class: 'warning', text: '已过期' };
        }
    }
    // 检查用量是否耗尽
    if (cred.usageData) {
        const breakdown = cred.usageData.usageBreakdownList && cred.usageData.usageBreakdownList[0];
        if (breakdown) {
            // 基础
            const baseUsed = breakdown.currentUsage || 0;
            const baseQuota = breakdown.usageLimit || 50;
            // 试用
            const ft = breakdown.freeTrialInfo;
            const trialUsed = (ft && ft.freeTrialStatus === 'ACTIVE') ? (ft.currentUsage || 0) : 0;
            const trialQuota = (ft && ft.freeTrialStatus === 'ACTIVE') ? (ft.usageLimit || 0) : 0;
            // 奖励
            const bonuses = breakdown.bonuses || [];
            const bonusUsed = bonuses.reduce((s, b) => s + (b.currentUsage || 0), 0);
            const bonusQuota = bonuses.reduce((s, b) => s + (b.usageLimit || 0), 0);
            // 总计
            const totalUsed = baseUsed + trialUsed + bonusUsed;
            const totalCount = baseQuota + trialQuota + bonusQuota;
            if (totalCount > 0 && totalUsed >= totalCount) {
                return { class: 'error', text: '已耗尽' };
            }
            const percent = totalCount > 0 ? (totalUsed / totalCount) * 100 : 0;
            if (percent > 80) {
                return { class: 'warning', text: '即将耗尽' };
            }
        }
    }
    if (cred.status === 'error') return { class: 'error', text: '异常' };
    if (cred.status === 'warning') return { class: 'warning', text: '警告' };
    return { class: 'success', text: '正常' };
}

function createRowHTML(cred) {
    const isSelected = selectedIds.has(cred.id);
    const email = cred.email || cred.name || 'Unknown';
    const statusInfo = getStatusInfo(cred);
    const subBadge = getSubscriptionBadge(cred.usageData);

    let html = '<tr data-id="' + cred.id + '">';
    html += '<td><input type="checkbox" class="checkbox-custom row-checkbox"' + (isSelected ? ' checked' : '') + '></td>';
    html += '<td><div style="display: flex; align-items: center; gap: 6px;">';
    html += '<span style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + email + '">' + email + '</span>';
    html += subBadge;
    html += '<button class="copy-btn" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>';
    html += '</div></td>';
    html += '<td><span style="font-size: 12px; color: var(--text-secondary);">' + (cred.authMethod || 'social') + '</span></td>';
    const provider = (cred.provider || '').toLowerCase();
    const providerColor = provider === 'google' ? '#4285f4' : provider === 'github' ? '#a78bfa' : provider === 'builderid' ? '#f59e0b' : provider === 'enterprise' ? '#10b981' : 'var(--text-secondary)';
    html += '<td><span style="font-size: 12px; color: ' + providerColor + '; font-weight: 500;">' + (cred.provider || '--') + '</span></td>';
    html += '<td><span style="font-size: 12px; color: var(--text-muted);">' + (cred.region || 'us-east-1') + '</span></td>';
    html += '<td class="usage-cell">' + generateTableUsageHTML(cred.usageData) + '</td>';
    html += '<td><span style="font-size: 12px; color: var(--text-secondary);">' + formatExpireDate(cred.expiresAt) + '</span></td>';
    html += '<td><span class="status-badge ' + statusInfo.class + '">' + statusInfo.text + '</span></td>';
    html += '<td><div class="action-buttons">';
    html += '<button class="btn-icon-sm" data-action="chat" title="对话"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>';
    html += '<button class="btn-icon-sm btn-refresh-usage" title="刷新额度"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg></button>';
    html += '<button class="btn-icon-sm btn-refresh-token" title="刷新Token"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg></button>';
    html += '<button class="btn-icon-sm" data-action="ban-check" title="封禁检测"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></button>';
    html += '<button class="btn-icon-sm" data-action="test" title="测试"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>';
    html += '<button class="btn-icon-sm danger" data-action="delete" title="删除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
    html += '</div></td>';
    html += '</tr>';
    return html;
}

// 辅助函数
function updateCounts() {
    const total = credentials.length;
    const google = credentials.filter(function(c) { return c.provider && c.provider.toLowerCase() === 'google'; }).length;
    const github = credentials.filter(function(c) { return c.provider && c.provider.toLowerCase() === 'github'; }).length;
    const idc = credentials.filter(function(c) { return c.authMethod === 'IdC' || c.authMethod === 'builder-id' || c.provider === 'BuilderId' || c.provider === 'Enterprise'; }).length;

    document.getElementById('tab-count-all').textContent = total;
    document.getElementById('tab-count-google').textContent = google;
    document.getElementById('tab-count-github').textContent = github;
    document.getElementById('tab-count-idc').textContent = idc;

    // 更新统计卡片
    updateStatsCards();
}

// 更新统计卡片
function updateStatsCards() {
    let totalQuota = 0;
    let totalUsed = 0;
    let accountsWithUsage = 0;

    credentials.forEach(function(cred) {
        const usage = cred.usageData;
        if (usage && usage.usageBreakdownList && usage.usageBreakdownList.length > 0) {
            const breakdown = usage.usageBreakdownList[0];
            let usedCount = 0;
            let quotaCount = 0;

            if (breakdown.freeTrialInfo && breakdown.freeTrialInfo.freeTrialStatus === 'ACTIVE') {
                usedCount = breakdown.freeTrialInfo.currentUsageWithPrecision || breakdown.freeTrialInfo.currentUsage || 0;
                quotaCount = breakdown.freeTrialInfo.usageLimitWithPrecision || breakdown.freeTrialInfo.usageLimit || 500;
            } else {
                usedCount = breakdown.currentUsageWithPrecision || breakdown.currentUsage || 0;
                quotaCount = breakdown.usageLimitWithPrecision || breakdown.usageLimit || 50;
            }

            totalUsed += usedCount;
            totalQuota += quotaCount;
            accountsWithUsage++;
        }
    });

    const totalRemaining = totalQuota - totalUsed;
    const avgUsage = totalQuota > 0 ? Math.round((totalUsed / totalQuota) * 100) : 0;

    document.getElementById('stat-total-accounts').textContent = credentials.length;
    document.getElementById('stat-total-quota').textContent = totalQuota.toFixed(2);
    document.getElementById('stat-total-used').textContent = totalUsed.toFixed(2);
    document.getElementById('stat-total-remaining').textContent = totalRemaining.toFixed(2);
    document.getElementById('stat-avg-usage').textContent = avgUsage + '%';

    // 根据使用率设置颜色
    const avgUsageEl = document.getElementById('stat-avg-usage');
    avgUsageEl.className = 'stat-value';
    if (avgUsage > 80) {
        avgUsageEl.classList.add('danger');
    } else if (avgUsage > 50) {
        avgUsageEl.classList.add('warning');
    }
}

function updateBatchDeleteBtn() {
    const btn = document.getElementById('batch-delete-btn');
    btn.style.display = selectedIds.size > 0 ? 'inline-flex' : 'none';
}

function formatExpireDate(dateStr) {
    if (!dateStr) return '未知';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 0) return '已过期';
    if (hours < 24) return hours + '小时后';
    return Math.floor(hours / 24) + '天后';
}

// 模态框函数
function openAddModal() {
    addModal.classList.add('active');
    document.getElementById('add-account-form').reset();
    document.getElementById('client-credentials').style.display = 'none';
}

function closeAddModal() {
    addModal.classList.remove('active');
}

function openBatchImportModal() {
    batchImportModal.classList.add('active');
    document.getElementById('batch-json').value = '';
}

function closeBatchImportModal() {
    batchImportModal.classList.remove('active');
}

async function handleBatchImport() {
    const inputText = document.getElementById('batch-json').value.trim();
    const region = document.getElementById('batch-region').value;
    const provider = document.getElementById('batch-provider').value;

    if (!inputText) {
        showToast('请输入账号数据', 'error');
        return;
    }

    let accounts;

    if (inputText.startsWith('[')) {
        try {
            accounts = JSON.parse(inputText);
        } catch (err) {
            showToast('JSON 格式错误: ' + err.message, 'error');
            return;
        }
    } else {
        accounts = [];
        const lines = inputText.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const spaceIndex = line.indexOf(' ');
            if (spaceIndex === -1) {
                showToast('第 ' + (i + 1) + ' 行格式错误', 'error');
                return;
            }

            const email = line.substring(0, spaceIndex).trim();
            const refreshToken = line.substring(spaceIndex + 1).trim();

            if (!email || !refreshToken) {
                showToast('第 ' + (i + 1) + ' 行数据不完整', 'error');
                return;
            }

            accounts.push({ email: email, refreshToken: refreshToken });
        }
    }

    accounts = accounts.map(function(acc) {
        return Object.assign({}, acc, { provider: provider });
    });

    showToast('正在导入 ' + accounts.length + ' 个账号...', 'warning');

    try {
        const res = await fetch('/api/credentials/batch-import', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ accounts: accounts, region: region })
        });

        const result = await res.json();
        if (result.success) {
            showToast('导入完成: 成功 ' + result.data.success + ', 失败 ' + result.data.failed, 'success');
            closeBatchImportModal();
            loadCredentials();
            updateSidebarStats();
        } else {
            showToast(result.error || '导入失败', 'error');
        }
    } catch (err) {
        showToast('网络错误: ' + err.message, 'error');
    }
}

// 右键菜单函数
function showContextMenu(e, id) {
    contextMenuTarget = id;
    contextMenu.style.left = e.clientX + 'px';
    contextMenu.style.top = e.clientY + 'px';
    contextMenu.classList.add('active');
}

function hideContextMenu() {
    contextMenu.classList.remove('active');
    contextMenuTarget = null;
}

// ============ IdC 导入功能 ============
let importIdcModal;
let clientFileData = null;
let tokenFileData = null;
let currentImportMode = 'dual-file'; // 'dual-file' or 'json-array'

function initIdcImport() {
    importIdcModal = document.getElementById('import-idc-modal');
    if (!importIdcModal) return;

    // 打开模态框
    document.getElementById('import-idc-btn')?.addEventListener('click', openIdcImportModal);

    // 关闭模态框
    document.getElementById('idc-modal-close')?.addEventListener('click', closeIdcImportModal);
    document.getElementById('idc-modal-cancel')?.addEventListener('click', closeIdcImportModal);
    importIdcModal.addEventListener('click', (e) => {
        if (e.target === importIdcModal) closeIdcImportModal();
    });

    // 模式切换
    document.querySelectorAll('.import-mode-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.import-mode-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentImportMode = tab.dataset.mode;

            // 切换显示
            document.getElementById('dual-file-mode').style.display = currentImportMode === 'dual-file' ? 'block' : 'none';
            document.getElementById('json-array-mode').style.display = currentImportMode === 'json-array' ? 'block' : 'none';
        });
    });

    // 提交
    document.getElementById('idc-modal-submit')?.addEventListener('click', handleIdcImport);

    // 文件上传区域 - Client 文件
    const clientFileArea = document.getElementById('client-file-area');
    const clientFileInput = document.getElementById('client-file-input');
    if (clientFileArea && clientFileInput) {
        clientFileArea.addEventListener('click', () => clientFileInput.click());
        clientFileArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            clientFileArea.classList.add('dragover');
        });
        clientFileArea.addEventListener('dragleave', () => {
            clientFileArea.classList.remove('dragover');
        });
        clientFileArea.addEventListener('drop', (e) => {
            e.preventDefault();
            clientFileArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) handleClientFile(file);
        });
        clientFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleClientFile(file);
        });
    }

    // 文件上传区域 - Token 文件
    const tokenFileArea = document.getElementById('token-file-area');
    const tokenFileInput = document.getElementById('token-file-input');
    if (tokenFileArea && tokenFileInput) {
        tokenFileArea.addEventListener('click', () => tokenFileInput.click());
        tokenFileArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            tokenFileArea.classList.add('dragover');
        });
        tokenFileArea.addEventListener('dragleave', () => {
            tokenFileArea.classList.remove('dragover');
        });
        tokenFileArea.addEventListener('drop', (e) => {
            e.preventDefault();
            tokenFileArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) handleTokenFile(file);
        });
        tokenFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) handleTokenFile(file);
        });
    }

    // 移除文件按钮
    document.getElementById('client-file-remove')?.addEventListener('click', (e) => {
        e.stopPropagation();
        clearClientFile();
    });
    document.getElementById('token-file-remove')?.addEventListener('click', (e) => {
        e.stopPropagation();
        clearTokenFile();
    });
}

function openIdcImportModal() {
    if (!importIdcModal) return;
    importIdcModal.classList.add('active');
    // 重置表单
    document.getElementById('idc-name').value = '';
    document.getElementById('idc-client-json').value = '';
    document.getElementById('idc-token-json').value = '';
    document.getElementById('idc-json-array').value = '';
    clearClientFile();
    clearTokenFile();
    // 重置为双文件模式
    currentImportMode = 'dual-file';
    document.querySelectorAll('.import-mode-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.import-mode-tab[data-mode="dual-file"]')?.classList.add('active');
    document.getElementById('dual-file-mode').style.display = 'block';
    document.getElementById('json-array-mode').style.display = 'none';
}

function closeIdcImportModal() {
    if (!importIdcModal) return;
    importIdcModal.classList.remove('active');
}

function handleClientFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            clientFileData = JSON.parse(e.target.result);
            document.getElementById('client-file-area').style.display = 'none';
            document.getElementById('client-file-selected').style.display = 'flex';
            document.getElementById('client-file-name').textContent = file.name;
            document.getElementById('idc-client-json').value = JSON.stringify(clientFileData, null, 2);
        } catch (err) {
            showToast('Client 文件解析失败: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
}

function handleTokenFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            tokenFileData = JSON.parse(e.target.result);
            document.getElementById('token-file-area').style.display = 'none';
            document.getElementById('token-file-selected').style.display = 'flex';
            document.getElementById('token-file-name').textContent = file.name;
            document.getElementById('idc-token-json').value = JSON.stringify(tokenFileData, null, 2);
        } catch (err) {
            showToast('Token 文件解析失败: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
}

function clearClientFile() {
    clientFileData = null;
    const area = document.getElementById('client-file-area');
    const selected = document.getElementById('client-file-selected');
    if (area) area.style.display = 'flex';
    if (selected) selected.style.display = 'none';
    const input = document.getElementById('client-file-input');
    if (input) input.value = '';
}

function clearTokenFile() {
    tokenFileData = null;
    const area = document.getElementById('token-file-area');
    const selected = document.getElementById('token-file-selected');
    if (area) area.style.display = 'flex';
    if (selected) selected.style.display = 'none';
    const input = document.getElementById('token-file-input');
    if (input) input.value = '';
}

async function handleIdcImport() {
    // 根据当前模式处理
    if (currentImportMode === 'json-array') {
        await handleJsonArrayImport();
    } else {
        await handleDualFileImport();
    }
}

// 双文件模式导入
async function handleDualFileImport() {
    const name = document.getElementById('idc-name').value.trim();
    const clientJsonText = document.getElementById('idc-client-json').value.trim();
    const tokenJsonText = document.getElementById('idc-token-json').value.trim();

    // 优先使用文件数据，否则使用文本框内容
    let clientData = clientFileData;
    let tokenData = tokenFileData;

    if (!clientData && clientJsonText) {
        try {
            clientData = JSON.parse(clientJsonText);
        } catch (err) {
            showToast('Client JSON 解析失败: ' + err.message, 'error');
            return;
        }
    }

    if (!tokenData && tokenJsonText) {
        try {
            tokenData = JSON.parse(tokenJsonText);
        } catch (err) {
            showToast('Token JSON 解析失败: ' + err.message, 'error');
            return;
        }
    }

    if (!clientData) {
        showToast('请上传或粘贴 Client 文件内容', 'error');
        return;
    }

    if (!tokenData) {
        showToast('请上传或粘贴 Token 文件内容', 'error');
        return;
    }

    // 验证必需字段
    if (!clientData.clientId || !clientData.clientSecret) {
        showToast('Client 文件缺少 clientId 或 clientSecret', 'error');
        return;
    }

    if (!tokenData.accessToken || !tokenData.refreshToken) {
        showToast('Token 文件缺少 accessToken 或 refreshToken', 'error');
        return;
    }

    showToast('正在导入 IdC 凭证...', 'warning');

    try {
        const res = await fetch('/api/credentials/import-idc', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({
                name: name || undefined,
                clientFile: clientData,
                tokenFile: tokenData
            })
        });

        const result = await res.json();
        if (result.success) {
            const action = result.data.action === 'updated' ? '更新' : '创建';
            showToast(`IdC 凭证${action}成功: ${result.data.name}`, 'success');
            closeIdcImportModal();
            loadCredentials();
            updateSidebarStats();
        } else {
            showToast(result.error || '导入失败', 'error');
        }
    } catch (err) {
        showToast('网络错误: ' + err.message, 'error');
    }
}

// JSON 数组模式导入
async function handleJsonArrayImport() {
    const jsonArrayText = document.getElementById('idc-json-array').value.trim();

    if (!jsonArrayText) {
        showToast('请粘贴 JSON 数组内容', 'error');
        return;
    }

    let accounts;
    try {
        accounts = JSON.parse(jsonArrayText);
    } catch (err) {
        showToast('JSON 解析失败: ' + err.message, 'error');
        return;
    }

    if (!Array.isArray(accounts)) {
        showToast('数据必须是 JSON 数组格式', 'error');
        return;
    }

    if (accounts.length === 0) {
        showToast('数组不能为空', 'error');
        return;
    }

    showToast(`正在导入 ${accounts.length} 个 IdC 凭证...`, 'warning');

    try {
        const res = await fetch('/api/credentials/batch-import-idc', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ accounts })
        });

        const result = await res.json();
        if (result.success) {
            const data = result.data;
            showToast(`导入完成: 新增 ${data.success}, 更新 ${data.updated}, 失败 ${data.failed}`,
                data.failed > 0 ? 'warning' : 'success');
            closeIdcImportModal();
            loadCredentials();
            updateSidebarStats();
        } else {
            showToast(result.error || '导入失败', 'error');
        }
    } catch (err) {
        showToast('网络错误: ' + err.message, 'error');
    }
}
