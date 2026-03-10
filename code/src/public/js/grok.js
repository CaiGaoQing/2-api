/**
 * Grok Token 管理页面 JS
 */

let allTokens = [];
let currentFilter = 'all';

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
    if (!await checkAuth()) return;

    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = getSidebarHTML();
        initSidebar('grok');
        updateSidebarStats();
    }

    await loadTokens();
    bindEvents();
});

// ============ 数据加载 ============
async function loadTokens() {
    try {
        const res = await fetch('/api/grok/tokens', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();

        allTokens = data.tokens || [];
        const stats = data.stats || {};

        updateStats(stats);
        renderTable();
    } catch (e) {
        console.error('加载 Grok Token 失败:', e);
        showToast('加载失败: ' + e.message, 'error');
    }
}

function updateStats(stats) {
    const basicStats = stats.ssoBasic || {};
    const superStats = stats.ssoSuper || {};

    const total = (basicStats.total || 0) + (superStats.total || 0);
    const active = (basicStats.active || 0) + (superStats.active || 0);
    const cooling = (basicStats.cooling || 0) + (superStats.cooling || 0);
    const expired = (basicStats.expired || 0) + (superStats.expired || 0);
    const totalQuota = (basicStats.totalQuota || 0) + (superStats.totalQuota || 0);

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-cooling').textContent = cooling;
    document.getElementById('stat-expired').textContent = expired;
    document.getElementById('stat-quota').textContent = totalQuota;

    document.getElementById('tab-count-all').textContent = total;
    document.getElementById('tab-count-active').textContent = active;
    document.getElementById('tab-count-cooling').textContent = cooling;
    document.getElementById('tab-count-expired').textContent = expired;
}

// ============ 表格渲染 ============
function renderTable() {
    const searchTerm = document.getElementById('search-input')?.value?.toLowerCase() || '';
    const poolFilter = document.getElementById('pool-filter').value;

    let filtered = allTokens;

    if (currentFilter === 'active') {
        filtered = filtered.filter(t => t.status === 'active');
    } else if (currentFilter === 'cooling') {
        filtered = filtered.filter(t => t.status === 'cooling');
    } else if (currentFilter === 'expired') {
        filtered = filtered.filter(t => t.status === 'expired');
    }

    if (poolFilter !== 'all') {
        filtered = filtered.filter(t => t.pool === poolFilter);
    }

    if (searchTerm) {
        filtered = filtered.filter(t =>
            (t.token && t.token.toLowerCase().includes(searchTerm)) ||
            (t.note && t.note.toLowerCase().includes(searchTerm)) ||
            (t.pool && t.pool.toLowerCase().includes(searchTerm))
        );
    }

    const tbody = document.getElementById('token-tbody');
    const emptyState = document.getElementById('empty-state');
    const tableContainer = document.querySelector('.table-container');

    document.getElementById('displayed-count').textContent = filtered.length;

    if (filtered.length === 0) {
        tbody.innerHTML = '';
        if (tableContainer) tableContainer.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (tableContainer) tableContainer.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';

    tbody.innerHTML = filtered.map(t => {
        const tokenShort = t.token ? (t.token.substring(0, 12) + '...' + t.token.substring(t.token.length - 6)) : '-';
        const statusClass = getStatusClass(t.status);
        const statusLabel = getStatusLabel(t.status);
        const lastUsed = t.lastUsedAt ? formatDateTime(t.lastUsedAt) : '-';
        const poolLabel = t.pool === 'ssoSuper'
            ? '<span class="status-badge info">Super</span>'
            : '<span class="status-badge">Basic</span>';

        return `<tr data-id="${t.id}">
            <td>${t.id}</td>
            <td><code title="${escapeHtml(t.token)}">${escapeHtml(tokenShort)}</code></td>
            <td>${poolLabel}</td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td><strong>${t.quota}</strong></td>
            <td>${t.useCount || 0}</td>
            <td>${t.failCount || 0}</td>
            <td>${lastUsed}</td>
            <td>${escapeHtml(t.note || '')}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-icon-sm danger" onclick="deleteToken(${t.id}, '${escapeHtml(t.token).replace(/'/g, "\\'")}')" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function getStatusClass(status) {
    switch (status) {
        case 'active': return 'success';
        case 'cooling': return 'warning';
        case 'expired': return 'error';
        case 'disabled': return 'error';
        default: return '';
    }
}

function getStatusLabel(status) {
    switch (status) {
        case 'active': return '活跃';
        case 'cooling': return '冷却中';
        case 'expired': return '已过期';
        case 'disabled': return '已禁用';
        default: return status;
    }
}

// ============ 事件绑定 ============
function bindEvents() {
    // 搜索
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => renderTable());
    }

    // 筛选标签
    document.querySelectorAll('.header-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.header-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderTable();
        });
    });

    // 池筛选
    document.getElementById('pool-filter')?.addEventListener('change', renderTable);

    // 添加 Token 按钮
    document.getElementById('add-token-btn')?.addEventListener('click', openAddModal);

    // 批量导入按钮
    document.getElementById('batch-import-btn')?.addEventListener('click', openBatchModal);

    // 添加 Modal
    document.getElementById('modal-close')?.addEventListener('click', closeAddModal);
    document.getElementById('modal-cancel')?.addEventListener('click', closeAddModal);
    document.getElementById('modal-submit')?.addEventListener('click', submitAddToken);

    // 批量导入 Modal
    document.getElementById('batch-modal-close')?.addEventListener('click', closeBatchModal);
    document.getElementById('batch-modal-cancel')?.addEventListener('click', closeBatchModal);
    document.getElementById('batch-modal-submit')?.addEventListener('click', submitBatchImport);

    // 点击 overlay 关闭 modal
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        });
    });
}

// ============ 添加 Token Modal ============
function openAddModal() {
    document.getElementById('add-modal').classList.add('active');
    document.getElementById('input-token').value = '';
    document.getElementById('input-pool').value = 'ssoBasic';
    document.getElementById('input-note').value = '';
}

function closeAddModal() {
    document.getElementById('add-modal').classList.remove('active');
}

async function submitAddToken() {
    const rawInput = document.getElementById('input-token').value.trim();
    const pool = document.getElementById('input-pool').value;
    let note = document.getElementById('input-note').value.trim();

    if (!rawInput) {
        showToast('请输入 Token', 'error');
        return;
    }

    // 支持 email:password:jwt 格式
    const parsed = parseTokenLine(rawInput);
    const token = parsed.token;
    if (!note && parsed.name) {
        note = parsed.name;
    }

    try {
        const res = await fetch('/api/grok/tokens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ token, pool, note })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Token 添加成功', 'success');
            closeAddModal();
            await loadTokens();
        } else {
            showToast('添加失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (e) {
        console.error('Add token error:', e);
        showToast('添加 Token 失败', 'error');
    }
}

// ============ 批量导入 Modal ============
function openBatchModal() {
    document.getElementById('batch-import-modal').classList.add('active');
    document.getElementById('batch-tokens').value = '';
    document.getElementById('batch-pool').value = 'ssoBasic';
}

function closeBatchModal() {
    document.getElementById('batch-import-modal').classList.remove('active');
}

async function submitBatchImport() {
    const text = document.getElementById('batch-tokens').value.trim();
    const pool = document.getElementById('batch-pool').value;

    if (!text) {
        showToast('请输入 Token 列表', 'error');
        return;
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
        showToast('请输入有效的 Token', 'error');
        return;
    }

    // 解析每行，支持 email:password:jwt 格式
    const tokens = lines.map(line => {
        const parsed = parseTokenLine(line);
        return { token: parsed.token, note: parsed.name || '' };
    });

    try {
        const res = await fetch('/api/grok/tokens/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ tokens, pool })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`成功导入 ${data.added}/${data.total} 个 Token`, 'success');
            closeBatchModal();
            await loadTokens();
        } else {
            showToast('导入失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (e) {
        console.error('Batch import error:', e);
        showToast('批量导入失败', 'error');
    }
}

// ============ 删除 Token ============
async function deleteToken(id, token) {
    if (!confirm('确定删除此 Token？')) {
        return;
    }

    try {
        const res = await fetch(`/api/grok/tokens/${encodeURIComponent(token)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (data.success) {
            showToast('删除成功', 'success');
            await loadTokens();
        } else {
            showToast('删除失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (e) {
        console.error('Delete token error:', e);
        showToast('删除 Token 失败', 'error');
    }
}

// ============ 工具函数 ============

/**
 * 解析 Token 行，支持多种格式：
 * - 纯 token: eyJ0eXAi...
 * - sso= 前缀: sso=eyJ0eXAi...
 * - email:password:jwt 格式: user@example.com:pass123:eyJ0eXAi...
 * 返回 { token, name }
 */
function parseTokenLine(line) {
    if (!line) return { token: '', name: '' };
    line = line.trim();

    // 检查是否包含 @ 符号（email 格式）
    if (line.includes('@') && line.includes(':')) {
        const parts = line.split(':');
        // email:password:jwt 格式（JWT 中也会有 . 但不会有 : ，而 JWT base64 部分用 . 分隔）
        // 找到最后一个看起来像 JWT（eyJ 开头）的部分
        let jwtIndex = -1;
        for (let i = 0; i < parts.length; i++) {
            if (parts[i].startsWith('eyJ')) {
                jwtIndex = i;
                break;
            }
        }

        if (jwtIndex > 0) {
            // JWT 可能被 : 分割了（虽然标准 JWT 不会），保险起见拼接后面所有
            const name = parts.slice(0, jwtIndex).join(':');
            const token = parts.slice(jwtIndex).join(':');
            return { token, name: parts[0] }; // name 用 email 部分
        }

        // 如果没找到 eyJ 开头的部分，尝试用最后一段作为 token
        if (parts.length >= 3) {
            return { token: parts[parts.length - 1], name: parts[0] };
        }
    }

    // sso= 前缀
    if (line.startsWith('sso=')) {
        return { token: line.substring(4), name: '' };
    }

    // 纯 token
    return { token: line, name: '' };
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '-';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
