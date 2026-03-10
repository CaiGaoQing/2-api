/**
 * docs.js - 接入教程页面脚本
 */

// 接入类型切换
function initIntegrationTabs() {
    document.querySelectorAll('.integration-card').forEach(card => {
        card.addEventListener('click', () => {
            const type = card.dataset.type;

            // 更新卡片状态
            document.querySelectorAll('.integration-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            // 更新内容显示
            document.querySelectorAll('.integration-content').forEach(c => c.classList.remove('active'));
            document.getElementById('content-' + type).classList.add('active');
        });
    });
}

// Tab 切换
function initTabSwitcher() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            const container = btn.closest('.tab-container');

            // 更新按钮状态
            container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 更新内容显示
            container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            container.querySelector('#tab-' + tabId).classList.add('active');
        });
    });
}

// 复制代码
function copyCode(btn) {
    const codeBlock = btn.parentElement;
    const code = codeBlock.querySelector('pre').textContent;

    navigator.clipboard.writeText(code).then(() => {
        const originalText = btn.textContent;
        btn.textContent = '已复制!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    });
}

// 加载站点设置
async function loadSiteSettings() {
    const logoIcon = document.getElementById('logo-icon');
    const logoText = document.getElementById('logo-text');

    // 先从缓存加载（避免闪烁）
    const cached = localStorage.getItem('siteSettings');
    if (cached) {
        try {
            const settings = JSON.parse(cached);
            if (logoIcon) logoIcon.textContent = settings.siteLogo || 'K';
            if (logoText) logoText.textContent = `${settings.siteName || 'Kiro'} API`;
            document.title = `接入教程 - ${settings.siteName || 'Kiro'} API`;
        } catch (e) {
            console.error('Parse cached settings error:', e);
        }
    }

    // 再从服务器获取最新
    try {
        const res = await fetch('/api/site-settings');
        const data = await res.json();
        if (data.success && data.data) {
            const settings = data.data;
            localStorage.setItem('siteSettings', JSON.stringify(settings));
            if (logoIcon) logoIcon.textContent = settings.siteLogo || 'K';
            if (logoText) logoText.textContent = `${settings.siteName || 'Kiro'} API`;
            document.title = `接入教程 - ${settings.siteName || 'Kiro'} API`;
        }
    } catch (e) {
        console.error('Load site settings error:', e);
    }
}

// 页面初始化
document.addEventListener('DOMContentLoaded', () => {
    initIntegrationTabs();
    initTabSwitcher();
    loadSiteSettings();
});
