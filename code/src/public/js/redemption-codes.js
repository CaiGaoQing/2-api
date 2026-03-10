// ============ 兑换码管理页面 JS ============

let codes = [];
let packages = [];
let currentFilter = '';

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('redemption-codes');

    if (!await checkAuth()) return;

    await loadPackages();
    await loadStats();
    await loadCodes();
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('generate-btn').addEventListener('click', openGenerateModal);
    document.getElementById('empty-generate-btn')?.addEventListener('click', openGenerateModal);
    document.getElementById('modal-close').addEventListener('click', closeGenerateModal);
    document.getElementById('modal-cancel').addEventListener('click', closeGenerateModal);
    document.getElementById('modal-submit').addEventListener('click', generateCodes);
    document.getElementById('generate-modal').addEventListener('click', function(e) {
        if (e.target === this) closeGenerateModal();
    });

    document.getElementById('result-close').addEventListener('click', closeResultModal);
    document.getElementById('result-ok').addEventListener('click', closeResultModal);
    document.getElementById('result-copy').addEventListener('click', copyAllCodes);
    document.getElementById('result-modal').addEventListener('click', function(e) {
        if (e.target === this) closeResultModal();
    });

    document.getElementById('filter-status').addEventListener('change', function(e) {
        currentFilter = e.target.value;
        loadCodes();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeGenerateModal();
            closeResultModal();
        }
    });
}

async function loadPackages() {
    try {
        const res = await fetch('/api/packages/active', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        packages = result.success ? result.data : [];

        const select = document.getElementById('gen-package');
        select.innerHTML = '<option value="">请选择套餐</option>' +
            packages.map(p => '<option value="' + p.id + '">' + p.name + ' ($' + p.price + ')</option>').join('');
    } catch (err) {
        console.error('Load packages error:', err);
    }
}

async function loadStats() {
    try {
        const res = await fetch('/api/redemption-codes/stats', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            const s = result.data;
            document.getElementById('stat-total').textContent = s.total;
            document.getElementById('stat-unused').textContent = s.unused;
            document.getElementById('stat-used').textContent = s.used;
            document.getElementById('stat-expired').textContent = s.expired + s.disabled;
        }
    } catch (err) {
        console.error('Load stats error:', err);
    }
}

async function loadCodes() {
    try {
        const params = new URLSearchParams({ pageSize: '200' });
        if (currentFilter) params.set('status', currentFilter);

        const res = await fetch('/api/redemption-codes?' + params.toString(), {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            codes = result.data.items;
            renderTable();
            document.getElementById('codes-count').textContent = '共 ' + result.data.total + ' 个兑换码';
        }
    } catch (err) {
        console.error('Load codes error:', err);
    }
}

function renderTable() {
    const tbody = document.getElementById('codes-tbody');
    const tableContainer = document.getElementById('table-container');
    const emptyState = document.getElementById('empty-state');

    if (codes.length === 0) {
        tbody.innerHTML = '';
        tableContainer.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    tableContainer.style.display = 'block';
    emptyState.style.display = 'none';

    tbody.innerHTML = codes.map(function(c) {
        const statusMap = {
            'unused': '<span class="logs-status-badge success">未使用</span>',
            'used': '<span class="logs-status-badge info">已使用</span>',
            'expired': '<span class="logs-status-badge warning">已过期</span>',
            'disabled': '<span class="logs-status-badge error">已禁用</span>'
        };

        let redeemInfo = '-';
        if (c.status === 'used' && c.redeemedAt) {
            redeemInfo = 'Key#' + (c.redeemedByKeyId || '-') + '<br><small style="color:var(--text-muted);">' + formatDateTime(c.redeemedAt) + '</small>';
        }

        return '<tr>' +
            '<td><code style="font-size: 12px; background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px;">' + c.code + '</code></td>' +
            '<td>' + (c.packageName || '-') + '</td>' +
            '<td>' + (statusMap[c.status] || c.status) + '</td>' +
            '<td>' + redeemInfo + '</td>' +
            '<td>' + (c.note || '-') + '</td>' +
            '<td>' + formatDateTime(c.createdAt) + '</td>' +
            '<td>' + (c.expiresAt ? formatDateTime(c.expiresAt) : '永久') + '</td>' +
            '<td>' +
            (c.status === 'unused' ?
                '<button class="btn btn-secondary btn-sm" onclick="disableCode(' + c.id + ')">禁用</button> ' : '') +
            '<button class="btn btn-danger btn-sm" onclick="deleteCode(' + c.id + ')">删除</button>' +
            '</td>' +
            '</tr>';
    }).join('');
}

function openGenerateModal() {
    document.getElementById('gen-package').value = '';
    document.getElementById('gen-count').value = '1';
    document.getElementById('gen-expires').value = '';
    document.getElementById('gen-note').value = '';
    document.getElementById('generate-modal').classList.add('active');
}

function closeGenerateModal() {
    document.getElementById('generate-modal').classList.remove('active');
}

async function generateCodes() {
    const packageId = document.getElementById('gen-package').value;
    const count = parseInt(document.getElementById('gen-count').value) || 1;
    const expiresAt = document.getElementById('gen-expires').value || null;
    const note = document.getElementById('gen-note').value || null;

    if (!packageId) {
        showToast('请选择套餐', 'error');
        return;
    }
    if (count < 1 || count > 100) {
        showToast('数量需要在 1-100 之间', 'error');
        return;
    }

    try {
        const res = await fetch('/api/redemption-codes/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ packageId: parseInt(packageId), count, expiresAt, note })
        });
        const result = await res.json();
        if (result.success) {
            closeGenerateModal();
            showGeneratedCodes(result.data);
            await loadStats();
            await loadCodes();
        } else {
            showToast(result.error || '生成失败', 'error');
        }
    } catch (err) {
        showToast('生成失败: ' + err.message, 'error');
    }
}

let lastGeneratedCodes = [];

function showGeneratedCodes(codes) {
    lastGeneratedCodes = codes.map(c => c.code);
    const container = document.getElementById('result-codes');
    container.innerHTML = codes.map(c => c.code).join('<br>');
    document.getElementById('result-modal').classList.add('active');
}

function closeResultModal() {
    document.getElementById('result-modal').classList.remove('active');
}

function copyAllCodes() {
    const text = lastGeneratedCodes.join('\n');
    navigator.clipboard.writeText(text).then(() => {
        showToast('已复制 ' + lastGeneratedCodes.length + ' 个兑换码', 'success');
    }).catch(() => {
        showToast('复制失败', 'error');
    });
}

async function disableCode(id) {
    if (!confirm('确定要禁用此兑换码？')) return;
    try {
        const res = await fetch('/api/redemption-codes/' + id + '/disable', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            showToast('已禁用', 'success');
            await loadStats();
            await loadCodes();
        } else {
            showToast(result.error || '操作失败', 'error');
        }
    } catch (err) {
        showToast('操作失败', 'error');
    }
}

async function deleteCode(id) {
    if (!confirm('确定要删除此兑换码？此操作不可恢复。')) return;
    try {
        const res = await fetch('/api/redemption-codes/' + id, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            showToast('已删除', 'success');
            await loadStats();
            await loadCodes();
        } else {
            showToast(result.error || '删除失败', 'error');
        }
    } catch (err) {
        showToast('删除失败', 'error');
    }
}
