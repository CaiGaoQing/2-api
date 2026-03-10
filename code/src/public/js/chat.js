// ============ 对话测试页面 JS ============

// 状态变量
let chatHistory = [];
let isStreaming = false;
let currentChatAccountId = null;
let currentGeminiAccountId = null;
let chatApiEndpoint = localStorage.getItem('chatApiEndpoint') || '';
let chatApiKey = localStorage.getItem('chatApiKey') || '';

// DOM 元素
let chatMessages, chatInput, chatSendBtn, chatModel, chatSettingsModal;

// 判断是否为 Gemini 模型
function isGeminiModel(model) {
    return model && model.startsWith('gemini-');
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    // 获取 DOM 元素
    chatMessages = document.getElementById('chat-messages');
    chatInput = document.getElementById('chat-input');
    chatSendBtn = document.getElementById('chat-send-btn');
    chatModel = document.getElementById('chat-model');
    chatSettingsModal = document.getElementById('chat-settings-modal');

    // 先加载站点设置
    await loadSiteSettings();

    // 注入侧边栏
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('chat');

    // 更新页面标题和模型分组标签
    const settings = window.siteSettings;
    document.title = `对话测试 - ${settings.siteName} ${settings.siteSubtitle}`;

    // 更新模型分组标签中的 "Kiro"
    const kiroOptgroup = chatModel.querySelector('optgroup[label*="Kiro"]');
    if (kiroOptgroup) {
        kiroOptgroup.label = `Claude (${settings.siteName})`;
    }

    if (!await checkAuth()) return;

    // 检查 URL 参数
    const urlParams = new URLSearchParams(window.location.search);
    const accountId = urlParams.get('account');
    const geminiId = urlParams.get('gemini');

    if (accountId) {
        currentChatAccountId = parseInt(accountId);
        loadAccountInfo(currentChatAccountId, 'kiro');
    } else if (geminiId) {
        currentGeminiAccountId = parseInt(geminiId);
        loadAccountInfo(currentGeminiAccountId, 'gemini');
        // 自动选择 Gemini 模型
        chatModel.value = 'gemini-3-flash-preview';
    }

    setupEventListeners();
    updateSidebarStats();
    updateSendButtonState();
});

// 加载账号信息
async function loadAccountInfo(id, type = 'kiro') {
    try {
        const apiPath = type === 'gemini' ? '/api/gemini/credentials/' : '/api/credentials/';
        const res = await fetch(apiPath + id, {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        const result = await res.json();
        if (result.success && result.data) {
            const accountName = result.data.email || result.data.name;
            const prefix = type === 'gemini' ? '[Gemini] ' : '';
            document.getElementById('chat-current-account').textContent = prefix + accountName;
            document.getElementById('chat-subtitle').textContent = '使用账号: ' + prefix + accountName;
        }
    } catch (err) {
        console.error('Load account info error:', err);
    }
}

// 事件监听器
function setupEventListeners() {
    // 输入框
    chatInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 150) + 'px';
        updateSendButtonState();
    });

    chatInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // 发送按钮
    chatSendBtn.addEventListener('click', sendMessage);

    // 模型切换时更新按钮状态
    chatModel.addEventListener('change', updateSendButtonState);

    // 清空按钮
    document.getElementById('chat-clear-btn').addEventListener('click', clearChat);

    // 设置按钮
    document.getElementById('chat-settings-btn').addEventListener('click', openChatSettings);
    document.getElementById('settings-modal-close').addEventListener('click', closeChatSettings);
    document.getElementById('settings-modal-cancel').addEventListener('click', closeChatSettings);
    document.getElementById('settings-modal-save').addEventListener('click', saveChatSettings);
    chatSettingsModal.addEventListener('click', function(e) {
        if (e.target === chatSettingsModal) closeChatSettings();
    });

    // 键盘快捷键
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeChatSettings();
        }
    });
}

// 更新发送按钮状态
function updateSendButtonState() {
    const hasText = chatInput.value.trim().length > 0;
    const model = chatModel.value;
    const isGemini = isGeminiModel(model);

    // Gemini 模型需要 Gemini 账号，Claude 模型需要 Kiro 账号或 API 端点
    let canChat = false;
    if (isGemini) {
        canChat = currentGeminiAccountId !== null;
    } else {
        canChat = chatApiEndpoint || currentChatAccountId !== null;
    }

    chatSendBtn.disabled = !hasText || isStreaming || !canChat;
}

// 发送消息
async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message || isStreaming) return;

    // 添加用户消息到 UI
    addMessageToUI('user', message);
    chatInput.value = '';
    chatInput.style.height = 'auto';
    updateSendButtonState();

    // 添加到历史
    chatHistory.push({ role: 'user', content: message });

    // 显示输入指示器
    const typingEl = addTypingIndicator();
    isStreaming = true;
    updateSendButtonState();

    try {
        const model = chatModel.value;
        const isGemini = isGeminiModel(model);
        let response;

        if (isGemini && currentGeminiAccountId) {
            // Gemini 模型使用 Gemini API
            response = await fetch('/api/gemini/chat/' + currentGeminiAccountId, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({
                    message: message,
                    model: model,
                    history: chatHistory.slice(0, -1)
                })
            });
        } else if (chatApiEndpoint) {
            response = await fetch('/api/claude-proxy/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({
                    message: message,
                    model: model,
                    history: chatHistory.slice(0, -1),
                    apiKey: chatApiKey,
                    endpoint: chatApiEndpoint
                })
            });
        } else if (currentChatAccountId) {
            response = await fetch('/api/chat/' + currentChatAccountId, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({
                    message: message,
                    model: model,
                    history: chatHistory.slice(0, -1)
                })
            });
        } else {
            throw new Error(isGemini ? '请先选择 Gemini 账号' : '请先设置 API 端点或选择账号');
        }

        typingEl.remove();

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || '请求失败');
        }

        // 处理 SSE 流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantMessage = '';
        let messageEl = null;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        if (data.content) {
                            assistantMessage += data.content;
                            if (!messageEl) {
                                messageEl = addMessageToUI('assistant', assistantMessage);
                            } else {
                                updateMessageContent(messageEl, assistantMessage);
                            }
                            scrollToBottom();
                        }
                        if (data.error) {
                            throw new Error(data.error);
                        }
                    } catch (e) {
                        if (e.message !== 'Unexpected end of JSON input') {
                            console.error('Parse error:', e);
                        }
                    }
                }
            }
        }

        if (assistantMessage) {
            chatHistory.push({ role: 'assistant', content: assistantMessage });
        }

    } catch (err) {
        if (typingEl && typingEl.parentNode) typingEl.remove();
        showToast('发送失败: ' + err.message, 'error');
        chatHistory.pop();
    } finally {
        isStreaming = false;
        updateSendButtonState();
    }
}

// 添加消息到 UI
function addMessageToUI(role, content) {
    const welcome = chatMessages.querySelector('.chat-welcome');
    if (welcome) welcome.remove();

    const messageEl = document.createElement('div');
    messsName = 'chat-message ' + role;

    const avatarText = role === 'user' ? 'U' : 'AI';
    messageEl.innerHTML = '<div class="chat-message-avatar">' + avatarText + '</div>' +
        '<div class="chat-message-content">' + formatMessageContent(content) + '</div>';

    chatMessages.appendChild(messageEl);
    scrollToBottom();

    return messageEl;
}

// 更新消息内容
function updateMessageContent(messageEl, content) {
    const contentEl = messageEl.querySelector('.chat-message-content');
    if (contentEl) {
        contentEl.innerHTML = formatMessageContent(content);
    }
}

// 格式化消息内容
function formatMessageContent(content) {
    // 简单的 Markdown 处理
    let html = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');

    // 代码块
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    return html;
}

// 添加输入指示器
function addTypingIndicator() {
    const typingEl = document.createElement('div');
    typingEl.className = 'chat-typing';
    typingEl.innerHTML = '<div class="chat-typing-dots"><span></span><span></span><span></span></div><span>正在思考...</span>';
    chatMessages.appendChild(typingEl);
    scrollToBottom();
    return typingEl;
}

// 滚动到底部
function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 清空对话
function clearChat() {
    chatHistory = [];
    chatMessages.innerHTML = '<div class="chat-welcome">' +
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
        '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
        '</svg>' +
        '<h3>开始对话</h3>' +
        '<p>输入消息开始与 Claude 对话</p>' +
        '</div>';
    showToast('对话已清空', 'success');
}

// 设置模态框
function openChatSettings() {
    document.getElementById('chat-api-endpoint').value = chatApiEndpoint;
    document.getElementById('chat-api-key').value = chatApiKey;
    chatSettingsModal.classList.add('active');
}

function closeChatSettings() {
    chatSettingsModal.classList.remove('active');
}

function saveChatSettings() {
    chatApiEndpoint = document.getElementById('chat-api-endpoint').value.trim();
    chatApiKey = document.getElementById('chaey').value.trim();
    localStorage.setItem('chatApiEndpoint', chatApiEndpoint);
    localStorage.setItem('chatApiKey', chatApiKey);
    closeChatSettings();
    showToast('API 设置已保存', 'success');
    updateSendButtonState();
}
