// ============ API 日志页面 JS ============

let currentLogsPage = 1;
const logsPageSize = 50;
let currentLogData = null;

// DOM 元素
let logDetailModal, cleanupModal;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('logs');

    // 获取模态框元素
    logDetailModal = document.getElementById('log-detail-modal');
    cleanupModal = document.getElementById('cleanup-modal');

    if (!await checkAuth()) return;

    loadLogs();
    loadLogsStats();
    loadChannelStats();
    setupEventListeners();
    updateSidebarStats();
});

function setupEventListeners() {
    // 查询按钮
    document.getElementById('logs-search-btn').addEventListener('click', function() {
        currentLogsPage = 1;
        loadLogs();
    });

    // 重置按钮
    document.getElementById('logs-reset-btn').addEventListener('click', resetLogsFilter);

    // 清理按钮 - 打开模态框
    document.getElementById('logs-cleanup-btn').addEventListener('click', openCleanupModal);

    // 分页按钮
    document.getElementById('logs-prev-btn').addEventListener('click', function() {
        if (currentLogsPage > 1) {
            currentLogsPage--;
            loadLogs();
        }
    });
    document.getElementById('logs-next-btn').addEventListener('click', function() {
        currentLogsPage++;
        loadLogs();
    });

    // 日志详情模态框
    document.getElementById('log-detail-close').addEventListener('click', closeLogDetailModal);
    document.getElementById('log-detail-close-btn').addEventListener('click', closeLogDetailModal);
    document.getElementById('log-detail-copy').addEventListener('click', copyLogJson);
    logDetailModal.addEventListener('click', function(e) {
        if (e.target === logDetailModal) closeLogDetailModal();
    });

    // 清理模态框
    document.getElementById('cleanup-modal-close').addEventListener('click', closeCleanupModal);
    document.getElementById('cleanup-cancel').addEventListener('click', closeCleanupModal);
    document.getElementById('cleanup-confirm').addEventListener('click', confirmCleanup);
    cleanupModal.addEventListener('click', function(e) {
        if (e.target === cleanupModal) closeCleanupModal();
    });

    // 键盘快捷键
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeLogDetailModal();
            closeCleanupModal();
        }
    });

    // 回车搜索
    var filterInputs = document.querySelectorAll('.logs-filter-input');
    filterInputs.forEach(function(input) {
        input.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                currentLogsPage = 1;
                loadLogs();
            }
        });
    });
}

async function loadLogs() {
    var ipFilter = document.getElementById('logs-filter-ip').value.trim();
    var modelFilter = document.getElementById('logs-filter-model').value;
    var statusFilter = document.getElementById('logs-filter-status').value;
    var channelFilter = document.getElementById('logs-filter-channel').value;
    var apiKeyFilter = document.getElementById('logs-filter-apikey').value.trim();
    var startDate = document.getElementById('logs-filter-start').value;
    var endDate = document.getElementById('logs-filter-end').value;

    var url = '/api/logs?page=' + currentLogsPage + '&pageSize=' + logsPageSize;
    if (ipFilter) url += '&ipAddress=' + encodeURIComponent(ipFilter);
    if (modelFilter) url += '&model=' + encodeURIComponent(modelFilter);
    if (statusFilter) url += '&statusCode=' + encodeURIComponent(statusFilter);
    if (channelFilter) url += '&channel=' + encodeURIComponent(channelFilter);
    if (apiKeyFilter) url += '&apiKeyPrefix=' + encodeURIComponent(apiKeyFilter);
    if (startDate) url += '&startDate=' + startDate;
    if (endDate) url += '&endDate=' + endDate;

    try {
        var res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        var result = await res.json();
        if (result.success) {
            renderLogs(result.data);
        } else {
            showToast(result.error || '加载日志失败', 'error');
        }
    } catch (err) {
        console.error('Load logs error:', err);
        showToast('加载日志失败', 'error');
    }
}

async function loadLogsStats() {
    try {
        var res = await fetch('/api/logs-stats', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        var result = await res.json();
        if (result.success && result.data) {
            var stats = result.data;
            document.getElementById('logs-total-requests').textContent = stats.totalRequests || 0;
            document.getElementById('logs-total-input-tokens').textContent = formatNumber(stats.totalInputTokens || 0);
            document.getElementById('logs-total-output-tokens').textContent = formatNumber(stats.totalOutputTokens || 0);
            document.getElementById('logs-avg-duration').textContent = Math.round(stats.avgDuration || 0) + 'ms';
            document.getElementById('logs-error-count').textContent = stats.errorCount || 0;
        }
    } catch (err) {
        console.error('Load logs stats error:', err);
    }
}

async function loadChannelStats() {
    try {
        var startDate = document.getElementById('logs-filter-start').value;
        var endDate = document.getElementById('logs-filter-end').value;
        var url = '/api/logs-stats/by-channel?';
        if (startDate) url += 'startDate=' + startDate + '&';
        if (endDate) url += 'endDate=' + endDate + '&';

        var res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        var result = await res.json();
        if (result.success && result.data) {
            renderChannelStats(result.data);
        }
    } catch (err) {
        console.error('Load channel stats error:', err);
    }
}

function renderChannelStats(stats) {
    var list = document.getElementById('channel-stats-list');
    if (!stats || stats.length === 0) {
        list.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: var(--text-muted);">暂无渠道数据</td></tr>';
        return;
    }

    list.innerHTML = stats.map(function(s) {
        var rateNum = parseFloat(s.successRate);
        var rateClass = rateNum >= 95 ? 'success' : rateNum >= 80 ? 'warning' : 'error';
        return '<tr>' +
            '<td><span class="logs-channel-badge">' + s.channel + '</span></td>' +
            '<td>' + formatNumber(s.totalRequests) + '</td>' +
            '<td style="color: #4ade80;">' + formatNumber(s.successCount) + '</td>' +
            '<td style="color: #f87171;">' + formatNumber(s.errorCount) + '</td>' +
            '<td><span class="logs-status-badge ' + rateClass + '">' + s.successRate + '%</span></td>' +
            '<td>' + formatNumber(s.inputTokens) + '</td>' +
            '<td>' + formatNumber(s.outputTokens) + '</td>' +
            '<td>' + s.avgDurationMs + 'ms</td>' +
            '</tr>';
    }).join('');
}

function renderLogs(data) {
    var list = document.getElementById('logs-list');
    var logs = data.logs || [];
    var total = data.total || 0;
    var totalPages = data.totalPages || 1;

    document.getElementById('logs-total').textContent = total;
    document.getElementById('logs-current-page').textContent = currentLogsPage;
    document.getElementById('logs-total-pages').textContent = totalPages;

    var start = (currentLogsPage - 1) * logsPageSize + 1;
    var end = Math.min(currentLogsPage * logsPageSize, total);
    document.getElementById('logs-showing-start').textContent = total > 0 ? start : 0;
    document.getElementById('logs-showing-end').textContent = end;

    document.getElementById('logs-prev-btn').disabled = currentLogsPage <= 1;
    document.getElementById('logs-next-btn').disabled = currentLogsPage >= totalPages;

    if (logs.length === 0) {
        list.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px; color: var(--text-muted);">暂无日志记录</td></tr>';
        return;
    }

    list.innerHTML = logs.map(function(log) {
        var statusClass = log.statusCode >= 400 ? 'error' : 'success';
        var typeClass = log.stream ? 'stream' : 'sync';
        var typeText = log.stream ? '流式' : '同步';
        var channelLabel = log.channel || '-';

        return '<tr>' +
            '<td>' + formatDateTime(log.createdAt) + '</td>' +
            '<td class="logs-ip-cell">' + (log.ipAddress || '-') + '</td>' +
            '<td><span class="logs-key-cell">' + (log.apiKeyPrefix || '-') + '</span></td>' +
            '<td><span class="logs-channel-badge">' + channelLabel + '</span></td>' +
            '<td class="logs-model-cell">' + formatModelName(log.model) + '</td>' +
            '<td><span class="logs-type-badge ' + typeClass + '">' + typeText + '</span></td>' +
            '<td class="logs-tokens-cell">' + (log.inputTokens || 0) + ' / ' + (log.outputTokens || 0) + '</td>' +
            '<td class="logs-duration-cell">' + (log.durationMs || 0) + 'ms</td>' +
            '<td><span class="logs-status-badge ' + statusClass + '">' + (log.statusCode || 200) + '</span></td>' +
            '<td>' +
            '<button class="logs-action-btn" data-request-id="' + log.requestId + '" title="查看详情">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>' +
            '</button>' +
            '</td>' +
            '</tr>';
    }).join('');

    // 绑定查看详情按钮事件
    list.querySelectorAll('.logs-action-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            viewLogDetail(btn.dataset.requestId);
        });
    });
}

function formatModelName(model) {
    if (!model) return '-';
    var modelMap = {
        'claude-sonnet-4-20250514': 'sonnet-4',
        'claude-opus-4-5-20251101': 'opus-4.5',
        'claude-3-5-sonnet-20241022': '3.5-sonnet',
        'claude-3-5-haiku-20241022': '3.5-haiku',
        'claude-3-opus-20240229': '3-opus',
        'claude-3-sonnet-20240229': '3-sonnet',
        'claude-3-haiku-20240307': '3-haiku'
    };
    return modelMap[model] || model.replace('claude-', '').substring(0, 12);
}

function resetLogsFilter() {
    document.getElementById('logs-filter-ip').value = '';
    document.getElementById('logs-filter-model').value = '';
    document.getElementById('logs-filter-status').value = '';
    document.getElementById('logs-filter-channel').value = '';
    document.getElementById('logs-filter-apikey').value = '';
    document.getElementById('logs-filter-start').value = '';
    document.getElementById('logs-filter-end').value = '';
    currentLogsPage = 1;
    loadLogs();
}

// ============ 日志详情模态框 ============

async function viewLogDetail(requestId) {
    try {
        var res = await fetch('/api/logs/' + requestId, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        var result = await res.json();
        if (result.success && result.data) {
            currentLogData = result.data;
            renderLogDetail(result.data);
            logDetailModal.classList.add('active');
        } else {
            showToast('获取日志详情失败', 'error');
        }
    } catch (err) {
        showToast('获取日志详情失败: ' + err.message, 'error');
    }
}

function renderLogDetail(log) {
    var content = document.getElementById('log-detail-content');
    var statusClass = log.statusCode >= 400 ? 'error' : 'success';

    var html = '<div class="log-detail-grid">';

    // 基本信息
    html += '<div class="log-detail-section">';
    html += '<h4 class="log-detail-section-title">基本信息</h4>';
    html += '<div class="log-detail-items">';
    html += createDetailItem('请求 ID', log.requestId || '-');
    html += createDetailItem('时间', formatDateTime(log.createdAt));
    html += createDetailItem('IP 地址', log.ipAddress || '-');
    html += createDetailItem('API Key', log.apiKeyPrefix || '-');
    html += createDetailItem('渠道', log.channel || '-');
    html += '</div></div>';

    // 请求信息
    html += '<div class="log-detail-section">';
    html += '<h4 class="log-detail-section-title">请求信息</h4>';
    html += '<div class="log-detail-items">';
    html += createDetailItem('模型', log.model || '-');
    html += createDetailItem('类型', log.stream ? '流式' : '同步');
    html += createDetailItem('状态码', '<span class="logs-status-badge ' + statusClass + '">' + (log.statusCode || 200) + '</span>');
    html += createDetailItem('耗时', (log.durationMs || 0) + 'ms');
    html += '</div></div>';

    // Token 统计
    html += '<div class="log-detail-section">';
    html += '<h4 class="log-detail-section-title">Token 统计</h4>';
    html += '<div class="log-detail-items">';
    html += createDetailItem('输入 Tokens', log.inputTokens || 0);
    html += createDetailItem('输出 Tokens', log.outputTokens || 0);
    html += createDetailItem('总 Tokens', (log.inputTokens || 0) + (log.outputTokens || 0));
    html += '</div></div>';

    // 错误信息（如果有）
    if (log.errorMessage) {
        html += '<div class="log-detail-section log-detail-error">';
        html += '<h4 class="log-detail-section-title">错误信息</h4>';
        html += '<div class="log-detail-error-content">' + escapeHtml(log.errorMessage) + '</div>';
        html += '</div>';
    }

    // 请求/响应数据（如果有）
    if (log.requestBody || log.responseBody) {
        html += '<div class="log-detail-section">';
        html += '<h4 class="log-detail-section-title">请求/响应数据</h4>';
        if (log.requestBody) {
            html += '<div class="log-detail-code-label">请求体:</div>';
            html += '<pre class="log-detail-code">' + formatJsonString(log.requestBody) + '</pre>';
        }
        if (log.responseBody) {
            html += '<div class="log-detail-code-label">响应体:</div>';
            html += '<pre class="log-detail-code">' + formatJsonString(log.responseBody) + '</pre>';
        }
        html += '</div>';
    }

    html += '</div>';
    content.innerHTML = html;
}

function createDetailItem(label, value) {
    return '<div class="log-detail-item">' +
        '<span class="log-detail-label">' + label + '</span>' +
        '<span class="log-detail-value">' + value + '</span>' +
        '</div>';
}

function formatJsonString(str) {
    if (!str) return '';
    try {
        var obj = typeof str === 'string' ? JSON.parse(str) : str;
        return escapeHtml(JSON.stringify(obj, null, 2));
    } catch (e) {
        return escapeHtml(str);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function closeLogDetailModal() {
    logDetailModal.classList.remove('active');
    currentLogData = null;
}

function copyLogJson() {
    if (!currentLogData) return;
    var jsonStr = JSON.stringify(currentLogData, null, 2);
    copyToClipboard(jsonStr);
    showToast('已复制到剪贴板', 'success');
}

// ============ 清理模态框 ============

function openCleanupModal() {
    document.getElementById('cleanup-days').value = '30';
    cleanupModal.classList.add('active');
}

function closeCleanupModal() {
    cleanupModal.classList.remove('active');
}

async function confirmCleanup() {
    var daysInput = document.getElementById('cleanup-days');
    var days = parseInt(daysInput.value);

    if (isNaN(days) || days < 1 || days > 365) {
        showToast('请输入 1-365 之间的天数', 'error');
        return;
    }

    try {
        var res = await fetch('/api/logs/cleanup', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ daysToKeep: days })
        });
        var result = await res.json();
        if (result.success) {
            showToast('日志清理完成', 'success');
            closeCleanupModal();
            loadLogs();
            loadLogsStats();
        } else {
            showToast(result.error || '清理失败', 'error');
        }
    } catch (err) {
        showToast('清理失败: ' + err.message, 'error');
    }
}

// ============ 辅助函数 ============

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}
