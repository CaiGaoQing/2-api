// 满血号池管理
let credentials = [];
let filteredCredentials = [];
let currentFilter = 'all';
let selectedIds = new Set();
let editingId = null;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    if (!await checkAuth()) return;

    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('full-accounts');

    await loadSiteSettings();
    await loadCredentials();

    bindEvents();
    updateSidebarStats();
});

// 加载凭证列表
async function loadCredentials() {
    try {
        const res = await fetch('/api/full-accounts', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();
        if (result.success) {
            credentials = result.data || [];
            applyFilter();
        }
    } catch (e) {
        console.error('Load credentials error:', e);
        showToast('加载凭证失败', 'error');
    }
}

// 应用筛选
function applyFilter() {
    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    filteredCredentials = credentials.filter(c => {
        const matchType = currentFilter === 'all' || c.type === currentFilter;
        const matchSearch = !searchTerm ||
            c.name.toLowerCase().includes(searchTerm) ||
            (c.remark && c.remark.toLowerCase().includes(searchTerm));
        return matchType && matchSearch;
    });

    renderTable();
    updateStats();
}

// 渲染表格
function renderTable() {
    const tbody = document.getElementById('accounts-tbody');
    const emptyState = document.getElementById('empty-state');
    const tableContainer = document.querySelector('.table-container');

    if (filteredCredentials.length === 0) {
        tbody.innerHTML = '';
        tableContainer.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    tableContainer.style.display = 'block';
    emptyState.style.display = 'none';

    tbody.innerHTML = filteredCredentials.map(c => `
        <tr data-id="${c.id}" class="${selectedIds.has(c.id) ? 'selected' : ''}">
            <td><input type="checkbox" class="checkbox-custom row-checkbox" ${selectedIds.has(c.id) ? 'checked' : ''}></td>
            <td><span class="credential-name">${escapeHtml(c.name)}</span></td>
            <td><span class="type-badge type-${c.type}">${getTypeName(c.type)}</span></td>
            <td><span class="credential-info">${getCredentialPreview(c)}</span></td>
            <td><span class="region-text">${getRegion(c) || '-'}</span></td>
            <td>${formatDateTime(c.createdAt)}</td>
            <td><span class="status-badge ${c.isActive ? 'active' : 'inactive'}">${c.isActive ? '启用' : '禁用'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn-icon-action" onclick="editCredential(${c.id})" title="编辑">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="btn-icon-action danger" onclick="deleteCredential(${c.id})" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    document.getElementById('displayed-count').textContent = filteredCredentials.length;
}

// 更新统计
function updateStats() {
    const total = credentials.length;
    const active = credentials.filter(c => c.isActive).length;
    const inactive = credentials.filter(c => !c.isActive).length;
    const digitalocean = credentials.filter(c => c.type === 'digitalocean').length;
    const aws = credentials.filter(c => c.type === 'aws').length;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-inactive').textContent = inactive;
    document.getElementById('stat-digitalocean').textContent = digitalocean;
    document.getElementById('stat-aws').textContent = aws;

    // 更新 tab 数量
    const tabCounts = {
        all: total,
        digitalocean: digitalocean,
        aws: aws,
        gcp: credentials.filter(c => c.type === 'gcp').length,
        azure: credentials.filter(c => c.type === 'azure').length,
        other: credentials.filter(c => c.type === 'other').length
    };

    Object.keys(tabCounts).forEach(key => {
        const el = document.getElementById(`tab-count-${key}`);
        if (el) el.textContent = tabCounts[key];
    });
}

// 获取类型名称
function getTypeName(type) {
    const names = {
        'digitalocean': '数字海洋',
        'aws': 'AWS',
        'gcp': 'GCP',
        'azure': 'Azure',
        'other': '其他'
    };
    return names[type] || type;
}

// 获取凭证预览
function getCredentialPreview(c) {
    switch (c.type) {
        case 'digitalocean':
            return c.credentials?.token ? maskString(c.credentials.token) : '-';
        case 'aws':
            return c.credentials?.accessKey ? `AK: ${maskString(c.credentials.accessKey)}` : '-';
        case 'gcp':
            return c.credentials?.projectId || 'Service Account';
        case 'azure':
            return c.credentials?.tenantId ? `Tenant: ${maskString(c.credentials.tenantId)}` : '-';
        case 'other':
            return c.credentials?.url ? new URL(c.credentials.url).hostname : '-';
        default:
            return '-';
    }
}

// 获取区域
function getRegion(c) {
    switch (c.type) {
        case 'aws':
            return c.credentials?.region || '-';
        case 'digitalocean':
            return 'Global';
        case 'gcp':
            return c.credentials?.region || 'Global';
        case 'azure':
            return c.credentials?.region || 'Global';
        default:
            return '-';
    }
}

// 遮罩字符串
function maskString(str, showChars = 4) {
    if (!str || str.length <= showChars * 2) return '****';
    return str.substring(0, showChars) + '****' + str.substring(str.length - showChars);
}

// 转义 HTML
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// 绑定事件
function bindEvents() {
    // 添加按钮
    document.getElementById('add-account-btn').addEventListener('click', () => openModal());

    // 搜索
    document.getElementById('search-input').addEventListener('input', applyFilter);

    // 筛选标签
    document.querySelectorAll('.header-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.header-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentFilter = tab.dataset.filter;
            applyFilter();
        });
    });

    // 类型切换
    document.getElementById('credential-type').addEventListener('change', (e) => {
        document.querySelectorAll('.credential-fields').forEach(f => f.style.display = 'none');
        document.getElementById(`fields-${e.target.value}`).style.display = 'block';
    });

    // 模态框
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-submit').addEventListener('click', saveCredential);
    document.getElementById('add-modal').addEventListener('click', (e) => {
        if (e.target.id === 'add-modal') closeModal();
    });

    // 全选
    document.getElementById('select-all').addEventListener('change', toggleSelectAll);
    document.getElementById('table-select-all').addEventListener('change', toggleSelectAll);

    // 行选择
    document.getElementById('accounts-tbody').addEventListener('change', (e) => {
        if (e.target.classList.contains('row-checkbox')) {
            const row = e.target.closest('tr');
            const id = parseInt(row.dataset.id);
            if (e.target.checked) {
                selectedIds.add(id);
                row.classList.add('selected');
            } else {
                selectedIds.delete(id);
                row.classList.remove('selected');
            }
            updateBatchButtons();
        }
    });

    // 右键菜单
    document.getElementById('accounts-tbody').addEventListener('contextmenu', (e) => {
        const row = e.target.closest('tr');
        if (row) {
            e.preventDefault();
            showContextMenu(e, parseInt(row.dataset.id));
        }
    });

    // 批量删除
    document.getElementById('batch-delete-btn').addEventListener('click', batchDelete);

    // 批量测试
    document.getElementById('refresh-all-btn').addEventListener('click', batchTestCredentials);

    // 空状态添加按钮
    const emptyAddBtn = document.getElementById('empty-add-btn');
    if (emptyAddBtn) {
        emptyAddBtn.addEventListener('click', () => openModal());
    }

    // 模型映射按钮
    document.getElementById('model-mapping-btn').addEventListener('click', openMappingModal);

    // 模型列表模态框
    document.getElementById('models-modal-close').addEventListener('click', () => {
        document.getElementById('models-modal').classList.remove('active');
    });
    document.getElementById('models-modal-cancel').addEventListener('click', () => {
        document.getElementById('models-modal').classList.remove('active');
    });
    document.getElementById('models-modal').addEventListener('click', (e) => {
        if (e.target.id === 'models-modal') {
            document.getElementById('models-modal').classList.remove('active');
        }
    });

    // 模型映射模态框
    document.getElementById('mapping-modal-close').addEventListener('click', () => {
        document.getElementById('mapping-modal').classList.remove('active');
    });
    document.getElementById('mapping-modal-cancel').addEventListener('click', () => {
        document.getElementById('mapping-modal').classList.remove('active');
    });
    document.getElementById('mapping-modal').addEventListener('click', (e) => {
        if (e.target.id === 'mapping-modal') {
            document.getElementById('mapping-modal').classList.remove('active');
        }
    });
    document.getElementById('add-mapping-btn').addEventListener('click', addMapping);

    // 关闭右键菜单
    document.addEventListener('click', () => {
        document.getElementById('context-menu').style.display = 'none';
    });
}

// 打开模态框
function openModal(id = null) {
    editingId = id;
    const modal = document.getElementById('add-modal');
    const title = document.getElementById('modal-title');

    if (id) {
        title.textContent = '编辑凭证';
        const c = credentials.find(x => x.id === id);
        if (c) {
            document.getElementById('credential-type').value = c.type;
            document.getElementById('credential-name').value = c.name;
            document.getElementById('credential-remark').value = c.remark || '';

            // 切换字段显示
            document.querySelectorAll('.credential-fields').forEach(f => f.style.display = 'none');
            document.getElementById(`fields-${c.type}`).style.display = 'block';

            // 填充凭证字段
            fillCredentialFields(c);
        }
    } else {
        title.textContent = '添加凭证';
        document.getElementById('add-form').reset();
        document.querySelectorAll('.credential-fields').forEach(f => f.style.display = 'none');
        document.getElementById('fields-digitalocean').style.display = 'block';
    }

    modal.classList.add('active');
}

// 填充凭证字段
function fillCredentialFields(c) {
    const creds = c.credentials || {};
    switch (c.type) {
        case 'digitalocean':
            document.getElementById('do-token').value = creds.token || '';
            break;
        case 'aws':
            document.getElementById('aws-access-key').value = creds.accessKey || '';
            document.getElementById('aws-secret-key').value = creds.secretKey || '';
            document.getElementById('aws-region').value = creds.region || 'us-east-1';
            break;
        case 'gcp':
            document.getElementById('gcp-json').value = creds.serviceAccount ? JSON.stringify(creds.serviceAccount, null, 2) : '';
            break;
        case 'azure':
            document.getElementById('azure-tenant').value = creds.tenantId || '';
            document.getElementById('azure-client').value = creds.clientId || '';
            document.getElementById('azure-secret').value = creds.clientSecret || '';
            break;
        case 'other':
            document.getElementById('other-url').value = creds.url || '';
            document.getElementById('other-key').value = creds.apiKey || '';
            break;
    }
}

// 关闭模态框
function closeModal() {
    document.getElementById('add-modal').classList.remove('active');
    editingId = null;
}

// 保存凭证
async function saveCredential() {
    const type = document.getElementById('credential-type').value;
    const name = document.getElementById('credential-name').value.trim();
    const remark = document.getElementById('credential-remark').value.trim();

    if (!name) {
        showToast('请输入凭证名称', 'error');
        return;
    }

    const credentialData = getCredentialData(type);
    if (!credentialData) return;

    const data = { type, name, remark, credentials: credentialData };

    try {
        const url = editingId ? `/api/full-accounts/${editingId}` : '/api/full-accounts';
        const method = editingId ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        const result = await res.json();
        if (result.success) {
            showToast(editingId ? '凭证已更新' : '凭证已添加', 'success');
            closeModal();
            await loadCredentials();
        } else {
            showToast(result.message || '操作失败', 'error');
        }
    } catch (e) {
        console.error('Save error:', e);
        showToast('保存失败', 'error');
    }
}

// 获取凭证数据
function getCredentialData(type) {
    switch (type) {
        case 'digitalocean': {
            const token = document.getElementById('do-token').value.trim();
            if (!token) { showToast('请输入 API Token', 'error'); return null; }
            return { token };
        }
        case 'aws': {
            const accessKey = document.getElementById('aws-access-key').value.trim();
            const secretKey = document.getElementById('aws-secret-key').value.trim();
            const region = document.getElementById('aws-region').value;
            if (!accessKey || !secretKey) { showToast('请输入 AWS 凭证', 'error'); return null; }
            return { accessKey, secretKey, region };
        }
        case 'gcp': {
            const jsonStr = document.getElementById('gcp-json').value.trim();
            if (!jsonStr) { showToast('请输入 Service Account JSON', 'error'); return null; }
            try {
                const serviceAccount = JSON.parse(jsonStr);
                return { serviceAccount, projectId: serviceAccount.project_id };
            } catch (e) {
                showToast('JSON 格式错误', 'error');
                return null;
            }
        }
        case 'azure': {
            const tenantId = document.getElementById('azure-tenant').value.trim();
            const clientId = document.getElementById('azure-client').value.trim();
            const clientSecret = document.getElementById('azure-secret').value.trim();
            if (!tenantId || !clientId || !clientSecret) { showToast('请输入 Azure 凭证', 'error'); return null; }
            return { tenantId, clientId, clientSecret };
        }
        case 'other': {
            const url = document.getElementById('other-url').value.trim();
            const apiKey = document.getElementById('other-key').value.trim();
            if (!url || !apiKey) { showToast('请输入 URL 和 API Key', 'error'); return null; }
            return { url, apiKey };
        }
        default:
            return null;
    }
}

// 编辑凭证
function editCredential(id) {
    openModal(id);
}

// 删除凭证
async function deleteCredential(id) {
    if (!confirm('确定要删除此凭证吗？')) return;

    try {
        const res = await fetch(`/api/full-accounts/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();
        if (result.success) {
            showToast('凭证已删除', 'success');
            await loadCredentials();
        } else {
            showToast(result.message || '删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败', 'error');
    }
}

// 全选切换
function toggleSelectAll(e) {
    const checked = e.target.checked;
    document.getElementById('select-all').checked = checked;
    document.getElementById('table-select-all').checked = checked;

    selectedIds.clear();
    if (checked) {
        filteredCredentials.forEach(c => selectedIds.add(c.id));
    }

    document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = checked);
    document.querySelectorAll('#accounts-tbody tr').forEach(row => {
        row.classList.toggle('selected', checked);
    });

    updateBatchButtons();
}

// 更新批量按钮
function updateBatchButtons() {
    const batchBtn = document.getElementById('batch-delete-btn');
    batchBtn.style.display = selectedIds.size > 0 ? 'inline-flex' : 'none';
}

// 批量删除
async function batchDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 个凭证吗？`)) return;

    try {
        const res = await fetch('/api/full-accounts/batch-delete', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids: Array.from(selectedIds) })
        });
        const result = await res.json();
        if (result.success) {
            showToast(`已删除 ${selectedIds.size} 个凭证`, 'success');
            selectedIds.clear();
            updateBatchButtons();
            await loadCredentials();
        } else {
            showToast(result.message || '批量删除失败', 'error');
        }
    } catch (e) {
        showToast('批量删除失败', 'error');
    }
}

// 显示右键菜单
function showContextMenu(e, id) {
    const menu = document.getElementById('context-menu');
    menu.style.display = 'block';
    menu.style.left = e.pageX + 'px';
    menu.style.top = e.pageY + 'px';
    menu.dataset.id = id;

    // 绑定菜单项事件
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.onclick = () => {
            const action = item.dataset.action;
            const targetId = parseInt(menu.dataset.id);
            menu.style.display = 'none';

            switch (action) {
                case 'edit': editCredential(targetId); break;
                case 'test': testCredential(targetId); break;
                case 'models': showModels(targetId); break;
                case 'toggle': toggleCredential(targetId); break;
                case 'delete': deleteCredential(targetId); break;
            }
        };
    });
}

// 测试凭证连接
async function testCredential(id) {
    const c = credentials.find(x => x.id === id);
    if (!c) return;

    showToast('正在测试连接...', 'info');

    try {
        const res = await fetch(`/api/full-accounts/${id}/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();
        if (result.success) {
            showToast(`连接成功！${result.message || ''}`, 'success');
        } else {
            showToast(result.message || '连接失败', 'error');
        }
    } catch (e) {
        console.error('Test error:', e);
        showToast('测试失败', 'error');
    }
}

// 批量测试凭证
async function batchTestCredentials() {
    const toTest = selectedIds.size > 0 ? Array.from(selectedIds) : filteredCredentials.map(c => c.id);

    if (toTest.length === 0) {
        showToast('没有可测试的凭证', 'warning');
        return;
    }

    showToast(`正在测试 ${toTest.length} 个凭证...`, 'info');

    try {
        const res = await fetch('/api/full-accounts/batch-test', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ids: toTest })
        });
        const result = await res.json();
        if (result.success) {
            const { passed, failed } = result.data || {};
            showToast(`测试完成：${passed || 0} 成功，${failed || 0} 失败`, passed > 0 ? 'success' : 'warning');
            await loadCredentials();
        } else {
            showToast(result.message || '批量测试失败', 'error');
        }
    } catch (e) {
        console.error('Batch test error:', e);
        showToast('批量测试失败', 'error');
    }
}

// 切换启用状态
async function toggleCredential(id) {
    try {
        const res = await fetch(`/api/full-accounts/${id}/toggle`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();
        if (result.success) {
            showToast('状态已更新', 'success');
            await loadCredentials();
        } else {
            showToast(result.message || '操作失败', 'error');
        }
    } catch (e) {
        showToast('操作失败', 'error');
    }
}

// ============ 模型相关功能 ============

let availableModels = [];
let modelMappings = [];

// 显示凭证的模型列表
function showModels(id) {
    const c = credentials.find(x => x.id === id);
    if (!c) return;

    const modal = document.getElementById('models-modal');
    const list = document.getElementById('models-list');
    const count = document.getElementById('models-count');
    const searchInput = document.getElementById('models-search-input');

    const models = c.models || [];

    if (models.length === 0) {
        list.innerHTML = '<p class="empty-text">暂无模型数据，请先测试凭证连接</p>';
        count.textContent = '共 0 个模型';
    } else {
        renderModelsList(models, '');
        count.textContent = `共 ${models.length} 个模型`;
    }

    searchInput.value = '';
    searchInput.oninput = () => renderModelsList(models, searchInput.value.toLowerCase());

    modal.classList.add('active');
}

// 渲染模型列表
function renderModelsList(models, searchTerm) {
    const list = document.getElementById('models-list');
    const filtered = models.filter(m =>
        m.id.toLowerCase().includes(searchTerm) ||
        (m.ownedBy && m.ownedBy.toLowerCase().includes(searchTerm))
    );

    if (filtered.length === 0) {
        list.innerHTML = '<p class="empty-text">没有匹配的模型</p>';
        return;
    }

    list.innerHTML = `
        <div class="models-grid">
            ${filtered.map(m => `
                <div class="model-card">
                    <div class="model-id">${escapeHtml(m.id)}</div>
                    <div class="model-meta">
                        <span class="model-owner">${escapeHtml(m.ownedBy || 'unknown')}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// 打开模型映射配置
async function openMappingModal() {
    const modal = document.getElementById('mapping-modal');

    // 加载可用模型
    await loadAvailableModels();

    // 加载现有映射
    await loadModelMappings();

    // 填充目标模型下拉框
    const targetSelect = document.getElementById('mapping-target');
    targetSelect.innerHTML = '<option value="">选择目标模型...</option>' +
        availableModels.map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.id)}</option>`).join('');

    modal.classList.add('active');
}

// 加载可用模型
async function loadAvailableModels() {
    try {
        const res = await fetch('/api/available-models', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();
        if (result.success) {
            availableModels = result.data || [];
        }
    } catch (e) {
        console.error('Load models error:', e);
    }
}

// 加载模型映射
async function loadModelMappings() {
    try {
        const res = await fetch('/api/model-mappings', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();
        if (result.success) {
            modelMappings = result.data || [];
            renderMappingsTable();
        }
    } catch (e) {
        console.error('Load mappings error:', e);
    }
}

// 渲染映射表格
function renderMappingsTable() {
    const tbody = document.getElementById('mappings-tbody');

    if (modelMappings.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-text">暂无映射配置</td></tr>';
        return;
    }

    tbody.innerHTML = modelMappings.map(m => `
        <tr data-id="${m.id}">
            <td><code>${escapeHtml(m.sourceModel)}</code></td>
            <td><code>${escapeHtml(m.targetModel)}</code></td>
            <td>${escapeHtml(m.provider)}</td>
            <td>${m.priority}</td>
            <td><span class="status-badge ${m.isActive ? 'active' : 'inactive'}">${m.isActive ? '启用' : '禁用'}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn-icon-action" onclick="toggleMapping(${m.id})" title="切换状态">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                    </button>
                    <button class="btn-icon-action danger" onclick="deleteMapping(${m.id})" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

// 添加映射
async function addMapping() {
    const sourceModel = document.getElementById('mapping-source').value.trim();
    const targetModel = document.getElementById('mapping-target').value;
    const priority = parseInt(document.getElementById('mapping-priority').value) || 0;

    if (!sourceModel || !targetModel) {
        showToast('请填写源模型和目标模型', 'error');
        return;
    }

    try {
        const res = await fetch('/api/model-mappings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ sourceModel, targetModel, provider: 'digitalocean', priority })
        });
        const result = await res.json();
        if (result.success) {
            showToast('映射已添加', 'success');
            document.getElementById('mapping-source').value = '';
            document.getElementById('mapping-priority').value = '0';
            await loadModelMappings();
        } else {
            showToast(result.error || '添加失败', 'error');
        }
    } catch (e) {
        showToast('添加失败', 'error');
    }
}

// 切换映射状态
async function toggleMapping(id) {
    const mapping = modelMappings.find(m => m.id === id);
    if (!mapping) return;

    try {
        const res = await fetch(`/api/model-mappings/${id}`, {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ isActive: !mapping.isActive })
        });
        const result = await res.json();
        if (result.success) {
            showToast('状态已更新', 'success');
            await loadModelMappings();
        } else {
            showToast(result.error || '更新失败', 'error');
        }
    } catch (e) {
        showToast('更新失败', 'error');
    }
}

// 删除映射
async function deleteMapping(id) {
    if (!confirm('确定要删除此映射吗？')) return;

    try {
        const res = await fetch(`/api/model-mappings/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();
        if (result.success) {
            showToast('映射已删除', 'success');
            await loadModelMappings();
        } else {
            showToast(result.error || '删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败', 'error');
    }
}
