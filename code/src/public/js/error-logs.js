// ============ 错误日志页面 JS ============

let currentErrorLogsPage = 1;
const errorLogsPageSize = 50;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('error-logs');

    if (!await checkAuth()) return;

    loadErrorLogs();
    setupEventListeners();
    updateSidebarStats();
});

function setupEventListeners() {
    document.getElementById('error-logs-search-btn').addEventListener('click', function() {
        currentErrorLogsPage = 1;
        loadErrorLogs();
    });
    document.getElementById('error-logs-reset-btn').addEventListener('click', resetErrorLogsFilter);
    document.getElementById('error-logs-prev-btn').addEventListener('click', function() {
        if (currentErrorLogsPage > 1) {
            currentErrorLogsPage--;
            loadErrorLogs();
        }
    });
    document.getElementById('error-logs-next-btn').addEventListener('click', function() {
        currentErrorLogsPage++;
        loadErrorLogs();
    });
}

async function loadErrorLogs() {
    const startDate = document.getElementById('error-logs-filter-start').value;
    const endDate = document.getElementById('error-logs-filter-end').value;

    let url = '/api/error-logs?page=' + currentErrorLogsPage + '&pageSize=' + errorLogsPageSize;
    if (startDate) url += '&startDate=' + startDate;
    if (endDate) url += '&endDate=' + endDate;

    try {
        const res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            renderErrorLogs(result.data);
            updateStats(result.data.logs || []);
        } else {
            showToast(result.error || '加载错误日志失败', 'error');
        }
    } catch (err) {
        console.error('Load error logs error:', err);
        showToast('加载错误日志失败', 'error');
    }
}

function updateStats(logs) {
    const total = logs.length;
    const count4xx = logs.filter(l => l.statusCode >= 400 && l.statusCode < 500).length;
    const count5xx = logs.filter(l => l.statusCode >= 500).length;

    const totalCountEl = document.getElementById('error-logs-total-count');
    const count4xxEl = document.getElementById('error-logs-4xx-count');
    const count5xxEl = document.getElementById('error-logs-5xx-count');

    if (totalCountEl) totalCountEl.textContent = total;
    if (count4xxEl) count4xxEl.textContent = count4xx;
    if (count5xxEl) count5xxEl.textContent = count5xx;
}

function renderErrorLogs(data) {
    const list = document.getElementById('error-logs-list');
    const emptyState = document.getElementById('error-logs-empty');
    const tableWrapper = document.querySelector('.logs-table-wrapper');
    const pagination = document.getElementById('error-logs-pagination');
    const logs = data.logs || [];
    const total = data.total || 0;
    const totalPages = data.totalPages || 1;

    document.getElementById('error-logs-total').textContent = total;
    document.getElementById('error-logs-current-page').textContent = currentErrorLogsPage;
    document.getElementById('error-logs-total-pages').textContent = totalPages;

    const start = (currentErrorLogsPage - 1) * errorLogsPageSize + 1;
    const end = Math.min(currentErrorLogsPage * errorLogsPageSize, total);
    document.getElementById('error-logs-showing-start').textContent = total > 0 ? start : 0;
    document.getElementById('error-logs-showing-end').textContent = end;

    document.getElementById('error-logs-prev-btn').disabled = currentErrorLogsPage <= 1;
    document.getElementById('error-logs-next-btn').disabled = currentErrorLogsPage >= totalPages;

    if (logs.length === 0) {
        if (tableWrapper) tableWrapper.style.display = 'none';
        if (pagination) pagination.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        return;
    }

    if (tableWrapper) tableWrapper.style.display = 'block';
    if (pagination) pagination.style.display = 'flex';
    if (emptyState) emptyState.style.display = 'none';

    list.innerHTML = logs.map(function(log) {
        const statusClass = log.statusCode >= 500 ? 'error' : 'warning';
        return '<tr>' +
            '<td>' + formatDateTime(log.createdAt) + '</td>' +
            '<td class="logs-ip-cell">' + (log.ipAddress || '-') + '</td>' +
            '<td><span class="logs-key-cell">' + (log.apiKeyPrefix || '-') + '</span></td>' +
            '<td>' + (log.path || '-') + '</td>' +
            '<td><span class="logs-status-badge ' + statusClass + '">' + (log.statusCode || 500) + '</span></td>' +
            '<td class="logs-duration-cell">' + (log.durationMs || 0) + 'ms</td>' +
            '<td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="' + escapeHtml(log.errorMessage || '') + '">' + escapeHtml(log.errorMessage || '-') + '</td>' +
            '</tr>';
    }).join('');
}

function resetErrorLogsFilter() {
    document.getElementById('error-logs-filter-start').value = '';
    document.getElementById('error-logs-filter-end').value = '';
    currentErrorLogsPage = 1;
    loadErrorLogs();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
