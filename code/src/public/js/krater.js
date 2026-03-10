/**
 * Krater API Key 管理页面 JS
 */

let allKeys = [];
let currentFilter = 'all';

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', async () => {
    if (!await checkAuth()) return;

    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = getSidebarHTML();
        initSidebar('krater');
        updateSidebarStats();
    }

    await loadKeys();
    bindEvents();
});

// ============ 数据加载 ============
async function loadKeys() {
    try {
        const res = await fetch('/api/krater/keys', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();

        allKeys = data.keys || [];
        const stats = data.stats || {};

        updateStats(allKeys, stats);
        renderTable();
    } catch (e) {
        console.error('加载 Krater Key 失败:', e);
        showToast('加载失败: ' + e.message, 'error');
    }
}

function updateStats(keys, memStats) {
    const total = keys.length;
    const active = keys.filter(k => k.status === 'active').length;
    const disabled = keys.filter(k => k.status === 'disabled').length;
    const expired = keys.filter(k => k.status === 'expired').length;
    const totalUse = keys.reduce((sum, k) => sum + (k.useCount || 0), 0);

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-disabled').textContent = disabled;
    document.getElementById('stat-expired').textContent = expired;
    document.getElementById('stat-use-count').textContent = totalUse;

    document.getElementById('tab-count-all').textContent = total;
    document.getElementById('tab-count-active').textContent = active;
    document.getElementById('tab-count-disabled').textContent = disabled;
    document.getElementById('tab-count-expired').textContent = expired;
}

// ============ 表格渲染 ============
function renderTable() {
    const searchTerm = document.getElementById('search-input')?.value?.toLowerCase() || '';

    let filtered = allKeys;

    if (currentFilter !== 'all') {
        filtered = filtered.filter(k => k.status === currentFilter);
    }

    if (searchTerm) {
        filtered = filtered.filter(k =>
            (k.apiKey && k.apiKey.toLowerCase().includes(searchTerm)) ||
            (k.note && k.note.toLowerCase().includes(searchTerm))
        );
    }

    const tbody = document.getElementById('key-tbody');
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

    tbody.innerHTML = filtered.map(k => {
        const keyShort = k.apiKey ? (k.apiKey.substring(0, 15) + '...' + k.apiKey.substring(k.apiKey.length - 4)) : '-';
        const statusClass = getStatusClass(k.status);
        const statusLabel = getStatusLabel(k.status);
        const lastUsed = k.lastUsedAt ? formatDateTime(k.lastUsedAt) : '-';

        const toggleBtn = k.status === 'active'
            ? `<button class="btn-icon-sm warning" onclick="toggleKeyStatus(${k.id}, 'disabled')" title="禁用">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                    </svg>
               </button>`
            : `<button class="btn-icon-sm success" onclick="toggleKeyStatus(${k.id}, 'active')" title="启用">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
               </button>`;

        return `<tr data-id="${k.id}">
            <td>${k.id}</td>
            <td><code title="${escapeHtml(k.apiKey)}">${escapeHtml(keyShort)}</code></td>
            <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
            <td>${k.useCount || 0}</td>
            <td>${k.failCount || 0}</td>
            <td>${lastUsed}</td>
            <td>${escapeHtml(k.note || '')}</td>
            <td>
                <div class="action-buttons">
                    ${toggleBtn}
                    <button class="btn-icon-sm danger" onclick="deleteKey(${k.id})" title="删除">
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
        case 'disabled': return 'warning';
        case 'expired': return 'error';
        default: return '';
    }
}

function getStatusLabel(status) {
    switch (status) {
        case 'active': return '活跃';
        case 'cooling': return '冷却中';
        case 'disabled': return '已禁用';
        case 'expired': return '已过期';
        default: return status;
    }
}

// ============ 事件绑定 ============
function bindEvents() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => renderTable());
    }

    document.querySelectorAll('.header-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.header-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            renderTable();
        });
    });

    document.getElementById('add-key-btn')?.addEventListener('click', openAddModal);
    document.getElementById('batch-import-btn')?.addEventListener('click', openBatchModal);

    document.getElementById('modal-close')?.addEventListener('click', closeAddModal);
    document.getElementById('modal-cancel')?.addEventListener('click', closeAddModal);
    document.getElementById('modal-submit')?.addEventListener('click', submitAddKey);

    document.getElementById('batch-modal-close')?.addEventListener('click', closeBatchModal);
    document.getElementById('batch-modal-cancel')?.addEventListener('click', closeBatchModal);
    document.getElementById('batch-modal-submit')?.addEventListener('click', submitBatchImport);

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        });
    });
}

// ============ 添加 Key Modal ============
function openAddModal() {
    document.getElementById('add-modal').classList.add('active');
    document.getElementById('input-key').value = '';
    document.getElementById('input-note').value = '';
}

function closeAddModal() {
    document.getElementById('add-modal').classList.remove('active');
}

async function submitAddKey() {
    const apiKey = document.getElementById('input-key').value.trim();
    const note = document.getElementById('input-note').value.trim();

    if (!apiKey) {
        showToast('请输入 API Key', 'error');
        return;
    }

    try {
        const res = await fetch('/api/krater/keys', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ apiKey, note })
        });
        const data = await res.json();
        if (data.success) {
            showToast('Key 添加成功', 'success');
            closeAddModal();
            await loadKeys();
        } else {
            showToast('添加失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (e) {
        console.error('Add key error:', e);
        showToast('添加 Key 失败', 'error');
    }
}

// ============ 批量导入 Modal ============
function openBatchModal() {
    document.getElementById('batch-import-modal').classList.add('active');
    document.getElementById('batch-keys').value = '';
}

function closeBatchModal() {
    document.getElementById('batch-import-modal').classList.remove('active');
}

async function submitBatchImport() {
    const text = document.getElementById('batch-keys').value.trim();

    if (!text) {
        showToast('请输入 Key 列表', 'error');
        return;
    }

    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) {
        showToast('请输入有效的 Key', 'error');
        return;
    }

    const keys = lines.map(line => line);

    try {
        const res = await fetch('/api/krater/keys/batch', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ keys })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`成功导入 ${data.added}/${data.total} 个 Key`, 'success');
            closeBatchModal();
            await loadKeys();
        } else {
            showToast('导入失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (e) {
        console.error('Batch import error:', e);
        showToast('批量导入失败', 'error');
    }
}

// ============ 删除 Key ============
async function deleteKey(id) {
    if (!confirm('确定删除此 API Key？')) {
        return;
    }

    try {
        const res = await fetch(`/api/krater/keys/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await res.json();
        if (data.success) {
            showToast('删除成功', 'success');
            await loadKeys();
        } else {
            showToast('删除失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (e) {
        console.error('Delete key error:', e);
        showToast('删除 Key 失败', 'error');
    }
}

// ============ 切换状态 ============
async function toggleKeyStatus(id, newStatus) {
    try {
        const res = await fetch(`/api/krater/keys/${id}/status`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ status: newStatus })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`已${newStatus === 'active' ? '启用' : '禁用'}`, 'success');
            await loadKeys();
        } else {
            showToast('操作失败: ' + (data.error || '未知错误'), 'error');
        }
    } catch (e) {
        console.error('Toggle status error:', e);
        showToast('操作失败', 'error');
    }
}

// ============ 工具函数 ============
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
