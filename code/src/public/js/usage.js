// ============ 用量统计页面 JS ============

let apiKeys = [];
let currentKeyId = null;
let costChart = null;
let requestsChart = null;
let tokensTimelineChart = null;

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('usage');

    if (!await checkAuth()) return;

    // 检查 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const keyId = urlParams.get('keyId');
    if (keyId) {
        currentKeyId = parseInt(keyId);
    }

    await loadApiKeys();
    loadUsageStats();
    loadTokensTimeline();
    setupEventListeners();
    updateSidebarStats();
});

function setupEventListeners() {
    document.getElementById('usage-search-btn').addEventListener('click', function() {
        loadUsageStats();
        loadTokensTimeline();
    });
    document.getElementById('usage-reset-btn').addEventListener('click', resetFilters);

    document.getElementById('usage-filter-key').addEventListener('change', function() {
        currentKeyId = this.value ? parseInt(this.value) : null;
        loadUsageStats();
        loadTokensTimeline();
    });
}

async function loadApiKeys() {
    try {
        const res = await fetch('/api/keys', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success) {
            apiKeys = result.data || [];
            renderKeyOptions();
        }
    } catch (err) {
        console.error('Load API keys error:', err);
    }
}

function renderKeyOptions() {
    const select = document.getElementById('usage-filter-key');
    select.innerHTML = '<option value="">全部密钥</option>';

    apiKeys.forEach(function(key) {
        const option = document.createElement('option');
        option.value = key.id;
        option.textContent = key.name + ' (' + key.keyPrefix + ')';
        if (currentKeyId && key.id === currentKeyId) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

async function loadUsageStats() {
    const startDate = document.getElementById('usage-filter-start').value;
    const endDate = document.getElementById('usage-filter-end').value;

    let url = '/api/logs-stats/cost?';
    if (startDate) url += 'startDate=' + startDate + '&';
    if (endDate) url += 'endDate=' + endDate + '&';

    // 如果选择了特定 Key，使用单独的 API
    if (currentKeyId) {
        url = '/api/keys/' + currentKeyId + '/cost?';
        if (startDate) url += 'startDate=' + startDate + '&';
        if (endDate) url += 'endDate=' + endDate + '&';
    }

    try {
        const res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();

        if (result.success && result.data) {
            renderStats(result.data);
        } else {
            showToast(result.error || '加载统计失败', 'error');
        }
    } catch (err) {
        console.error('Load usage stats error:', err);
        showToast('加载统计失败', 'error');
    }
}

function renderStats(data) {
    const summary = data.summary || {};
    const modelStats = data.byModel || data.models || [];
    const keyStats = data.byApiKey || [];

    // 更新汇总卡片
    document.getElementById('summary-requests').textContent = formatNumber(summary.totalRequests || 0);
    document.getElementById('summary-input-tokens').textContent = formatNumber(summary.totalInputTokens || 0);
    document.getElementById('summary-output-tokens').textContent = formatNumber(summary.totalOutputTokens || 0);
    document.getElementById('summary-cost').textContent = '$' + (summary.totalCost || 0).toFixed(4);

    // 渲染图表
    renderCharts(modelStats);

    // 渲染 API Key 统计表格（仅在查看全部时显示）
    if (!currentKeyId) {
        renderKeyStats(keyStats);
        document.querySelector('.usage-section:last-child').style.display = 'block';
    } else {
        document.querySelector('.usage-section:last-child').style.display = 'none';
    }
}

function renderCharts(stats) {
    // 销毁旧图表
    if (costChart) {
        costChart.destroy();
        costChart = null;
    }
    if (requestsChart) {
        requestsChart.destroy();
        requestsChart = null;
    }

    if (!stats || stats.length === 0) {
        return;
    }

    // 按总费用从高到低排序
    const sortedStats = [...stats].sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0));

    const labels = sortedStats.map(s => formatModelName(s.model));
    const costs = sortedStats.map(s => s.totalCost || 0);
    const requests = sortedStats.map(s => s.requestCount || 0);

    // 颜色配置
    const colors = [
        '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
        '#ec4899', '#f43f5e', '#f97316', '#eab308',
        '#22c55e', '#14b8a6'
    ];

    const backgroundColors = sortedStats.map((_, i) => colors[i % colors.length]);

    // 费用饼图
    const costCtx = document.getElementById('cost-chart').getContext('2d');
    costChart = new Chart(costCtx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: costs,
                backgroundColor: backgroundColors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: '#94a3b8',
                        padding: 12,
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return context.label + ': $' + value.toFixed(4) + ' (' + percentage + '%)';
                        }
                    }
                }
            }
        }
    });

    // 请求数柱状图
    const requestsCtx = document.getElementById('requests-chart').getContext('2d');
    requestsChart = new Chart(requestsCtx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '请求数',
                data: requests,
                backgroundColor: backgroundColors,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(148, 163, 184, 0.1)'
                    },
                    ticks: {
                        color: '#94a3b8'
                    }
                },
                y: {
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#94a3b8'
                    }
                }
            }
        }
    });
}

function renderKeyStats(stats) {
    const list = document.getElementById('key-stats-list');

    if (!stats || stats.length === 0) {
        list.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">暂无数据</td></tr>';
        return;
    }

    // 按总费用从高到低排序
    const sortedStats = [...stats].sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0));

    list.innerHTML = sortedStats.map(function(stat) {
        return '<tr>' +
            '<td><span class="key-prefix-cell">' + (stat.apiKeyPrefix || '-') + '</span></td>' +
            '<td>' + (stat.apiKeyName || '-') + '</td>' +
            '<td>' + formatNumber(stat.requestCount) + '</td>' +
            '<td>' + formatNumber(stat.inputTokens) + '</td>' +
            '<td>' + formatNumber(stat.outputTokens) + '</td>' +
            '<td class="cost-cell total">$' + (stat.totalCost || 0).toFixed(4) + '</td>' +
            '<td>' +
            '<button class="btn btn-secondary btn-sm" onclick="viewKeyUsage(' + stat.apiKeyId + ')">查看详情</button> ' +
            '<button class="btn btn-secondary btn-sm" onclick="viewKeyLogs(' + stat.apiKeyId + ')">查看日志</button>' +
            '</td>' +
            '</tr>';
    }).join('');
}

function viewKeyUsage(keyId) {
    document.getElementById('usage-filter-key').value = keyId;
    currentKeyId = keyId;
    loadUsageStats();
}

function viewKeyLogs(keyId) {
    // 跳转到日志页面并带上 API Key 筛选参数
    const key = apiKeys.find(k => k.id === keyId);
    if (key) {
        window.location.href = '/pages/logs.html?apiKey=' + encodeURIComponent(key.keyPrefix);
    }
}

function resetFilters() {
    document.getElementById('usage-filter-key').value = '';
    document.getElementById('usage-filter-start').value = '';
    document.getElementById('usage-filter-end').value = '';
    currentKeyId = null;

    // 清除 URL 参数
    window.history.replaceState({}, '', window.location.pathname);

    loadUsageStats();
    loadTokensTimeline();
}

async function loadTokensTimeline() {
    const startDate = document.getElementById('usage-filter-start').value;
    const endDate = document.getElementById('usage-filter-end').value;

    let url = '/api/logs-stats/by-interval?interval=20';
    if (startDate) url += '&startDate=' + startDate;
    if (endDate) url += '&endDate=' + endDate;
    if (currentKeyId) url += '&apiKeyId=' + currentKeyId;

    try {
        const res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();

        if (result.success && result.data) {
            renderTokensTimelineChart(result.data);
        }
    } catch (err) {
        console.error('Load tokens timeline error:', err);
    }
}

function renderTokensTimelineChart(stats) {
    // 销毁旧图表
    if (tokensTimelineChart) {
        tokensTimelineChart.destroy();
        tokensTimelineChart = null;
    }

    if (!stats || stats.length === 0) {
        return;
    }

    const labels = stats.map(s => {
        const date = new Date(s.timeSlot);
        return date.toLocaleString('zh-CN', {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    });
    const inputTokens = stats.map(s => s.inputTokens || 0);
    const outputTokens = stats.map(s => s.outputTokens || 0);

    const ctx = document.getElementById('tokens-timeline-chart').getContext('2d');
    tokensTimelineChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '输入 Tokens',
                    data: inputTokens,
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    pointHoverRadius: 5
                },
                {
                    label: '输出 Tokens',
                    data: outputTokens,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.1)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2,
                    pointHoverRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#94a3b8',
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': ' + formatNumber(context.raw);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: {
                        color: 'rgba(148, 163, 184, 0.1)'
                    },
                    ticks: {
                        color: '#94a3b8',
                        maxRotation: 45,
                        minRotation: 45
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(148, 163, 184, 0.1)'
                    },
                    ticks: {
                        color: '#94a3b8',
                        callback: function(value) {
                            return formatNumber(value);
                        }
                    }
                }
            }
        }
    });
}

function formatModelName(model) {
    if (!model) return '-';
    const modelMap = {
        'claude-opus-4-5-20251101': 'Claude Opus 4.5',
        'claude-opus-4.5': 'Claude Opus 4.5',
        'claude-sonnet-4-20250514': 'Claude Sonnet 4',
        'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
        'claude-3-7-sonnet-20250219': 'Claude 3.7 Sonnet',
        'claude-3-5-sonnet-20241022': 'Claude 3.5 Sonnet',
        'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
        'claude-haiku-4-5': 'Claude Haiku 4.5',
        'claude-3-opus-20240229': 'Claude 3 Opus',
        'claude-3-sonnet-20240229': 'Claude 3 Sonnet',
        'claude-3-haiku-20240307': 'Claude 3 Haiku'
    };
    return modelMap[model] || model;
}

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(2) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(2) + 'K';
    }
    return num.toString();
}
