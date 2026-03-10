// ============ 异常账号页面 JS ============

let errorAccounts = [];

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('error-accounts');

    if (!await checkAuth()) return;

    loadErrorAccounts();
    setupEventListeners();
    updateSidebarStats();
});

function setupEventListeners() {
    document.getElementById('refresh-all-btn').addEventListener('click', refreshAllErrorAccounts);
    document.getElementById('delete-all-btn').addEventListener('click', deleteAllErrorAccounts);
}

async function loadErrorAccounts() {
    try {
        const res = await fetch('/api/error-credentials', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        errorAccounts = result.success ? result.data : [];
        renderErrorAccounts();
    } catch (err) {
        console.error('Load error accounts error:', err);
        showToast('加载异常账号失败', 'error');
    }
}

function renderErrorAccounts() {
    const list = document.getElementById('error-accounts-list');
    const emptyState = document.getElementById('empty-state');

    if (errorAccounts.length === 0) {
        list.innerHTML = '';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    list.innerHTML = errorAccounts.map(function(acc) {
        return '<tr>' +
            '<td>' + (acc.email || acc.name || 'Unknown') + '</td>' +
            '<td>' + (acc.authMethod || 'social') + '</td>' +
            '<td>' + (acc.region || 'us-east-1') + '</td>' +
            '<td>' + formatDateTime(acc.errorAt || acc.updatedAt) + '</td>' +
            '<td style="color: var(--accent-danger);">' + (acc.errorMessage || '未知错误') + '</td>' +
            '<td>' +
            '<div style="display: flex; gap: 4px;">' +
            '<button class="btn btn-primary btn-sm" onclick="refreshErrorAccountUsage(' + acc.id + ')">刷新用量</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="refreshErrorAccount(' + acc.id + ')">刷新Token</button>' +
            '<button class="btn btn-secondary btn-sm" onclick="restoreErrorAccount(' + acc.id + ')">恢复</button>' +
            '<button class="btn btn-danger btn-sm" onclick="deleteErrorAccount(' + acc.id + ')">删除</button>' +
            '</div>' +
            '</td>' +
            '</tr>';
    }).join('');
}

async function refreshErrorAccount(id) {
    showToast('正在刷新Token...', 'warning');
    try {
        const res = await fetch('/api/error-credentials/' + id + '/refresh', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            showToast('Token刷新成功，账号已恢复', 'success');
            loadErrorAccounts();
            updateSidebarStats();
        } else {
            showToast('Token刷新失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (err) {
        showToast('Token刷新失败: ' + err.message, 'error');
    }
}

async function refreshErrorAccountUsage(id) {
    showToast('正在刷新用量...', 'warning');
    try {
        const res = await fetch('/api/error-credentials/' + id + '/usage', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            if (result.restored) {
                showToast('用量获取成功，账号已恢复到正常列表', 'success');
                loadErrorAccounts();
                updateSidebarStats();
            } else {
                showToast('用量获取成功', 'success');
            }
        } else {
            showToast('用量获取失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (err) {
        showToast('用量获取失败: ' + err.message, 'error');
    }
}

async function restoreErrorAccount(id) {
    if (!confirm('确定要恢复此账号吗？（不刷新 Token）')) return;
    try {
        const res = await fetch('/api/error-credentials/' + id + '/restore', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            showToast('账号已恢复', 'success');
            loadErrorAccounts();
            updateSidebarStats();
        } else {
            showToast('恢复失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (err) {
        showToast('恢复失败: ' + err.message, 'error');
    }
}

async function deleteErrorAccount(id) {
    if (!confirm('确定要删除此账号吗？')) return;
    try {
        await fetch('/api/error-credentials/' + id, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        showToast('账号已删除', 'success');
        loadErrorAccounts();
        updateSidebarStats();
    } catch (err) {
        showToast('删除失败: ' + err.message, 'error');
    }
}

async function refreshAllErrorAccounts() {
    if (errorAccounts.length === 0) {
        showToast('没有需要刷新的账号', 'warning');
        return;
    }
    showToast('正在批量刷新...', 'warning');
    let successCount = 0;
    let failCount = 0;

    for (const acc of errorAccounts) {
        try {
            const res = await fetch('/api/error-credentials/' + acc.id + '/refresh', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
            const result = await res.json();
            if (result.success) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (err) {
            failCount++;
        }
    }

    showToast('刷新完成: ' + successCount + ' 成功, ' + failCount + ' 失败', successCount > 0 ? 'success' : 'warning');
    loadErrorAccounts();
    updateSidebarStats();
}

async function deleteAllErrorAccounts() {
    if (errorAccounts.length === 0) {
        showToast('没有需要删除的账号', 'warning');
        return;
    }
    if (!confirm('确定要删除所有 ' + errorAccounts.length + ' 个异常账号吗？')) return;

    for (const acc of errorAccounts) {
        try {
            await fetch('/api/error-credentials/' + acc.id, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + authToken }
            });
        } catch (err) {}
    }

    showToast('已清空所有异常账号', 'success');
    loadErrorAccounts();
    updateSidebarStats();
}
