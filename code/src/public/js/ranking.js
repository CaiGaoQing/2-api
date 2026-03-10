// 使用排行页面 JavaScript

let currentHours = 24;
let currentLimit = 5;
let currentOrderBy = 'tokens';
let currentApiKeyId = null;
let historyOffset = 0;
const historyLimit = 50;

// 图表实例
let tokensChart = null;
let requestsChart = null;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 检查登录状态
    if (!await checkAuth()) {
        return;
    }

    // 加载侧边栏
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('ranking');
    updateSidebarStats();

    // 绑定事件
    bindEvents();

    // 加载排行榜
    loadRanking();
});

// 绑定事件
function bindEvents() {
    // 筛选条件变化
    document.getElementById('filter-hours').addEventListener('change', (e) => {
        currentHours = parseInt(e.target.value);
        loadRanking();
    });

    document.getElementById('filter-limit').addEventListener('change', (e) => {
        currentLimit = parseInt(e.target.value);
        loadRanking();
    });

    document.getElementById('filter-orderby').addEventListener('change', (e) => {
        currentOrderBy = e.target.value;
        loadRanking();
    });

    // 刷新按钮
    document.getElementById('refresh-btn').addEventListener('click', loadRanking);

    // 收起详情
    document.getElementById('close-history-btn').addEventListener('click', closeHistory);
}

// 加载排行榜
async function loadRanking() {
    const token = localStorage.getItem('authToken');
    const tbody = document.getElementById('ranking-list');
    const emptyState = document.getElementById('ranking-empty');

    // 更新标题
    const hoursText = currentHours >= 24 ? `${currentHours / 24} 天` : `${currentHours} 小时`;
    document.getElementById('ranking-title').textContent = `最近 ${hoursText} 使用排行`;

    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 40px;">加载中...</td></tr>';

    try {
        const response = await fetch(`/api/logs-stats/ranking?hours=${currentHours}&limit=${currentLimit}&orderBy=${currentOrderBy}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        const ranking = result.data.ranking;

        if (ranking.length === 0) {
            tbody.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        tbody.innerHTML = ranking.map(item => `
            <tr>
                <td>
                    <span class="rank-badge rank-${item.rank <= 3 ? item.rank : 'other'}">${item.rank}</span>
                </td>
                <td><code class="key-prefix">${item.apiKeyPrefix}***</code></td>
                <td>${escapeHtml(item.apiKeyName)}</td>
                <td>${formatNumber(item.requestCount)}</td>
                <td>${formatNumber(item.inputTokens)}</td>
                <td>${formatNumber(item.outputTokens)}</td>
                <td><strong>${formatNumber(item.totalTokens)}</strong></td>
                <td><span class="cost-value">$${item.totalCost.toFixed(4)}</span></td>
                <td>${formatTime(item.lastRequest)}</td>
                <td>
                    <button class="btn btn-sm btn-secondary" onclick="viewHistory(${item.apiKeyId}, '${escapeHtml(item.apiKeyName)}')">
                        详情
                    </button>
                </td>
            </tr>
        `).join('');

    } catch (error) {
        console.error('加载排行榜失败:', error);
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--error-color);">加载失败: ${error.message}</td></tr>`;
    }
}

// 查看调用记录详情
async function viewHistory(apiKeyId, apiKeyName) {
    currentApiKeyId = apiKeyId;
    historyOffset = 0;

    // 先销毁旧图表
    if (tokensChart) {
        tokensChart.destroy();
        tokensChart = null;
    }
    if (requestsChart) {
        requestsChart.destroy();
        requestsChart = null;
    }

    // 清空旧数据
    document.getElementById('history-list').innerHTML = '';
    document.getElementById('history-pagination').innerHTML = '';

    document.getElementById('history-title').textContent = `调用记录 - ${apiKeyName}`;
    document.getElementById('history-section').style.display = 'block';

    // 并行加载图表和记录
    await Promise.all([
        loadChartData(),
        loadHistory()
    ]);
}

// 加载图表数据
async function loadChartData() {
    const token = localStorage.getItem('authToken');

    try {
        const response = await fetch(`/api/logs-stats/ranking/${currentApiKeyId}/chart?hours=${currentHours}&interval=hour`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();

        if (!result.success) {
            console.error('加载图表数据失败:', result.error);
            return;
        }

        renderCharts(result.data);
    } catch (error) {
        console.error('加载图表数据失败:', error);
    }
}

// 渲染图表
function renderCharts(data) {
    const labels = data.map(item => {
        // 格式化时间标签
        const time = item.time;
        if (time.length > 10) {
            return time.substring(11, 16); // 只显示 HH:mm
        }
        return time.substring(5); // 显示 MM-DD
    });

    const inputTokens = data.map(item => item.inputTokens);
    const outputTokens = data.map(item => item.outputTokens);
    const requestCounts = data.map(item => item.requestCount);

    // 销毁旧图表
    if (tokensChart) {
        tokensChart.destroy();
    }
    if (requestsChart) {
        requestsChart.destroy();
    }

    // Token 图表
    const tokensCtx = document.getElementById('tokens-chart').getContext('2d');
    tokensChart = new Chart(tokensCtx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '输入 Tokens',
                    data: inputTokens,
                    borderColor: 'rgb(59, 130, 246)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.3
                },
                {
                    label: '输出 Tokens',
                    data: outputTokens,
                    borderColor: 'rgb(16, 185, 129)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: 'Token 使用量'
                },
                legend: {
                    position: 'bottom'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: value => formatNumber(value)
                    }
                }
            }
        }
    });

    // 请求数图表
    const requestsCtx = document.getElementById('requests-chart').getContext('2d');
    requestsChart = new Chart(requestsCtx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '请求数',
                    data: requestCounts,
                    backgroundColor: 'rgba(139, 92, 246, 0.7)',
                    borderColor: 'rgb(139, 92, 246)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                title: {
                    display: true,
                    text: '请求次数'
                },
                legend: {
                    position: 'bottom'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            }
        }
    });
}

// 加载调用记录
async function loadHistory() {
    const token = localStorage.getItem('authToken');
    const tbody = document.getElementById('history-list');

    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px;">加载中...</td></tr>';

    try {
        const response = await fetch(`/api/logs-stats/ranking/${currentApiKeyId}/history?hours=${currentHours}&limit=${historyLimit}&offset=${historyOffset}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const result = await response.json();

        if (!result.success) {
            throw new Error(result.error);
        }

        const { records, total } = result.data;

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px;">暂无记录</td></tr>';
            document.getElementById('history-pagination').innerHTML = '';
            return;
        }

        tbody.innerHTML = records.map(record => `
            <tr class="${record.statusCode >= 400 ? 'error-row' : ''}">
                <td>${formatTime(record.createdAt)}</td>
                <td><code>${record.model || '-'}</code></td>
                <td><code>${record.path || '-'}</code></td>
                <td>${formatNumber(record.inputTokens)}</td>
                <td>${formatNumber(record.outputTokens)}</td>
                <td>
                    <span class="status-badge status-${record.statusCode < 400 ? 'success' : 'error'}">
                        ${record.statusCode}
                    </span>
                </td>
                <td>${record.durationMs}ms</td>
                <td><code>${record.clientIp || '-'}</code></td>
            </tr>
            ${record.errorMessage ? `<tr class="error-detail-row"><td colspan="8" style="color: var(--error-color); font-size: 12px; padding: 4px 12px;">${escapeHtml(record.errorMessage)}</td></tr>` : ''}
        `).join('');

        // 分页
        renderPagination(total);

    } catch (error) {
        console.error('加载调用记录失败:', error);
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--error-color);">加载失败: ${error.message}</td></tr>`;
    }
}

// 渲染分页
function renderPagination(total) {
    const pagination = document.getElementById('history-pagination');
    const totalPages = Math.ceil(total / historyLimit);
    const currentPage = Math.floor(historyOffset / historyLimit) + 1;

    if (totalPages <= 1) {
        pagination.innerHTML = `<span style="color: var(--text-secondary);">共 ${total} 条记录</span>`;
        return;
    }

    let html = `<span style="color: var(--text-secondary); margin-right: 16px;">共 ${total} 条记录</span>`;

    // 上一页
    if (currentPage > 1) {
        html += `<button class="btn btn-sm btn-secondary" onclick="goToPage(${currentPage - 1})">上一页</button> `;
    }

    // 页码
    html += `<span style="margin: 0 12px;">第 ${currentPage} / ${totalPages} 页</span>`;

    // 下一页
    if (currentPage < totalPages) {
        html += `<button class="btn btn-sm btn-secondary" onclick="goToPage(${currentPage + 1})">下一页</button>`;
    }

    pagination.innerHTML = html;
}

// 跳转页面
function goToPage(page) {
    historyOffset = (page - 1) * historyLimit;
    loadHistory();
}

// 收起详情
function closeHistory() {
    document.getElementById('history-section').style.display = 'none';
    currentApiKeyId = null;

    // 销毁图表
    if (tokensChart) {
        tokensChart.destroy();
        tokensChart = null;
    }
    if (requestsChart) {
        requestsChart.destroy();
        requestsChart = null;
    }
}

// 格式化数字
function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return num.toLocaleString();
}

// 格式化时间
function formatTime(timeStr) {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return date.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// HTML 转义
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
