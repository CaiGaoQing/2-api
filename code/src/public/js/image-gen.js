/**
 * AI 图片生成页面 JS
 * 无需登录，用户配置自己的 API Key
 */

// 模型配置
const CHANNEL_MODELS = {
    flow: [
        { id: 'gemini-2.5-flash-image-landscape', name: 'Gemini 2.5 Flash (横版)', group: 'Gemini' },
        { id: 'gemini-2.5-flash-image-portrait', name: 'Gemini 2.5 Flash (竖版)', group: 'Gemini' },
        { id: 'gemini-3.0-pro-image-landscape', name: 'Gemini 3.0 Pro (横版)', group: 'Gemini' },
        { id: 'gemini-3.0-pro-image-portrait', name: 'Gemini 3.0 Pro (竖版)', group: 'Gemini' },
        { id: 'gemini-3.0-pro-image-square', name: 'Gemini 3.0 Pro (方形)', group: 'Gemini' },
        { id: 'imagen-4.0-generate-preview-landscape', name: 'Imagen 4.0 (横版)', group: 'Imagen' },
        { id: 'imagen-4.0-generate-preview-portrait', name: 'Imagen 4.0 (竖版)', group: 'Imagen' },
    ],
    do: [
        { id: 'openai-gpt-image-1', name: 'GPT Image 1', group: 'OpenAI' },
        { id: 'dall-e-3', name: 'DALL-E 3', group: 'OpenAI' },
        { id: 'dall-e-2', name: 'DALL-E 2', group: 'OpenAI' },
    ],
    grok: [
        { id: 'grok-imagine-1.0', name: 'Grok Imagine 1.0', group: 'xAI' },
    ]
};

// Flow 通道使用 chat/completions 接口（模型名自带比例信息，不需要 size/n 参数）
// DO 通道使用 images/generations 接口（支持 size/n 参数）
// Grok 通道使用 images/generations 接口（WebSocket 图片生成，支持 size/n 参数）

let imageHistory = [];

// ============ 初始化 ============
document.addEventListener('DOMContentLoaded', () => {
    loadSavedConfig();
    updateModelList();
    updateSizeVisibility();
    bindEvents();
    loadHistory();
});

function loadSavedConfig() {
    const savedKey = localStorage.getItem('imageGen_apiKey');
    const savedChannel = localStorage.getItem('imageGen_channel');

    if (savedKey) {
        document.getElementById('api-key').value = savedKey;
        updateKeyStatus(true);
    }
    if (savedChannel) {
        document.getElementById('channel-select').value = savedChannel;
    }
}

function updateKeyStatus(hasSaved) {
    const status = document.getElementById('key-status');
    if (hasSaved) {
        status.className = 'key-status saved';
        status.textContent = '已配置';
    } else {
        status.className = 'key-status unsaved';
        status.textContent = '未配置';
    }
}

// ============ 模型列表 ============
function updateModelList() {
    const channel = document.getElementById('channel-select').value;
    const modelSelect = document.getElementById('model-select');
    const models = CHANNEL_MODELS[channel] || [];

    // 按 group 分组
    const groups = {};
    models.forEach(m => {
        if (!groups[m.group]) groups[m.group] = [];
        groups[m.group].push(m);
    });

    let html = '';
    for (const [group, items] of Object.entries(groups)) {
        html += `<optgroup label="${group}">`;
        items.forEach(m => {
            html += `<option value="${m.id}">${m.name}</option>`;
        });
        html += `</optgroup>`;
    }

    modelSelect.innerHTML = html;
}

function updateSizeVisibility() {
    const channel = document.getElementById('channel-select').value;
    const sizeGroup = document.getElementById('size-select').closest('.gen-form-group');
    const nGroup = document.getElementById('n-select').closest('.gen-form-group');

    if (channel === 'do' || channel === 'grok') {
        // DO/Grok 通道支持 size 和 n 参数
        sizeGroup.style.display = 'block';
        nGroup.style.display = 'block';
    } else {
        // Flow 通道模型名自带比例，不需要额外的 size/n
        sizeGroup.style.display = 'none';
        nGroup.style.display = 'none';
    }
}

// ============ 事件绑定 ============
function bindEvents() {
    // API Key 保存
    document.getElementById('api-key').addEventListener('change', () => {
        const key = document.getElementById('api-key').value.trim();
        if (key) {
            localStorage.setItem('imageGen_apiKey', key);
            updateKeyStatus(true);
        } else {
            localStorage.removeItem('imageGen_apiKey');
            updateKeyStatus(false);
        }
    });

    // 通道切换
    document.getElementById('channel-select').addEventListener('change', () => {
        const channel = document.getElementById('channel-select').value;
        localStorage.setItem('imageGen_channel', channel);
        updateModelList();
        updateSizeVisibility();
    });

    // 生成按钮
    document.getElementById('generate-btn').addEventListener('click', generateImage);

    // 快捷键 Ctrl+Enter
    document.getElementById('prompt-input').addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            generateImage();
        }
    });
}

// ============ 图片生成 ============
async function generateImage() {
    const apiKey = document.getElementById('api-key').value.trim();
    const channel = document.getElementById('channel-select').value;
    const model = document.getElementById('model-select').value;
    const prompt = document.getElementById('prompt-input').value.trim();

    if (!apiKey) {
        showToast('请先输入 API Key', 'error');
        document.getElementById('api-key').focus();
        return;
    }
    if (!prompt) {
        showToast('请输入图片描述', 'error');
        document.getElementById('prompt-input').focus();
        return;
    }

    // 保存 key
    localStorage.setItem('imageGen_apiKey', apiKey);
    updateKeyStatus(true);

    const btn = document.getElementById('generate-btn');
    const resultContainer = document.getElementById('result-container');

    // 显示加载状态
    btn.disabled = true;
    btn.innerHTML = '<div class="spinner"></div> 生成中...';
    resultContainer.innerHTML = `
        <div class="gen-progress">
            <div class="gen-progress-text">正在生成图片，请稍候...</div>
            <div class="gen-progress-bar"><div class="gen-progress-bar-fill"></div></div>
        </div>
    `;

    try {
        let images;

        if (channel === 'do') {
            images = await generateViaDO(apiKey, model, prompt);
        } else if (channel === 'flow') {
            images = await generateViaChat(apiKey, model, prompt, '/flow/v1/chat/completions');
        } else if (channel === 'grok') {
            images = await generateViaGrokImage(apiKey, model, prompt);
        }

        if (images && images.length > 0) {
            displayResults(images, model, prompt);
            saveToHistory(images, model, prompt, channel);
        } else {
            resultContainer.innerHTML = `
                <div class="gen-result-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="15" y1="9" x2="9" y2="15"/>
                        <line x1="9" y1="9" x2="15" y2="15"/>
                    </svg>
                    <p>未能获取到图片，请检查模型和 API Key 是否正确</p>
                </div>
            `;
        }
    } catch (e) {
        console.error('生成失败:', e);
        resultContainer.innerHTML = `
            <div class="gen-result-empty">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p style="color: #ef4444;">${escapeHtml(e.message)}</p>
            </div>
        `;
        showToast('生成失败: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            生成图片
        `;
    }
}

// ============ DO 通道（images/generations）============
async function generateViaDO(apiKey, model, prompt) {
    const size = document.getElementById('size-select').value;
    const n = parseInt(document.getElementById('n-select').value);

    const res = await fetch('/do/v1/images/generations', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, prompt, size, n })
    });

    if (!res.ok) {
        const errText = await res.text();
        let errMsg;
        try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error?.message || errJson.error || errText;
        } catch {
            errMsg = errText;
        }
        throw new Error(errMsg);
    }

    const data = await res.json();
    // OpenAI images/generations 返回 { data: [{ url, b64_json, revised_prompt }] }
    return (data.data || []).map(item => ({
        url: item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ''),
        revisedPrompt: item.revised_prompt || ''
    })).filter(img => img.url);
}

// ============ Chat Completions 通道（Flow / Grok）============
async function generateViaChat(apiKey, model, prompt, endpoint) {
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            stream: false
        })
    });

    if (!res.ok) {
        const errText = await res.text();
        let errMsg;
        try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error?.message || errJson.error || errText;
        } catch {
            errMsg = errText;
        }
        throw new Error(errMsg);
    }

    const data = await res.json();
    // chat/completions 返回的图片通常在 content 中以 markdown 图片格式或 URL 形式
    const content = data.choices?.[0]?.message?.content || '';

    const images = [];

    // 匹配 markdown 图片 ![...](url)
    const mdRegex = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
    let match;
    while ((match = mdRegex.exec(content)) !== null) {
        images.push({ url: match[1], revisedPrompt: '' });
    }

    // 如果没匹配到 markdown，尝试直接匹配 URL
    if (images.length === 0) {
        const urlRegex = /(https?:\/\/[^\s"'<>]+\.(png|jpg|jpeg|webp|gif)(\?[^\s"'<>]*)?)/gi;
        while ((match = urlRegex.exec(content)) !== null) {
            images.push({ url: match[1], revisedPrompt: '' });
        }
    }

    // 如果还是没有，把整个 content 当成 URL 尝试
    if (images.length === 0 && content.startsWith('http')) {
        images.push({ url: content.trim(), revisedPrompt: '' });
    }

    return images;
}

// ============ Grok Image 通道（WebSocket 图片生成）============
async function generateViaGrokImage(apiKey, model, prompt) {
    const size = document.getElementById('size-select').value;
    const n = parseInt(document.getElementById('n-select').value);

    const res = await fetch('/grok/v1/images/generations', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ model, prompt, size, n })
    });

    if (!res.ok) {
        const errText = await res.text();
        let errMsg;
        try {
            const errJson = JSON.parse(errText);
            errMsg = errJson.error?.message || errJson.error || errText;
        } catch {
            errMsg = errText;
        }
        throw new Error(errMsg);
    }

    const data = await res.json();
    return (data.data || []).map(item => ({
        url: item.url || (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ''),
        revisedPrompt: item.revised_prompt || ''
    })).filter(img => img.url);
}

// ============ 显示结果 ============
function displayResults(images, model, prompt) {
    const container = document.getElementById('result-container');

    let html = '';
    images.forEach((img, idx) => {
        html += `
            <img class="gen-result-image" src="${escapeHtml(img.url)}" 
                 alt="Generated Image ${idx + 1}" 
                 onclick="viewFullscreen(this.src)"
                 onerror="this.style.display='none'">
        `;
        if (img.revisedPrompt) {
            html += `<div class="gen-result-info"><strong>优化后的提示词：</strong>${escapeHtml(img.revisedPrompt)}</div>`;
        }
    });

    html += `
        <div class="gen-result-info" style="margin-top: 12px;">
            <strong>模型：</strong>${escapeHtml(model)}<br>
            <strong>提示词：</strong>${escapeHtml(prompt)}
        </div>
    `;

    container.innerHTML = html;
}

// ============ 全屏查看 ============
function viewFullscreen(src) {
    const overlay = document.createElement('div');
    overlay.className = 'image-fullscreen';
    overlay.innerHTML = `<img src="${escapeHtml(src)}">`;
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
}

// ============ 历史记录 ============
function loadHistory() {
    try {
        imageHistory = JSON.parse(localStorage.getItem('imageGen_history') || '[]');
        renderHistory();
    } catch {
        imageHistory = [];
    }
}

function saveToHistory(images, model, prompt, channel) {
    const record = {
        images: images.map(i => i.url),
        model,
        prompt,
        channel,
        time: new Date().toISOString()
    };

    imageHistory.unshift(record);
    // 最多保存 20 条
    if (imageHistory.length > 20) {
        imageHistory = imageHistory.slice(0, 20);
    }

    localStorage.setItem('imageGen_history', JSON.stringify(imageHistory));
    renderHistory();
}

function renderHistory() {
    const section = document.getElementById('history-section');
    const grid = document.getElementById('history-grid');

    if (imageHistory.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    grid.innerHTML = imageHistory.map(record => {
        const firstImg = record.images[0] || '';
        return `<div class="gen-history-item" onclick="viewFullscreen('${escapeHtml(firstImg)}')" title="${escapeHtml(record.prompt)}">
            <img src="${escapeHtml(firstImg)}" alt="History" onerror="this.parentElement.style.display='none'">
        </div>`;
    }).join('');
}

// ============ 工具函数 ============
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.style.cssText = `
        padding: 12px 20px;
        border-radius: 8px;
        color: white;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transition: opacity 0.3s;
        margin-bottom: 8px;
        background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    `;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
