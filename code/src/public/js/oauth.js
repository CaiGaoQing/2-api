// ============ OAuth 页面 JS ============

let currentSessionId = null;
let pollInterval = null;
let currentProvider = null;

// 页面初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 检查认证
    if (!await checkAuth()) return;

    // 注入侧边栏
    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = getSidebarHTML();
        initSidebar('oauth');
        updateSidebarStats();
    }

    // 加载最近添加的账号
    loadRecentAccounts();
});

// 获取登录选项
function getOAuthOptions() {
    return {
        name: document.getElementById('credential-name').value.trim() || undefined,
        region: document.getElementById('region-select').value
    };
}

// 启动 Social Auth (Google/GitHub)
async function startSocialAuth(provider) {
    if (currentSessionId) {
        showToast('已有正在进行的登录，请先取消', 'warning');
        return;
    }

    const options = getOAuthOptions();
    currentProvider = provider;

    try {
        const res = await fetch('/api/oauth/social/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                provider: provider,
                ...options
            })
        });

        const result = await res.json();

        if (!result.success) {
            showToast(result.error || '启动登录失败', 'error');
            return;
        }

        currentSessionId = result.data.sessionId;

        // 显示状态区域
        showSocialAuthStatus(result.data);

        // 自动打开授权链接
        window.open(result.data.authUrl, '_blank');

        // 开始轮询状态
        startPolling();

        showToast(`已启动 ${provider} 登录，请在新窗口完成授权`, 'info');

    } catch (error) {
        showToast('启动登录失败: ' + error.message, 'error');
    }
}

// 显示 Social Auth 状态
function showSocialAuthStatus(data) {
    const statusEl = document.getElementById('oauth-status');
    statusEl.classList.add('active');

    document.getElementById('status-badge').innerHTML = '<span class="spinner"></span> 等待授权';
    document.getElementById('status-badge').className = 'status-badge pending';

    // 显示授权链接
    const authUrlItem = document.getElementById('auth-url-item');
    authUrlItem.style.display = 'flex';
    document.getElementById('auth-url').href = data.authUrl;
    document.getElementById('auth-url').textContent = '点击打开授权页面';

    // 隐藏用户代码（Social Auth 不需要）
    document.getElementById('user-code-item').style.display = 'none';
    document.getElementById('credential-id-item').style.display = 'none';
}

// 启动 Builder ID OAuth
async function startBuilderID() {
    if (currentSessionId) {
        showToast('已有正在进行的登录，请先取消', 'warning');
        return;
    }

    const options = getOAuthOptions();

    try {
        const res = await fetch('/api/oauth/builder-id/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(options)
        });

        const result = await res.json();

        if (!result.success) {
            showToast(result.error || '启动登录失败', 'error');
            return;
        }

        currentSessionId = result.data.sessionId;

        // 显示状态区域
        showBuilderIDStatus(result.data);

        // 自动打开授权链接
        window.open(result.data.verificationUriComplete, '_blank');

        // 开始轮询状态
        startPolling();

        showToast('已启动 Builder ID 登录，请在新窗口完成授权', 'info');

    } catch (error) {
        showToast('启动登录失败: ' + error.message, 'error');
    }
}

// 启动 Gemini Antigravity OAuth
async function startGeminiAuth() {
    const options = getOAuthOptions();

    try {
        const res = await fetch('/api/gemini/oauth/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ name: options.name })
        });

        const result = await res.json();

        if (!result.success) {
            showToast(result.error || '启动 Gemini 登录失败', 'error');
            return;
        }

        // 打开授权页面
        window.open(result.authUrl, '_blank', 'width=600,height=700');

        showToast('已启动 Gemini 登录，请在新窗口完成授权', 'info');

    } catch (error) {
        showToast('启动 Gemini 登录失败: ' + error.message, 'error');
    }
}

// 监听 Gemini OAuth 回调消息
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'gemini-oauth-success') {
        showToast(`Gemini 凭证 "${event.data.name}" 已添加`, 'success');
        loadRecentAccounts();
        updateSidebarStats();
    }
});

// 显示 Builder ID 状态
function showBuilderIDStatus(data) {
    const statusEl = document.getElementById('oauth-status');
    statusEl.classList.add('active');

    document.getElementById('status-badge').innerHTML = '<span class="spinner"></span> 等待授权';
    document.getElementById('status-badge').className = 'status-badge pending';

    // 显示授权链接
    const authUrlItem = document.getElementById('auth-url-item');
    authUrlItem.style.display = 'flex';
    document.getElementById('auth-url').href = data.verificationUriComplete;
    document.getElementById('auth-url').textContent = '点击打开授权页面';

    // 显示用户代码
    const userCodeItem = document.getElementById('user-code-item');
    userCodeItem.style.display = 'flex';
    document.getElementById('user-code').textContent = data.userCode;

    document.getElementById('credential-id-item').style.display = 'none';
}

// 开始轮询状态
function startPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
    }

    pollInterval = setInterval(async () => {
        if (!currentSessionId) {
            clearInterval(pollInterval);
            return;
        }

        try {
            const res = await fetch(`/api/oauth/session/${currentSessionId}`, {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });

            const result = await res.json();

            if (!result.success) {
                // 会话不存在或已过期
                clearInterval(pollInterval);
                currentSessionId = null;
                document.getElementById('status-badge').innerHTML = '会话已过期';
                document.getElementById('status-badge').className = 'status-badge error';
                return;
            }

            if (result.data.completed) {
                // 登录成功
                clearInterval(pollInterval);

                document.getElementById('status-badge').innerHTML = '✓ 登录成功';
                document.getElementById('status-badge').className = 'status-badge success';

                if (result.data.credentialId) {
                    document.getElementById('credential-id-item').style.display = 'flex';
                    document.getElementById('credential-id').textContent = result.data.credentialId;
                }

                showToast('登录成功！凭据已保存到数据库', 'success');

                // 刷新最近账号列表
                loadRecentAccounts();

                // 更新侧边栏统计
                updateSidebarStats();

                // 3秒后重置状态
                setTimeout(() => {
                    resetStatus();
                }, 3000);
            }

        } catch (error) {
            console.error('Poll error:', error);
        }
    }, 2000); // 每2秒轮询一次
}

// 取消 OAuth
async function cancelOAuth() {
    if (currentSessionId) {
        try {
            await fetch(`/api/oauth/session/${currentSessionId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
        } catch (e) {
            console.error('Cancel error:', e);
        }
    }

    resetStatus();
    showToast('已取消登录', 'info');
}

// 重置状态
function resetStatus() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
    currentSessionId = null;

    const statusEl = document.getElementById('oauth-status');
    statusEl.classList.remove('active');
}

// 复制授权链接
function copyAuthUrl() {
    const url = document.getElementById('auth-url').href;
    copyToClipboard(url);
}

// 加载最近添加的账号
async function loadRecentAccounts() {
    try {
        const res = await fetch('/api/credentials', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (!result.success) {
            return;
        }

        const accounts = result.data || [];

        // 按创建时间排序，取最近5个
        const recentAccounts = accounts
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 5);

        renderRecentAccounts(recentAccounts);

    } catch (error) {
        console.error('Load recent accounts error:', error);
    }
}

// 渲染最近账号列表
function renderRecentAccounts(accounts) {
    const listEl = document.getElementById('history-list');

    if (accounts.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                    <circle cx="9" cy="7" r="4"/>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <p>暂无最近添加的账号</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = accounts.map(account => {
        const providerName = getProviderName(account.authMethod);

        return `
            <div class="history-item">
                <div class="history-info">
                    <div class="history-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                        </svg>
                    </div>
                    <div class="history-details">
                        <h5>${escapeHtml(account.name)}</h5>
                        <span>${providerName} · ${formatDateTime(account.createdAt)}</span>
                    </div>
                </div>
                <div class="history-actions">
                    <button class="btn btn-secondary btn-sm" onclick="viewAccount(${account.id})">
                        查看
                    </button>
                    <button class="btn btn-secondary btn-sm" onclick="testAccount(${account.id})">
                        测试
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// 获取提供商名称
function getProviderName(authMethod) {
    if (authMethod === 'builder-id') {
        return 'Builder ID';
    }
    if (authMethod === 'IdC') {
        return 'IAM Identity Center';
    }
    return 'Social';
}

// 查看账号
function viewAccount(id) {
    window.location.href = `/pages/accounts.html?id=${id}`;
}

// 测试账号
async function testAccount(id) {
    showToast('正在测试账号...', 'info');

    try {
        const res = await fetch(`/api/credentials/${id}/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (result.success) {
            showToast('账号测试成功！', 'success');
        } else {
            showToast('账号测试失败: ' + result.error, 'error');
        }
    } catch (error) {
        showToast('测试失败: ' + error.message, 'error');
    }
}

// HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
