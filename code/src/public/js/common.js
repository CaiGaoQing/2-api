// ============ 公共状态 ============
let authToken = localStorage.getItem('authToken');

// 站点设置（全局）- 先尝试从 localStorage 读取缓存
window.siteSettings = JSON.parse(localStorage.getItem('siteSettings')) || {
    siteName: 'Kiro',
    siteLogo: 'K',
    siteSubtitle: 'Account Manager'
};

// ============ 站点设置 ============
async function loadSiteSettings() {
    try {
        const res = await fetch('/api/site-settings');
        const data = await res.json();
        if (data.success && data.data) {
            window.siteSettings = data.data;
            // 缓存到 localStorage
            localStorage.setItem('siteSettings', JSON.stringify(data.data));
            // 更新页面上的站点信息
            updateSiteSettingsUI();
        }
    } catch (e) {
        console.error('Load site settings error:', e);
    }
    return window.siteSettings;
}

// 更新页面上所有使用站点设置的元素
function updateSiteSettingsUI() {
    const settings = window.siteSettings;

    // 更新页面 title（替换 Kiro 为配置的站点名称）
    const currentTitle = document.title;
    if (currentTitle.includes('Kiro')) {
        document.title = currentTitle.replace(/Kiro/g, settings.siteName);
    } else if (!currentTitle.includes(settings.siteName)) {
        // 如果 title 不包含站点名称，追加
        const pageName = currentTitle.split(' - ')[0] || currentTitle;
        document.title = `${pageName} - ${settings.siteName} ${settings.siteSubtitle}`;
    }

    // 更新侧边栏 logo
    const logoIcon = document.querySelector('.sidebar .logo-icon');
    const logoText = document.querySelector('.sidebar .logo-text');
    const logoSubtitle = document.querySelector('.sidebar .logo-subtitle');

    if (logoIcon) logoIcon.textContent = settings.siteLogo;
    if (logoText) logoText.textContent = settings.siteName.toUpperCase();
    if (logoSubtitle) logoSubtitle.textContent = settings.siteSubtitle;

    // 更新版本信息
    const versionInfo = document.querySelector('.version-info');
    if (versionInfo) versionInfo.textContent = `${settings.siteName} Manager v1.0.0`;

    // Kiro 账号菜单项固定名称，不随 siteName 变化

    // 更新页面副标题中的 "Kiro"
    const pageSubtitle = document.querySelector('.page-subtitle');
    if (pageSubtitle && pageSubtitle.textContent.includes('Kiro')) {
        pageSubtitle.textContent = pageSubtitle.textContent.replace(/Kiro/g, settings.siteName);
    }
}

// ============ 认证相关 ============
async function checkAuth() {
    if (!authToken) {
        window.location.href = '/login.html';
        return false;
    }
    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!res.ok) {
            localStorage.removeItem('authToken');
            window.location.href = '/login.html';
            return false;
        }
        return true;
    } catch (e) {
        return false;
    }
}

function logout() {
    fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` }
    }).finally(() => {
        localStorage.removeItem('authToken');
        window.location.href = '/login.html';
    });
}

// ============ Toast 提示 ============
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = {
        success: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        warning: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        ${icons[type] || icons.info}
        <span class="toast-message">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
        </button>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

// ============ 工具函数 ============
function parseDateTime(dateStr) {
    if (!dateStr) return null;
    // 如果是 MySQL 格式 (YYYY-MM-DD HH:MM:SS)，直接解析为本地时间，不做时区转换
    if (typeof dateStr === 'string' && !dateStr.includes('T') && !dateStr.includes('Z') && !dateStr.includes('+')) {
        return new Date(dateStr.replace(' ', 'T'));
    }
    return new Date(dateStr);
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const date = parseDateTime(dateStr);
    // 直接格式化显示，不做时区转换
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return year + '/' + month + '/' + day + ' ' + hours + ':' + minutes;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const date = parseDateTime(dateStr);
    return date.toLocaleDateString('zh-CN');
}

function copyToClipboard(text) {
    // 优先使用 navigator.clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('已复制到剪贴板', 'success');
        }).catch(() => {
            // 如果失败，使用备用方案
            fallbackCopyToClipboard(text);
        });
    } else {
        // 不支持 clipboard API，使用备用方案
        fallbackCopyToClipboard(text);
    }
}

function fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            showToast('已复制到剪贴板', 'success');
        } else {
            showToast('复制失败', 'error');
        }
    } catch (err) {
        showToast('复制失败', 'error');
    }
    document.body.removeChild(textArea);
}

// ============ 侧边栏导航 ============
function initSidebar(currentPage) {
    // 设置当前页面高亮 - 支持一级和二级菜单
    document.querySelectorAll('.nav-item, .nav-subitem').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.page === currentPage) {
            item.classList.add('active');
        }
    });

    // 导航点击事件 - 支持一级和二级菜单
    document.querySelectorAll('.nav-item, .nav-subitem').forEach(item => {
        item.addEventListener('click', (e) => {
            const page = item.dataset.page;
            if (page) {
                e.preventDefault();
                navigateTo(page);
            }
            // 没有 data-page 的链接允许默认行为（如外部链接）
        });
    });

    // 菜单收缩功能
    initMenuCollapse();

    // 登出按钮
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }
}

// 初始化菜单收缩功能
function initMenuCollapse() {
    // 从localStorage读取收缩状态
    const collapsedSections = JSON.parse(localStorage.getItem('collapsedSections') || '[]');

    // 为所有可收缩的标题添加点击事件
    document.querySelectorAll('.nav-subsection-title.collapsible').forEach(title => {
        const targetId = title.dataset.target;
        const content = document.getElementById(targetId);

        if (!content) return;

        // 恢复之前的收缩状态
        if (collapsedSections.includes(targetId)) {
            title.classList.add('collapsed');
            content.classList.add('collapsed');
        }

        // 添加点击事件
        title.addEventListener('click', (e) => {
            e.preventDefault();
            toggleMenuSection(targetId);
        });
    });
}

// 切换菜单分组的展开/收缩状态
function toggleMenuSection(targetId) {
    const title = document.querySelector(`[data-target="${targetId}"]`);
    const content = document.getElementById(targetId);

    if (!title || !content) return;

    const isCollapsed = title.classList.contains('collapsed');

    if (isCollapsed) {
        // 展开
        title.classList.remove('collapsed');
        content.classList.remove('collapsed');
        removeFromCollapsedSections(targetId);
    } else {
        // 收缩
        title.classList.add('collapsed');
        content.classList.add('collapsed');
        addToCollapsedSections(targetId);
    }
}

// 添加到收缩列表
function addToCollapsedSections(sectionId) {
    const collapsedSections = JSON.parse(localStorage.getItem('collapsedSections') || '[]');
    if (!collapsedSections.includes(sectionId)) {
        collapsedSections.push(sectionId);
        localStorage.setItem('collapsedSections', JSON.stringify(collapsedSections));
    }
}

// 从收缩列表移除
function removeFromCollapsedSections(sectionId) {
    const collapsedSections = JSON.parse(localStorage.getItem('collapsedSections') || '[]');
    const index = collapsedSections.indexOf(sectionId);
    if (index > -1) {
        collapsedSections.splice(index, 1);
        localStorage.setItem('collapsedSections', JSON.stringify(collapsedSections));
    }
}

function navigateTo(page) {
    const pageMap = {
        'accounts': '/pages/accounts.html',
        'gemini': '/pages/gemini.html',
        'orchids': '/pages/orchids.html',
        'ami': '/pages/ami.html',
        'warp': '/pages/warp.html',
        'vertex': '/pages/vertex.html',
        'bedrock': '/pages/bedrock.html',
        'codex': '/pages/codex.html',
        'flow-tokens': '/pages/flow-tokens.html',
        'grok': '/pages/grok.html',
        'krater': '/pages/krater.html',
        'direct': '/pages/direct.html',
        'outlook': '/pages/outlook.html',
        'full-accounts': '/pages/full-accounts.html',
        'chat': '/pages/chat.html',
        'image-gen': '/pages/image-gen.html',
        'error-accounts': '/pages/error-accounts.html',
        'api-keys': '/pages/api-keys.html',
        'packages': '/pages/packages.html',
        'redemption-codes': '/pages/redemption-codes.html',
        'usage': '/pages/usage.html',
        'ranking': '/pages/ranking.html',
        'logs': '/pages/logs.html',
        'error-logs': '/pages/error-logs.html',
        'proxy': '/pages/proxy.html',
        'oauth': '/pages/oauth.html',
        'change-password': '/pages/change-password.html',
        'trial-admin': '/pages/trial-admin.html',
        'site-settings': '/pages/site-settings.html',
        'channels': '/pages/channels.html',
        'pricing': '/pages/pricing.html',
        'dashboard': '/pages/accounts.html',
        'rules': '/pages/accounts.html',
        'settings': '/pages/accounts.html',
        'about': '/pages/accounts.html'
    };
    const url = pageMap[page] || '/pages/accounts.html';
    window.location.href = url;
}

// ============ 侧边栏 HTML 生成 ============
function getSidebarHTML(stats = { total: 0, active: 0, error: 0 }) {
    const settings = window.siteSettings || { siteName: 'Kiro', siteLogo: 'K', siteSubtitle: 'Account Manager' };
    return `
    <aside class="sidebar" id="sidebar">
        <div class="sidebar-header">
            <div class="logo">
                <div class="logo-icon">${settings.siteLogo}</div>
                <div>
                    <div class="logo-text">${settings.siteName.toUpperCase()}</div>
                    <div class="logo-subtitle">${settings.siteSubtitle}</div>
                </div>
            </div>
        </div>
        <nav class="sidebar-nav">
            <!-- 账号管理 -->
            <div class="nav-subsection">
                <div class="nav-subsection-title collapsible" data-target="account-management">
                    <span>账号管理</span>
                    <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="nav-subsection-content" id="account-management">
                    <a href="#" class="nav-item nav-subitem" data-page="accounts">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                        </svg>
                        Kiro 账号
                        <span class="nav-badge" id="nav-accounts-count">${stats.total}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="gemini">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                        Gemini 账号
                        <span class="nav-badge" id="nav-gemini-count">${stats.gemini || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="vertex">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                            <path d="M2 17l10 5 10-5"/>
                            <path d="M2 12l10 5 10-5"/>
                        </svg>
                        Vertex AI
                        <span class="nav-badge" id="nav-vertex-count">${stats.vertex || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="bedrock">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                            <line x1="12" y1="22.08" x2="12" y2="12"/>
                        </svg>
                        Bedrock
                        <span class="nav-badge" id="nav-bedrock-count">${stats.bedrock || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="codex">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                            <path d="M2 17l10 5 10-5"/>
                            <path d="M2 12l10 5 10-5"/>
                        </svg>
                        Codex 账号
                        <span class="nav-badge" id="nav-codex-count">${stats.codex || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="orchids">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                            <path d="M2 17l10 5 10-5"/>
                            <path d="M2 12l10 5 10-5"/>
                        </svg>
                        Orchids 账号
                        <span class="nav-badge" id="nav-orchids-count">${stats.orchids || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="ami">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 16v-4"/>
                            <path d="M12 8h.01"/>
                        </svg>
                        AMI 账号
                        <span class="nav-badge" id="nav-ami-count">${stats.ami || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="warp">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                        </svg>
                        Warp 账号
                        <span class="nav-badge" id="nav-warp-count">${stats.warp || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="oauth">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                            <polyline points="10 17 15 12 10 7"/>
                            <line x1="15" y1="12" x2="3" y2="12"/>
                        </svg>
                        OAuth 登录
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="error-accounts">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        异常账号
                        <span class="nav-badge error" id="nav-error-count">${stats.error}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="grok">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                            <path d="M8 12l3 3 5-5"/>
                        </svg>
                        Grok Token
                        <span class="nav-badge" id="nav-grok-count">${stats.grok || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="krater">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                            <polyline points="7.5 4.21 12 6.81 16.5 4.21"/>
                            <polyline points="7.5 19.79 7.5 14.6 3 12"/>
                            <polyline points="21 12 16.5 14.6 16.5 19.79"/>
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                            <line x1="12" y1="22.08" x2="12" y2="12"/>
                        </svg>
                        Krater
                        <span class="nav-badge" id="nav-krater-count">${stats.krater || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="direct">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="15 14 20 9 15 4"/>
                            <path d="M4 20v-7a4 4 0 0 1 4-4h12"/>
                        </svg>
                        Direct
                        <span class="nav-badge" id="nav-direct-count">${stats.direct || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="outlook">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                            <polyline points="22,6 12,13 2,6"/>
                        </svg>
                        Outlook 邮箱
                        <span class="nav-badge" id="nav-outlook-count">${stats.outlook || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="flow-tokens">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/>
                            <line x1="7" y1="2" x2="7" y2="22"/>
                            <line x1="17" y1="2" x2="17" y2="22"/>
                            <line x1="2" y1="12" x2="22" y2="12"/>
                            <line x1="2" y1="7" x2="7" y2="7"/>
                            <line x1="2" y1="17" x2="7" y2="17"/>
                            <line x1="17" y1="17" x2="22" y2="17"/>
                            <line x1="17" y1="7" x2="22" y2="7"/>
                        </svg>
                        Flow Token
                        <span class="nav-badge" id="nav-flow-count">${stats.flow || 0}</span>
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="full-accounts">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                            <path d="M2 17l10 5 10-5"/>
                            <path d="M2 12l10 5 10-5"/>
                        </svg>
                        满血号池
                        <span class="nav-badge" id="nav-full-count">${stats.full || 0}</span>
                    </a>
                </div>
            </div>

            <!-- 系统管理 -->
            <div class="nav-subsection">
                <div class="nav-subsection-title collapsible" data-target="system-management">
                    <span>系统管理</span>
                    <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="nav-subsection-content" id="system-management">
                    <a href="#" class="nav-item nav-subitem" data-page="api-keys">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                        </svg>
                        API 密钥
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="packages">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <line x1="3" y1="9" x2="21" y2="9"/>
                            <line x1="9" y1="21" x2="9" y2="9"/>
                        </svg>
                        套餐管理
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="redemption-codes">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"/>
                            <path d="M4 6v12c0 1.1.9 2 2 2h14v-4"/>
                            <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"/>
                        </svg>
                        兑换码管理
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="usage">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                        </svg>
                        用量统计
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="ranking">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 20V10M12 20V4M6 20v-6"/>
                        </svg>
                        使用排行
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="trial-admin">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="8.5" cy="7" r="4"/>
                            <polyline points="17 11 19 13 23 9"/>
                        </svg>
                        试用审批
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="chat">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                        对话测试
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="image-gen">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <circle cx="8.5" cy="8.5" r="1.5"/>
                            <polyline points="21 15 16 10 5 21"/>
                        </svg>
                        AI 生图
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="site-settings">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                            <line x1="3" y1="9" x2="21" y2="9"/>
                            <line x1="9" y1="21" x2="9" y2="9"/>
                        </svg>
                        站点设置
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="channels">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M2 20h.01"/>
                            <path d="M7 20v-4"/>
                            <path d="M12 20v-8"/>
                            <path d="M17 20V8"/>
                            <path d="M22 4v16"/>
                        </svg>
                        通道管理
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="pricing">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.768 0-1.536-.22-2.121-.659-1.172-.879-1.172-2.303 0-3.182s3.07-.879 4.242 0L15 8.819"/>
                            <circle cx="12" cy="12" r="10"/>
                        </svg>
                        模型定价
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="proxy">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                        代理设置
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="change-password">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        修改密码
                    </a>
                </div>
            </div>

            <!-- 日志监控 -->
            <div class="nav-subsection">
                <div class="nav-subsection-title collapsible" data-target="logs-monitoring">
                    <span>日志监控</span>
                    <svg class="collapse-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"></polyline>
                    </svg>
                </div>
                <div class="nav-subsection-content" id="logs-monitoring">
                    <a href="#" class="nav-item nav-subitem" data-page="logs">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                        请求日志
                    </a>
                    <a href="#" class="nav-item nav-subitem" data-page="error-logs">
                        <svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        错误日志
                    </a>
                </div>
            </div>
        </nav>
        <div class="sidebar-footer">
            <div class="sidebar-stats">
                <div class="stat-item">
                    <div class="stat-value" id="stat-total">${stats.total}</div>
                    <div class="stat-label">总账号</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value" id="stat-active">${stats.active}</div>
                    <div class="stat-label">活跃</div>
                </div>
            </div>
            <div class="version-info">${settings.siteName} Manager v1.0.0</div>
        </div>
    </aside>
    `;
}

// ============ 更新侧边栏统计 ============
async function updateSidebarStats() {
    try {
        const [credRes, errorRes, geminiRes, warpRes, vertexRes, bedrockRes, amiRes, codexRes, flowRes, grokRes, orchidsRes, kraterRes, directRes, outlookRes] = await Promise.all([
            fetch('/api/credentials', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/error-credentials', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/gemini/credentials', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/warp/statistics', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/vertex/statistics', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/bedrock/statistics', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/ami/statistics', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/codex/statistics', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/flow/tokens', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/grok/stats', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/orchids/stats', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/krater/stats', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/direct/stats', { headers: { 'Authorization': `Bearer ${authToken}` } }),
            fetch('/api/outlook/stats', { headers: { 'Authorization': `Bearer ${authToken}` } })
        ]);

        const credResult = await credRes.json();
        const errorResult = await errorRes.json();
        const geminiResult = await geminiRes.json();
        const warpResult = await warpRes.json();
        const vertexResult = await vertexRes.json();
        const bedrockResult = await bedrockRes.json();
        const amiResult = await amiRes.json();
        const codexResult = await codexRes.json();
        const flowResult = await flowRes.json();
        const grokResult = await grokRes.json();
        const orchidsResult = await orchidsRes.json();
        const kraterResult = await kraterRes.json();
        const directResult = await directRes.json();
        const outlookResult = await outlookRes.json();

        const credentials = credResult.success ? credResult.data : [];
        const errors = errorResult.success ? errorResult.data : [];
        const geminiCredentials = geminiResult.success ? geminiResult.data : [];
        const warpStats = warpResult.success ? warpResult.data : { total: 0 };
        const vertexStats = vertexResult || { total: 0 };
        const bedrockStats = bedrockResult.success ? bedrockResult.data : { total: 0 };
        const amiStats = amiResult.success ? amiResult.data : { total: 0 };
        const codexStats = codexResult.success ? codexResult.data : { total: 0 };
        const flowTokens = flowResult.success ? flowResult.data : [];
        const grokStats = grokResult || { ssoBasic: { total: 0 }, ssoSuper: { total: 0 } };
        const orchidsStats = orchidsResult.success ? orchidsResult.data : { total: 0 };
        const kraterStats = kraterResult || { total: 0 };
        const directStats = directResult || { total: 0 };
        const outlookStats = outlookResult.success ? outlookResult.data : { total: 0 };

        const total = credentials.length;
        const active = credentials.filter(c => c.isActive).length;
        const errorCount = errors.length;
        const geminiCount = geminiCredentials.length;
        const warpCount = warpStats.total || 0;
        const vertexCount = vertexStats.total || 0;
        const bedrockCount = bedrockStats.total || 0;
        const amiCount = amiStats.total || 0;
        const codexCount = codexStats.total || 0;
        const flowCount = flowTokens.length;
        const grokCount = (grokStats.ssoBasic?.total || 0) + (grokStats.ssoSuper?.total || 0);
        const orchidsCount = orchidsStats.total || 0;
        const kraterCount = kraterStats.total || 0;
        const directCount = directStats.total || 0;
        const outlookCount = outlookStats.total || 0;

        // 更新侧边栏数字
        const totalEl = document.getElementById('stat-total');
        const activeEl = document.getElementById('stat-active');
        const navAccountsEl = document.getElementById('nav-accounts-count');
        const navErrorEl = document.getElementById('nav-error-count');
        const navGeminiEl = document.getElementById('nav-gemini-count');
        const navWarpEl = document.getElementById('nav-warp-count');
        const navVertexEl = document.getElementById('nav-vertex-count');
        const navBedrockEl = document.getElementById('nav-bedrock-count');
        const navAmiEl = document.getElementById('nav-ami-count');
        const navCodexEl = document.getElementById('nav-codex-count');
        const navFlowEl = document.getElementById('nav-flow-count');
        const navGrokEl = document.getElementById('nav-grok-count');
        const navOrchidsEl = document.getElementById('nav-orchids-count');
        const navKraterEl = document.getElementById('nav-krater-count');
        const navDirectEl = document.getElementById('nav-direct-count');
        const navOutlookEl = document.getElementById('nav-outlook-count');

        if (totalEl) totalEl.textContent = total;
        if (activeEl) activeEl.textContent = active;
        if (navAccountsEl) navAccountsEl.textContent = total;
        if (navErrorEl) navErrorEl.textContent = errorCount;
        if (navGeminiEl) navGeminiEl.textContent = geminiCount;
        if (navWarpEl) navWarpEl.textContent = warpCount;
        if (navVertexEl) navVertexEl.textContent = vertexCount;
        if (navBedrockEl) navBedrockEl.textContent = bedrockCount;
        if (navAmiEl) navAmiEl.textContent = amiCount;
        if (navCodexEl) navCodexEl.textContent = codexCount;
        if (navFlowEl) navFlowEl.textContent = flowCount;
        if (navGrokEl) navGrokEl.textContent = grokCount;
        if (navOrchidsEl) navOrchidsEl.textContent = orchidsCount;
        if (navKraterEl) navKraterEl.textContent = kraterCount;
        if (navDirectEl) navDirectEl.textContent = directCount;
        if (navOutlookEl) navOutlookEl.textContent = outlookCount;

        return { total, active, error: errorCount, gemini: geminiCount, warp: warpCount, vertex: vertexCount, bedrock: bedrockCount, ami: amiCount, codex: codexCount, flow: flowCount, grok: grokCount, orchids: orchidsCount, krater: kraterCount, direct: directCount, outlook: outlookCount };
    } catch (e) {
        console.error('Update sidebar stats error:', e);
        return { total: 0, active: 0, error: 0, gemini: 0, warp: 0, vertex: 0, bedrock: 0, ami: 0, codex: 0, flow: 0, grok: 0, orchids: 0, krater: 0, direct: 0, outlook: 0 };
    }
}

// ============ 自动初始化站点设置 ============
// 页面加载时自动更新 title（使用缓存的设置）
(function() {
    const settings = window.siteSettings;
    // 从当前 title 中提取页面名称部分
    const currentTitle = document.title;
    const pageName = currentTitle.split(' - ')[0] || currentTitle;
    // 如果 title 包含 "Kiro"，替换为配置的站点名称
    if (currentTitle.includes('Kiro')) {
        document.title = currentTitle.replace(/Kiro/g, settings.siteName);
    }
})();

// ============ 移动端菜单初始化 ============
function initMobileMenu() {
    // 添加 overlay
    if (!document.querySelector('.sidebar-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.id = 'sidebar-overlay';
        document.body.appendChild(overlay);
    }

    // 添加移动端菜单按钮到 header
    const header = document.querySelector('.header');
    const headerLeft = document.querySelector('.header-left');
    if (headerLeft && !document.querySelector('.mobile-menu-btn')) {
        const menuBtn = document.createElement('button');
        menuBtn.className = 'mobile-menu-btn';
        menuBtn.id = 'mobile-menu-btn';
        menuBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="6" x2="21" y2="6"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>`;
        headerLeft.insertBefore(menuBtn, headerLeft.firstChild);
    }

    // 绑定事件
    const menuBtn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    if (menuBtn && sidebar && overlay) {
        // 打开菜单
        menuBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            sidebar.classList.add('open');
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        });

        // 点击 overlay 关闭菜单
        overlay.addEventListener('click', function() {
            closeMobileMenu();
        });

        // 点击侧边栏导航项后关闭菜单
        sidebar.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', function() {
                // 延迟关闭以便导航生效
                setTimeout(closeMobileMenu, 100);
            });
        });

        // ESC 键关闭菜单
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && sidebar.classList.contains('open')) {
                closeMobileMenu();
            }
        });
    }
}

function closeMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('active');
    document.body.style.overflow = '';
}

// 页面完全加载后，从服务器获取最新设置并更新
document.addEventListener('DOMContentLoaded', function() {
    // 延迟加载站点设置，避免阻塞页面渲染
    setTimeout(() => {
        loadSiteSettings();
    }, 100);
    
    // 初始化移动端菜单（等待侧边栏加载）
    setTimeout(() => {
        initMobileMenu();
    }, 200);
});
