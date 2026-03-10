/**
 * Amazon Bedrock 账号管理页面 JavaScript
 */

let credentials = [];
let selectedIds = new Set();
let currentContextId = null;
let currentEditId = null;

// HTML 转义函数
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 初始化侧边栏
    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = getSidebarHTML();
        initSidebar('bedrock');
        updateSidebarStats();
    }

    await loadCredentials();
    await loadStatistics();
    setupEventListeners();
    setupRegionSelector();
});

// 加载凭据列表
async function loadCredentials() {
    try {
        const response = await fetch('/api/bedrock/credentials');
        const result = await response.json();
        credentials = result.success ? result.data : [];
        renderCards();
    } catch (error) {
        showToast('加载凭据失败: ' + error.message, 'error');
    }
}

// 加载统计信息
async function loadStatistics() {
    try {
        const response = await fetch('/api/bedrock/statistics');
        const result = await response.json();
        if (result.success) {
            const stats = result.data;
            document.getElementById('stat-total').textContent = stats.total || 0;

            // 格式化花费金额
            const totalCost = stats.totalCost || 0;
            document.getElementById('stat-cost').textContent = '$' + totalCost.toFixed(4);

            // 格式化 token 数量
            document.getElementById('stat-input-tokens').textContent = formatTokenCount(stats.totalInputTokens || 0);
            document.getElementById('stat-output-tokens').textContent = formatTokenCount(stats.totalOutputTokens || 0);
        }
    } catch (error) {
        console.error('加载统计失败:', error);
    }
}

// 格式化 token 数量（大数字显示为 K/M）
function formatTokenCount(count) {
    if (count >= 1000000) {
        return (count / 1000000).toFixed(2) + 'M';
    } else if (count >= 1000) {
        return (count / 1000).toFixed(1) + 'K';
    }
    return count.toString();
}

// 渲染卡片列表
function renderCards() {
    const grid = document.getElementById('cards-grid');
    const emptyState = document.getElementById('empty-state');
    const displayedCount = document.getElementById('displayed-count');
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    // 过滤
    let filtered = credentials;
    if (searchTerm) {
        filtered = credentials.filter(cred =>
            cred.name.toLowerCase().includes(searchTerm) ||
            (cred.sKeyId && cred.accessKeyId.toLowerCase().includes(searchTerm)) ||
            (cred.region && cred.region.toLowerCase().includes(searchTerm))
        );
    }

    displayedCount.textContent = filtered.length;

    if (filtered.length === 0) {
        grid.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    grid.innerHTML = filtered.map(cred => renderCard(cred)).join('');
}

// 渲染单个卡片
function renderCard(cred) {
    const isSelected = selectedIds.has(cred.id);
    const statusClass = cred.errorCount > 0 ? 'error' : (cred.isActive ? 'active' : 'inactive');
    const statusText = cred.errorCount > 0 ? '异常' : (cred.isActive ? '活跃' : '停用');
    const authTypeText = cred.authType === 'bearer' ? 'Bearer Token' : 'IAM';
    const authDisplay = cred.authType === 'bearer'
        ? (cred.bearerToken || '-')
        : (cred.accessKeyId || '-');

    return `
        <div class="bedrock-card ${isSelected ? 'selected' : ''}" data-id="${cred.id}">
            <div class="card-header">
                <input type="checkbox" class="checkbox-custom card-checkbox"
                    ${isSelected ? 'checked' : ''}
                    onchange="toggleSelect(${cred.id}, this.checked)">
                <div class="card-title-section">
                    <div class="card-title">${escapeHtml(cred.name)}</div>
                    <div class="card-subtitle">${escapeHtml(authDisplay)}</div>
                </div>
                <button class="card-menu-btn" onclick="showContextMenu(event, ${cred.id})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="1"/>
                        <circle cx="12" cy="5" r="1"/>
                        <circle cx="12" cy="19" r="1"/>
                    </svg>
                </button>
            </div>
            <div class="card-body">
                <div class="card-info-row">
                    <span class="card-info-label">认证方式</span>
                    <span class="card-info-value">${escapeHtml(authTypeText)}</span>
                </div>
                <div class="card-info-row">
                    <span class="card-info-label">区域</span>
                    <span class="card-info-value">${escapeHtml(cred.region || 'us-east-1')}</span>
                </div>
                <div class="card-info-row">
                    <span class="card-info-label">花费</span>
                    <span class="card-info-value" style="color: #ff9900; font-weight: 600;">$${(cred.totalCost || 0).toFixed(4)}</span>
                </div>
                <div class="card-info-row">
                    <span class="card-info-label">输入/输出</span>
                    <span class="card-info-value">${formatTokenCount(cred.inputTokens || 0)} / ${formatTokenCount(cred.outputTokens || 0)}</span>
                </div>
                <div class="card-info-row">
                    <span class="card-info-label">使用次数</span>
                    <span class="card-info-value">${cred.useCount || 0}</span>
                </div>
                ${cred.errorCount > 0 ? `
                <div class="card-info-row">
                    <span class="card-info-label">错误</span>
                    <span class="card-info-value error-text">${escapeHtml(cred.lastErrorMessage || '未知错误')}</span>
                </div>
                ` : ''}
            </div>
            <div class="card-footer">
                <span class="card-date">${formatDate(cred.createdAt)}</span>
                <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
        </div>
    `;
}

// 设置事件监听
function setupEventListeners() {
    // 添加账号按钮
    document.getElementById('add-account-btn')?.addEventListener('click', () => openAddModal());
    document.getElementById('empty-add-btn')?.addEventListener('click', () => openAddModal());

    // 模态框
    document.getElementById('modal-close')?.addEventListener('click', closeModal);
    document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
    document.getElementById('modal-submit')?.addEventListener('click', handleSubmit);

    // 点击模态框外部关闭
    document.getElementById('add-modal')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) closeModal();
    });

    // 搜索
    document.getElementById('search-input')?.addEventListener('input', debounce(renderCards, 300));

    // 全选
    document.getElementById('select-all')?.addEventListener('change', (e) => {
        const checkboxes = document.querySelectorAll('.card-checkbox');
        checkboxes.forEach(cb => {
            cb.checked = e.target.checked;
            const id = parseInt(cb.closest('.bedrock-card').dataset.id);
            if (e.target.checked) {
                selectedIds.add(id);
            } else {
                selectedIds.delete(id);
            }
        });
        updateBatchButtons();
        renderCards();
    });

    // 批量删除
    document.getElementById('batch-delete-btn')?.addEventListener('click', handleBatchDelete);

    // 右键菜单
    document.addEventListener('click', () => hideContextMenu());

    // 右键菜单项
    document.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = item.dataset.action;
            handleContextAction(action, currentContextId);
            hideContextMenu();
        });
    });
}

// 设置区域选择器
function setupRegionSelector() {
    const selector = document.getElementById('region-selector');
    if (!selector) return;

    selector.querySelectorAll('.region-option').forEach(option => {
        option.addEventListener('click', () => {
            selector.querySelectorAll('.region-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            document.getElementById('region').value = option.dataset.value;
        });
    });

    // 认证方式选择器
    const authSelector = document.getElementById('auth-type-selector');
    if (authSelector) {
        authSelector.querySelectorAll('.region-option').forEach(option => {
            option.addEventListener('click', () => {
                authSelector.querySelectorAll('.region-option').forEach(o => o.classList.remove('selected'));
                option.classList.add('selected');
                const authType = option.dataset.value;
                document.getElementById('auth-type').value = authType;

                // 切换显示的字段
                document.getElementById('iam-fields').style.display = authType === 'iam' ? 'block' : 'none';
                document.getElementById('bearer-fields').style.display = authType === 'bearer' ? 'block' : 'none';
            });
        });
    }
}

// 打开添加模态框
function openAddModal(editData = null) {
    currentEditId = editData ? editData.id : null;
    const modal = document.getElementById('add-modal');
    const title = document.getElementById('modal-title');
    const submitText = document.getElementById('modal-submit-text');

    if (editData) {
        title.textContent = '编辑 Bedrock 账号';
        submitText.textContent = '保存修改';
        document.getElementById('account-name').value = editData.name || '';

        // 设置认证方式
        const authType = editData.authType || 'iam';
        document.getElementById('auth-type').value = authType;
        document.querySelectorAll('#auth-type-selector .region-option').forEach(o => {
            o.classList.toggle('selected', o.dataset.value === authType);
        });
        document.getElementById('iam-fields').style.display = authType === 'iam' ? 'block' : 'none';
        document.getElementById('bearer-fields').style.display = authType === 'bearer' ? 'block' : 'none';

        // IAM 字段
        document.getElementById('access-key-id').value = editData.accessKeyId?.replace('****', '') || '';
        document.getElementById('secret-access-key').value = '';
        document.getElementById('secret-access-key').placeholder = '留空保持不变';
        document.getElementById('session-token').value = '';

        // Bearer Token 字段
        document.getElementById('bearer-token').value = '';
        document.getElementById('bearer-token').placeholder = '留空保持不变';

        // 设置区域
        const region = editData.region || 'us-east-1';
        document.getElementById('region').value = region;
        document.querySelectorAll('#region-selector .region-option').forEach(o => {
            o.classList.toggle('selected', o.dataset.value === region);
        });
    } else {
        title.textContent = '添加 Bedrock 账号';
        submitText.textContent = '添加账号';
        document.getElementById('add-account-form').reset();

        // 重置认证方式为 IAM
        document.getElementById('auth-type').value = 'iam';
        document.querySelectorAll('#auth-type-selector .region-option').forEach(o => {
            o.classList.toggle('selected', o.dataset.value === 'iam');
        });
        document.getElementById('iam-fields').style.display = 'block';
        document.getElementById('bearer-fields').style.display = 'none';

        document.getElementById('secret-access-key').placeholder = 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
        document.getElementById('bearer-token').placeholder = 'AWS_BEARER_TOKEN_BEDROCK 的值';
        document.getElementById('region').value = 'us-east-1';
        document.querySelectorAll('#region-selector .region-option').forEach(o => {
            o.classList.toggle('selected', o.dataset.value === 'us-east-1');
        });
    }

    modal.classList.add('active');
}

// 关闭模态框
function closeModal() {
    document.getElementById('add-modal')?.classList.remove('active');
    currentEditId = null;
}

// 处理提交
async function handleSubmit() {
    const name = document.getElementById('account-name').value.trim();
    const authType = document.getElementById('auth-type').value;
    const accessKeyId = document.getElementById('access-key-id').value.trim();
    const secretAccessKey = document.getElementById('secret-access-key').value.trim();
    const sessionToken = document.getElementById('session-token').value.trim();
    const bearerToken = document.getElementById('bearer-token').value.trim();
    const region = document.getElementById('region').value;

    if (!name) {
        showToast('请输入账号名称', 'error');
        return;
    }

    // 根据认证方式验证
    if (authType === 'iam') {
        if (!accessKeyId) {
            showToast('请输入 Access Key ID', 'error');
            return;
        }
        if (!currentEditId && !secretAccessKey) {
            showToast('请输入 Secret Access Key', 'error');
            return;
        }
    } else if (authType === 'bearer') {
        if (!currentEditId && !bearerToken) {
            showToast('请输入 Bearer Token', 'error');
            return;
        }
    }

    try {
        const data = { name, region };

        if (authType === 'iam') {
            if (accessKeyId) data.accessKeyId = accessKeyId;
            if (secretAccessKey) data.secretAccessKey = secretAccessKey;
            if (sessionToken) data.sessionToken = sessionToken;
        } else if (authType === 'bearer') {
            if (bearerToken) data.bearerToken = bearerToken;
        }

        let response;
        if (currentEditId) {
            response = await fetch(`/api/bedrock/credentials/${currentEditId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        } else {
            response = await fetch('/api/bedrock/credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
        }

        const result = await response.json();
        if (result.success) {
            showToast(currentEditId ? '更新成功' : '添加成功', 'success');
            closeModal();
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast(result.error || '操作失败', 'error');
        }
    } catch (error) {
        showToast('操作失败: ' + error.message, 'error');
    }
}

// 显示右键菜单
function showContextMenu(event, id) {
    event.stopPropagation();
    currentContextId = id;
    const menu = document.getElementById('context-menu');
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    menu.classList.add('active');
}

// 隐藏右键菜单
function hideContextMenu() {
    document.getElementById('context-menu')?.classList.remove('active');
}

// 处理右键菜单操作
async function handleContextAction(action, id) {
    const cred = credentials.find(c => c.id === id);
    if (!cred) return;

    switch (action) {
        case 'activate':
            await updateCredential(id, { isActive: true });
            break;
        case 'deactivate':
            await updateCredential(id, { isActive: false });
            break;
        case 'test':
            await testCredential(id);
            break;
        case 'edit':
            // 获取完整凭据信息
            const fullCred = credentials.find(c => c.id === id);
            openAddModal(fullCred);
            break;
        case 'delete':
            if (confirm(`确定要删除账号 "${cred.name}" 吗？`)) {
                await deleteCredential(id);
            }
            break;
    }
}

// 更新凭据
async function updateCredential(id, data) {
    try {
        const response = await fetch(`/api/bedrock/credentials/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        if (result.success) {
            showToast('更新成功', 'success');
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast(result.error || '更新失败', 'error');
        }
    } catch (error) {
        showToast('更新失败: ' + error.message, 'error');
    }
}

// 测试凭据
async function testCredential(id) {
    showToast('正在测试连接...', 'info');
    try {
        const response = await fetch(`/api/bedrock/credentials/${id}/test`, {
            method: 'POST'
        });
        const result = await response.json();
        if (result.success) {
            showToast('测试成功！响应: ' + (result.data?.response || 'OK'), 'success');
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast('测试失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('测试失败: ' + error.message, 'error');
    }
}

// 删除凭据
async function deleteCredential(id) {
    try {
        const response = await fetch(`/api/bedrock/credentials/${id}`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            showToast('删除成功', 'success');
            await loadCredentials();
            await loadStatistics();
        } else {
            showToast(result.error || '删除失败', 'error');
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}

// 切换选择
function toggleSelect(id, checked) {
    if (checked) {
        selectedIds.add(id);
    } else {
        selectedIds.delete(id);
    }
    updateBatchButtons();
    renderCards();
}

// 更新批量操作按钮
function updateBatchButtons() {
    const batchDeleteBtn = document.getElementById('batch-delete-btn');
    if (batchDeleteBtn) {
        batchDeleteBtn.style.display = selectedIds.size > 0 ? 'flex' : 'none';
    }
}

// 批量删除
async function handleBatchDelete() {
    if (selectedIds.size === 0) return;

    if (!confirm(`确定要删除选中的 ${selectedIds.size} 个账号吗？`)) return;

    let successCount = 0;
    let failCount = 0;

    for (const id of selectedIds) {
        try {
            const response = await fetch(`/api/bedrock/credentials/${id}`, {
                method: 'DELETE'
            });
            const result = await response.json();
            if (result.success) {
           successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            failCount++;
        }
    }

    selectedIds.clear();
    updateBatchButtons();

    if (failCount === 0) {
        showToast(`成功删除 ${successCount} 个账号`, 'success');
    } else {
        showToast(`删除完成: ${successCount} 成功, ${failCount} 失败`, 'warning');
    }

    await loadCredentials();
    await loadStatistics();
}

// 格式化日期
function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

// 防抖函数
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
