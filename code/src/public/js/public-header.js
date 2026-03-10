// ============ 公开页面公共导航头 ============

function renderPublicHeader(activePage) {
    const pages = [
        { key: 'usage-query', label: '用量查询', href: '/pages/usage-query.html' },
        { key: 'status', label: '服务状态', href: '/pages/status.html' },
        { key: 'trial-apply', label: '试用申请', href: '/pages/trial-apply.html' },
        { key: 'docs', label: '在线帮助', href: '/pages/docs.html' },
        { key: 'image-gen', label: 'AI 生图', href: '/pages/image-gen.html' },
        { key: 'login', label: '后台登录', href: '/login.html' }
    ];

    const navLinks = pages.map(p =>
        '<a href="' + p.href + '"' + (p.key === activePage ? ' class="active"' : '') + '>' + p.label + '</a>'
    ).join('\n                ');

    const headerHTML = `
        <header class="public-header">
            <div class="public-logo">
                <div class="public-logo-icon" id="logo-icon">K</div>
                <span class="public-logo-text" id="logo-text">Kiro API</span>
            </div>
            <nav class="public-nav">
                ${navLinks}
            </nav>
        </header>
    `;

    // 插入到 public-page 容器的最前面
    const container = document.querySelector('.public-page');
    if (container) {
        container.insertAdjacentHTML('afterbegin', headerHTML);
    }

    // 加载站点设置
    loadPublicSiteSettings();
}

async function loadPublicSiteSettings() {
    // 先从缓存加载
    const cached = localStorage.getItem('siteSettings');
    if (cached) {
        try {
            const settings = JSON.parse(cached);
            applyPublicSiteSettings(settings);
        } catch (e) {}
    }
    // 再从服务器获取最新
    try {
        const res = await fetch('/api/site-settings');
        const data = await res.json();
        if (data.success && data.data) {
            localStorage.setItem('siteSettings', JSON.stringify(data.data));
            applyPublicSiteSettings(data.data);
        }
    } catch (e) {
        console.error('Load site settings error:', e);
    }
}

function applyPublicSiteSettings(settings) {
    const icon = document.getElementById('logo-icon');
    const text = document.getElementById('logo-text');
    if (icon) icon.textContent = settings.siteLogo || 'K';
    if (text) text.textContent = (settings.siteName || 'Kiro') + ' API';
}
