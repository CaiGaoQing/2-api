// ============ 账号详情页面 JS ============

let currentCredential = null;
let accountId = null;
let tokenVisible = { access: false, refresh: false };

// 页面初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 检查认证
    if (!await checkAuth()) return;

    // 注入侧边栏
    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
        sidebarContainer.innerHTML = getSidebarHTML();
        initSidebar('accounts');
        updateSidebarStats();
    }

    // 获取 URL 参数中的账号 ID
    const urlParams = new URLSearchParams(window.location.search);
    accountId = urlParams.get('id');

    if (!accountId) {
        showToast('未指定账号 ID', 'error');
        setTimeout(() => goBack(), 1500);
        return;
    }

    // 加载账号详情
    await loadAccountDetail();
});

// 返回列表
function goBack() {
    window.location.href = '/pages/accounts.html';
}

// 加载账号详情
async function loadAccountDetail() {
    try {
        const res = await fetch(`/api/credentials/${accountId}?full=true`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (!result.success) {
            showToast(result.error || '加载失败', 'error');
            setTimeout(() => goBack(), 1500);
            return;
        }

        currentCredential = result.data;
        renderAccountDetail();

    } catch (error) {
        showToast('加载账号详情失败: ' + error.message, 'error');
        setTimeout(() => goBack(), 1500);
    }
}

// 渲染账号详情
function renderAccountDetail() {
    const cred = currentCredential;

    // 隐藏加载状态，显示内容
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('detail-content').style.display = 'block';

    // 更新页面标题
    document.getElementById('account-subtitle').textContent = cred.email || cred.name || '账号详情';

    // 基本信息
    document.getElementById('detail-name').textContent = cred.name || '-';
    document.getElementById('detail-email').textContent = cred.email || '-';

    // 提供商
    const providerEl = document.getElementById('detail-provider');
    const provider = cred.provider || 'Unknown';
    providerEl.innerHTML = `<span class="pder-badge ${provider.toLowerCase()}">${provider}</span>`;

    // 认证方式
    const authMethodMap = {
        'social': 'Social (Google/GitHub)',
        'builder-id': 'AWS Builder ID',
        'IdC': 'IAM Identity Center'
    };
    document.getElementById('detail-auth-method').textContent = authMethodMap[cred.authMethod] || cred.authMethod || '-';

    // 区域
    document.getElementById('detail-region').textContent = cred.region || 'us-east-1';

    // 状态
    const statusEl = document.getElementById('detail-status');
    const statusClass = cred.status === 'error' ? 'error' : cred.status === 'warning' ? 'warning' : 'normal';
    const statusText = statusClass === 'normal' ? '正常' : statusClass === 'warning' ? '警告' : '异常';
    statusEl.innerHTML = `<span class="status-badge ${statusClass}">${statusText}</span>`;
    if (cred.isActive) {
        statusEl.innerHTML += ` <span class="status-badge active">活跃</span>`;
    }

    // 时间
    document.getElementById('detail-created').textContent = formatDateTime(cred.createdAt);
    document.getElementById('detail-expires').textContent = formatExpireTime(cred.expiresAt);

    // Token 信息（默认隐藏）
    document.getElementById('detail-accken').textContent = maskToken(cred.accessToken);
    document.getElementById('detail-access-token').dataset.token = cred.accessToken || '';

    document.getElementById('detail-refresh-token').textContent = maskToken(cred.refreshToken);
    document.getElementById('detail-refresh-token').dataset.token = cred.refreshToken || '';

    // Profile ARN（仅 Social Auth 显示）
    if (cred.profileArn) {
        document.getElementById('profile-arn-section').style.display = 'block';
        document.getElementById('detail-profile-arn').textContent = cred.profileArn;
    }
}

// 格式化过期时间
function formatExpireTime(dateStr) {
    if (!dateStr) re
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date - now;

    if (diff < 0) {
        return `已过期 (${formatDateTime(dateStr)})`;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours < 1) {
        return `${minutes} 分钟后过期`;
    } else if (hours < 24) {
        return `${hours} 小时 ${minutes} 分钟后过期`;
    } else {
        const days = Math.floor(hours / 24);
        return `${days} 天后过期 (${formatDateTime(dateStr)})`;
    }
}

// 遮蔽 Token
function maskToken(token) {
    if (!token) return '-';
    if (token.length <= 20) return '••••••••••••••••';
    return token.substring(0, 10) + '••••••••••••••••' + token.substring(token.length - 10);
}

// 切换 Token 显示
function toggleToken(type) {
    tokenVisible[type] = !tokenVisible[type];
    const el = document.getElementById(`detail-${type}-token`);
    const token = el.dataset.token;

    if (tokenVisible[type]) {
        el.textContent = token || '-';
    } else {
        el.textContent = maskToken(token);
    }
}

// 复制 Token
function copyToken(type) {
    const el = document.getElementById(`detail-${type}-token`);
    const ken = el.dataset.token;
    if (token) {
        copyToClipboard(token);
    } else {
        showToast('Token 为空', 'warning');
    }
}

// 复制 Profile ARN
function copyProfileArn() {
    const arn = document.getElementById('detail-profile-arn').textContent;
    if (arn && arn !== '-') {
        copyToClipboard(arn);
    }
}

// 刷新 Token
async function refreshToken() {
    showToast('正在刷新 Token...', 'warning');

    try {
        const res = await fetch(`/api/credentials/${accountId}/refresh`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (result.success) {
            showToast('Token 刷新成功', 'success');
            await loadAccountDetail();
        } else {
            showToast('Token 刷新失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('Token 刷新失败: ' + error.message, 'error');
    }
}

// 测试连接
async function testConnection() {
    showToast('正在测试连接...', 'warning');

    try {
        const res = await fetch(`/api/credentials/${accountId}/test`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (result.success) {
            showToast('连接测试成功', 'success');
        } else {
            showToast('连接测试失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('连接测试失败: ' + error.message, 'error');
    }
}

// 刷新用量
async function refreshUsage() {
    const usageContent = document.getElementById('usage-content');
    usageContent.innerHTML = '<p style="color: var(--text-muted);">加载中...</p>';

    try {
        const res = await fetch(`/api/credentials/${accountId}/usage`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (result.success && result.data) {
            renderUsage(result.data);
        } else {
            usageContent.innerHTML = `<p style="color: var(--accent-danger);">获取用量失败: ${result.error || '未知错误'}</p>`;
        }
    } catch (error) {
        usageContent.innerHTML = `<p style="color: var(--accent-danger);">获取用量失败: ${error.message}</p>`;
    }
}

// 封禁检测
async function checkBanStatus() {
    const banArea = document.getElementById('ban-status-area');
    banArea.innerHTML = '<div class="ban-status checking"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>正在检测封禁状态...</div>';

    try {
        const res = await fetch(`/api/credentials/${accountId}/ban-check`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const result = await res.json();

        if (result.success) {
            const data = result.data;
            if (data.status === 'active') {
                banArea.innerHTML = '<div class="ban-status active"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>账号状态正常，Token 已刷新</div>';
                // 刷新用量和订阅信息
                if (data.usage) {
                    renderSubscriptionInfo(data.usage);
                    renderUsage(data.usage);
                }
                showToast('账号状态正常', 'success');
            } else if (data.status === 'banned') {
                banArea.innerHTML = `<div class="ban-status banned"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>账号已被封禁: ${data.message || '未知原因'}</div>`;
                showToast('账号已被封禁', 'error');
            } else {
                banArea.innerHTML = `<div class="ban-status checking"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${data.status}: ${data.message || ''}</div>`;
                showToast('检测结果: ' + data.status, 'warning');
            }
        } else {
            banArea.innerHTML = `<div class="ban-status banned">检测失败: ${result.error}</div>`;
            showToast('检测失败', 'error');
        }
    } catch (error) {
        banArea.innerHTML = `<div class="ban-status banned">检测失败: ${error.message}</div>`;
        showToast('检测失败: ' + error.message, 'error');
    }
}

// 渲染订阅信息
function renderSubscriptionInfo(usage) {
    const subArea = document.getElementById('subscription-area');
    const subInfo = usage.subscriptionInfo;

    let subTitle = 'Free';
    let subClass = 'free';
    let trialText = '';

    if (subInfo) {
        subTitle = subInfo.subscriptionTitle || subInfo.type || 'Free';
        if (subTitle.includes('PRO+') || subTitle.includes('Pro+')) {
            subClass = 'pro-plus';
        } else if (subTitle.includes('PRO') || subTitle.includes('Pro')) {
            subClass = 'pro';
        }
    }

    // 检查试用状态
    if (usage.usageBreakdownList && usage.usageBreakdownList.length > 0) {
        const breakdown = usage.usageBreakdownList[0];
        if (breakdown.freeTrialInfo && breakdown.freeTrialInfo.freeTrialStatus === 'ACTIVE') {
            trialText = '<span class="subscription-badge trial">试用中</span>';
        }
    }

    subArea.innerHTML = `
        <div class="subscription-info">
            <span style="font-size: 13px; color: var(--text-muted);">订阅类型:</span>
            <span class="subscription-badge ${subClass}">${subTitle}</span>
            ${trialText}
        </div>
    `;
}

// 渲染用量信息（参考 kiro-account-manager-main 的 AccountDetailModal）
function renderUsage(usage) {
    const usageContent = document.getElementById('usage-content');

    // 渲染订阅信息
    renderSubscriptionInfo(usage);

    if (!usage.usageBreakdownList || usage.usageBreakdownList.length === 0) {
        usageContent.innerHTML = '<p style="color: var(--text-muted);">暂无用量数据</p>';
        return;
    }

    let html = '';

    usage.usageBreakdownList.forEach(breakdown => {
        const displayName = breakdown.displayNamePlural || breakdown.displayName || 'Credits';

        // 基础配额
        const baseUsed = breakdown.currentUsageWithPrecision || breakdown.currentUsage || 0;
        const baseQuota = breakdown.usageLimitWithPrecision || breakdown.usageLimit || 50;

        // 试用配额
        const freeTrialInfo = breakdown.freeTrialInfo;
        const isFreeTrialActive = freeTrialInfo && freeTrialInfo.freeTrialStatus === 'ACTIVE';
        const trialUsed = isFreeTrialActive ? (freeTrialInfo.currentUsageWithPrecision || freeTrialInfo.currentUsage || 0) : 0;
        const trialQuota = isFreeTrialActive ? (freeTrialInfo.usageLimitWithPrecision || freeTrialInfo.usageLimit || 0) : 0;

        // 奖励配额（bonuses 是数组）
        const bonuses = breakdown.bonuses || [];
        const bonusTotalQuota = bonuses.reduce((sum, b) => sum + (b.usageLimit || 0), 0);
        const bonusTotalUsed = bonuses.reduce((sum, b) => sum + (b.currentUsage || 0), 0);

        // 总配额 = 基础 + 试用 + 奖励
        const totalQuota = baseQuota + trialQuota + bonusTotalQuota;
        const totalUsed = baseUsed + trialUsed + bonusTotalUsed;
        const totalPercent = totalQuota > 0 ? Math.min(100, Math.round((totalUsed / totalQuota) * 100)) : 0;
        const totalRemaining = totalQuota - totalUsed;

        const barClass = totalPercent > 80 ? 'danger' : totalPercent > 50 ? 'warning' : '';
        const barColor = totalPercent > 80 ? 'var(--accent-danger)' : totalPercent > 50 ? 'var(--accent-warning)' : 'var(--accent-primary)';

        let resetText = '';
        if (breakdown.nextDateReset) {
            const resetDate = new Date(breakdown.nextDateReset * 1000);
            const now = new Date();
            const diffDays = Math.floor((resetDate - now) / (1000 * 60 * 60 * 24));
            resetText = diffDays <= 0 ? '今天重置' : diffDays === 1 ? '明天重置' : `${diffDays} 天后重置 (${formatDateTime(resetDate.toISOString())})`;
        }

        const trialBadge = isFreeTrialActive ? '<span style="background: var(--accent-success-bg); color: var(--accent-success); padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px;">试用中</span>' : '';

        // 总览区域
        html += `
            <div class="usage-section">
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <span style="font-weight: 500; color: var(--text-primary);">${displayName}${trialBadge}</span>
                    <span style="font-size: 18px; font-weight: 700; color: ${barColor};">${totalPercent}%</span>
                </div>
                <div style="display: flex; align-items: baseline; justify-content: space-between; margin: 4px 0 8px;">
                    <div>
                        <span style="font-size: 28px; font-weight: 700; color: var(--text-primary);">${Math.round(totalUsed)}</span>
                        <span style="color: var(--text-muted); margin-left: 4px;">/ ${Math.round(totalQuota)}</span>
                    </div>
                </div>
                <div class="usage-bar-container">
                    <div class="usage-bar" style="height: 10px;">
                        <div class="usage-bar-fill ${barClass}" style="width: ${Math.min(totalPercent, 100)}%"></div>
                    </div>
                </div>

                <!-- 三栏分项：基础 / 试用 / 奖励 -->
                <div class="usage-breakdown-grid" style="margin-top: 12px;">
                    <div class="usage-breakdown-item" style="background: var(--bg-tertiary); border-radius: 8px; padding: 10px;">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                            <div style="width: 8px; height: 8px; background: var(--accent-primary); border-radius: 50%;"></div>
                            <span style="font-size: 11px; color: var(--text-muted);">基础配额</span>
                        </div>
                        <div class="usage-breakdown-value" title="${breakdown.currentUsageWithPrecision != null ? '精确值: ' + breakdown.currentUsageWithPrecision + ' / ' + breakdown.usageLimitWithPrecision : ''}">${baseUsed} / ${baseQuota}</div>
                        ${breakdown.nextDateReset ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${new Date(breakdown.nextDateReset * 1000).toLocaleDateString()} 重置</div>` : ''}
                    </div>
                    <div class="usage-breakdown-item" style="background: ${isFreeTrialActive ? 'rgba(6, 182, 212, 0.1)' : 'var(--bg-tertiary)'}; border-radius: 8px; padding: 10px;">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                            <div style="width: 8px; height: 8px; background: ${isFreeTrialActive ? '#06b6d4' : 'var(--text-muted)'}; border-radius: 50%;"></div>
                            <span style="font-size: 11px; color: var(--text-muted);">试用额度</span>
                            ${freeTrialInfo?.freeTrialStatus ? `<span style="font-size: 10px; color: ${freeTrialInfo.freeTrialStatus === 'ACTIVE' ? '#06b6d4' : 'var(--text-muted)'};">(${freeTrialInfo.freeTrialStatus})</span>` : ''}
                        </div>
                        <div class="usage-breakdown-value" title="${freeTrialInfo?.currentUsageWithPrecision != null ? '精确值: ' + freeTrialInfo.currentUsageWithPrecision + ' / ' + freeTrialInfo.usageLimitWithPrecision : ''}">${trialQuota ? trialUsed + ' / ' + trialQuota : '-'}</div>
                        ${freeTrialInfo?.freeTrialExpiry ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${new Date(freeTrialInfo.freeTrialExpiry * 1000).toLocaleDateString()} 到期</div>` : ''}
                    </div>
                    <div class="usage-breakdown-item" style="background: ${bonusTotalQuota > 0 ? 'rgba(139, 92, 246, 0.1)' : 'var(--bg-tertiary)'}; border-radius: 8px; padding: 10px;">
                        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 4px;">
                            <div style="width: 8px; height: 8px; background: ${bonusTotalQuota > 0 ? '#8b5cf6' : 'var(--text-muted)'}; border-radius: 50%;"></div>
                            <span style="font-size: 11px; color: var(--text-muted);">奖励总计</span>
                        </div>
                        <div class="usage-breakdown-value">${bonusTotalQuota > 0 ? Math.round(bonusTotalUsed) + ' / ' + Math.round(bonusTotalQuota) : '-'}</div>
                        ${bonuses.length > 0 ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${bonuses.length} 个奖励</div>` : ''}
                    </div>
                </div>

                <!-- Bonuses 详细列表 -->
                ${bonuses.length > 0 ? `
                <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                    <div style="font-size: 12px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px;">奖励详情</div>
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        ${bonuses.map(bonus => {
                            const bonusStatusClass = bonus.status === 'ACTIVE' ? 'background: rgba(34,197,94,0.15); color: #22c55e;' :
                                bonus.status === 'EXHAUSTED' ? 'background: rgba(107,114,128,0.15); color: #6b7280;' :
                                'background: rgba(234,179,8,0.15); color: #eab308;';
                            return `
                            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-radius: 8px; background: ${bonus.status === 'ACTIVE' ? 'rgba(139,92,246,0.08)' : bonus.status === 'EXHAUSTED' ? 'rgba(107,114,128,0.08)' : 'var(--bg-tertiary)'};">
                                <div style="flex: 1; min-width: 0;">
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span style="font-size: 13px; font-weight: 500; color: var(--text-primary);">${bonus.displayName || bonus.bonusCode || '奖励'}</span>
                                        <span style="font-size: 11px; padding: 1px 6px; border-radius: 4px; ${bonusStatusClass}">${bonus.status || 'UNKNOWN'}</span>
                                    </div>
                                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                                        ${bonus.description ? `<span>${bonus.description} · </span>` : ''}
                                        ${bonus.redeemedAt ? `<span>领取: ${new Date(bonus.redeemedAt * 1000).toLocaleDateString()} · </span>` : ''}
                                        ${bonus.expiresAt ? `<span>到期: ${new Date(bonus.expiresAt * 1000).toLocaleDateString()}</span>` : ''}
                                    </div>
                                </div>
                                <div style="text-align: right; margin-left: 12px;">
                                    <div style="font-size: 13px; font-weight: 600; color: var(--text-primary);">${Math.round(bonus.currentUsage || 0)} / ${Math.round(bonus.usageLimit || 0)}</div>
                                    ${bonus.bonusCode ? `<div style="font-size: 11px; color: var(--text-muted);">${bonus.bonusCode}</div>` : ''}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>
                </div>
                ` : ''}

                <!-- 订阅详细信息 -->
                ${usage.subscriptionInfo ? `
                <div style="margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color); display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; font-size: 13px;">
                    ${usage.userInfo?.userId ? `<div style="display: flex; justify-content: space-between;"><span style="color: var(--text-muted);">用户ID</span><span style="color: var(--text-primary); font-family: monospace; font-size: 11px;" title="${usage.userInfo.userId}">${usage.userInfo.userId.slice(-12)}</span></div>` : ''}
                    ${usage.userInfo?.email ? `<div style="display: flex; justify-content: space-between;"><span style="color: var(--text-muted);">邮箱</span><span style="color: var(--text-primary); font-size: 12px;">${usage.userInfo.email}</span></div>` : ''}
                    ${usage.subscriptionInfo.type ? `<div style="display: flex; justify-content: space-between;"><span style="color: var(--text-muted);">订阅类型</span><span style="color: var(--text-primary); font-family: monospace; font-size: 11px;" title="${usage.subscriptionInfo.type}">${usage.subscriptionInfo.type}</span></div>` : ''}
                    ${usage.subscriptionInfo.upgradeCapability ? `<div style="display: flex; justify-content: space-between;"><span style="color: var(--text-muted);">可升级</span><span style="color: var(--text-primary);">${usage.subscriptionInfo.upgradeCapability === 'UPGRADE_CAPABLE' ? '是' : '否'}</span></div>` : ''}
                    ${breakdown.overageRate ? `<div style="display: flex; justify-content: space-between;"><span style="color: var(--text-muted);">超额费率</span><span style="color: var(--text-primary);">$${breakdown.overageRate}/${breakdown.unit || '次'}</span></div>` : ''}
                    ${breakdown.overageCap ? `<div style="display: flex; justify-content: space-between;"><span style="color: var(--text-muted);">超额上限</span><span style="color: var(--text-primary);">${breakdown.overageCap}</span></div>` : ''}
                </div>
                ` : ''}

                ${resetText ? `<div style="margin-top: 8px; font-size: 12px; color: var(--text-muted);"><strong>重置时间:</strong> ${resetText}</div>` : ''}
            </div>
        `;
    });

    usageContent.innerHTML = html;
}

// 开始对话
function startChat() {
    window.location.href = `/pages/chat.html?account=${accountId}`;
}

// 删除账号
async function deleteAccount() {
    if (!confirm('确定要删除此账号吗？此操作不可恢复。')) {
        return;
    }

    try {
        const res = await fetch(`/api/credentials/${accountId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });

        const result = await res.json();

        if (result.success) {
            showToast('账号已删除', 'success');
            setTimeout(() => goBack(), 1000);
        } else {
            showToast('删除失败: ' + (result.error || '未知错误'), 'error');
        }
    } catch (error) {
        showToast('删除失败: ' + error.message, 'error');
    }
}
