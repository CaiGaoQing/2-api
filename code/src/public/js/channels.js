// ============ 通道管理（左右布局）============

let channelsData = [];
let activeId = null; // 当前选中的通道 ID

// 初始化
(async function init() {
    if (!await checkAuth()) return;
    document.getElementById('sidebar').outerHTML = getSidebarHTML();
    initSidebar('channels');
    await updateSidebarStats();
    await loadChannels();
})();

// ===== 数据加载 =====

async function loadChannels() {
    try {
        const res = await apiFetch('/api/channels');
        channelsData = res.data || [];
        renderList();
        updateStats();
        // 保持右侧选中状态
        if (activeId && channelsData.find(c => c.id === activeId)) {
            selectChannel(activeId);
        } else {
            showEmpty();
        }
    } catch (e) {
        document.getElementById('ch-list').innerHTML =
            '<div class="empty-state">加载失败: ' + escHtml(e.message) + '</div>';
    }
}

function updateStats() {
    const models = channelsData.reduce((s, c) => s + (c.models ? c.models.length : 0), 0);
    document.getElementById('statsText').textContent =
        channelsData.length + ' 通道 / ' + models + ' 模型';
    document.getElementById('listTitle').textContent =
        '通道列表 (' + channelsData.length + ')';
}

// ===== 左侧列表渲染 =====

function renderList() {
    const el = document.getElementById('ch-list');
    if (!channelsData.length) {
        el.innerHTML = '<div style="padding:40px 20px;text-align:center;color:var(--text-muted)">暂无通道</div>';
        return;
    }
    let html = '';
    for (const ch of channelsData) {
        const mc = (ch.models || []).length;
        html += '<div class="ch-item' + (ch.id === activeId ? ' active' : '') + '" onclick="selectChannel(' + ch.id + ')">' +
            '<span class="ch-dot ' + (ch.isActive ? 'on' : 'off') + '"></span>' +
            '<div class="ch-info">' +
                '<div class="ch-info-row">' +
                    '<span class="ch-info-name">' + escHtml(ch.name) + '</span>' +
                    (ch.displayName ? '<span class="ch-info-display">' + escHtml(ch.displayName) + '</span>' : '') +
                    (mc > 0 ? '<span class="ch-info-badge">' + mc + ' 模型</span>' : '') +
                '</div>' +
                (ch.apiPath ? '<span class="ch-info-path">' + escHtml(ch.apiPath) + '</span>' : '') +
            '</div>' +
            '<div class="ch-item-actions">' +
                '<button class="ch-item-btn del" onclick="event.stopPropagation();deleteChannel(' + ch.id + ')" title="删除">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>' +
                '</button>' +
            '</div>' +
        '</div>';
    }
    el.innerHTML = html;
}

// ===== 右侧面板 =====

function showEmpty() {
    activeId = null;
    document.getElementById('detail-empty').style.display = '';
    document.getElementById('detail-content').style.display = 'none';
    // 清除左侧高亮
    document.querySelectorAll('.ch-item.active').forEach(e => e.classList.remove('active'));
}

function showDetail() {
    document.getElementById('detail-empty').style.display = 'none';
    document.getElementById('detail-content').style.display = '';
}

function selectChannel(id) {
    activeId = id;
    const ch = channelsData.find(c => c.id === id);
    if (!ch) { showEmpty(); return; }

    // 高亮左侧
    document.querySelectorAll('.ch-item').forEach(e => e.classList.remove('active'));
    const items = document.querySelectorAll('.ch-item');
    items.forEach(e => { if (e.onclick && e.onclick.toString().includes(id)) e.classList.add('active'); });
    // 更精准的高亮
    renderList();

    // 填充右侧表单
    document.getElementById('detail-title').textContent = '编辑: ' + ch.name;
    document.getElementById('f-id').value = ch.id;
    document.getElementById('f-name').value = ch.name;
    document.getElementById('f-displayName').value = ch.displayName || '';
    document.getElementById('f-apiPath').value = ch.apiPath || '';
    document.getElementById('f-description').value = ch.description || '';
    document.getElementById('f-isActive').checked = ch.isActive;
    document.getElementById('f-sortOrder').value = ch.sortOrder || 0;

    // 渲染模型
    const ml = document.getElementById('models-list');
    ml.innerHTML = '';
    (ch.models || []).forEach(m => addModelRow(m.id, m.modelName, m.inputPrice, m.outputPrice));

    showDetail();
}

function openAdd() {
    activeId = null;
    renderList(); // 清除高亮
    document.getElementById('detail-title').textContent = '添加通道';
    document.getElementById('f-id').value = '';
    document.getElementById('f-name').value = '';
    document.getElementById('f-displayName').value = '';
    document.getElementById('f-apiPath').value = '';
    document.getElementById('f-description').value = '';
    document.getElementById('f-isActive').checked = true;
    document.getElementById('f-sortOrder').value = '0';
    document.getElementById('models-list').innerHTML = '';
    showDetail();
}

function cancelEdit() {
    if (activeId) {
        selectChannel(activeId);
    } else {
        showEmpty();
    }
}

// ===== 模型行 =====

function addModelRow(existingId, name, inputP, outputP) {
    const ml = document.getElementById('models-list');
    const row = document.createElement('div');
    row.className = 'model-row';
    row.dataset.modelId = existingId || '';
    row.innerHTML =
        '<input type="text" placeholder="模型名称" value="' + escAttr(name || '') + '" class="m-name">' +
        '<input type="number" step="0.0001" placeholder="输入" value="' + (inputP || 0) + '" class="m-input">' +
        '<input type="number" step="0.0001" placeholder="输出" value="' + (outputP || 0) + '" class="m-output">' +
        '<button class="model-remove" onclick="this.parentElement.remove()">&times;</button>';
    ml.appendChild(row);
}

// ===== 保存 =====

async function saveChannel() {
    const editId = document.getElementById('f-id').value;
    const data = {
        name: document.getElementById('f-name').value.trim(),
        displayName: document.getElementById('f-displayName').value.trim(),
        apiPath: document.getElementById('f-apiPath').value.trim(),
        description: document.getElementById('f-description').value.trim(),
        isActive: document.getElementById('f-isActive').checked,
        sortOrder: parseInt(document.getElementById('f-sortOrder').value) || 0
    };
    if (!data.name) { showToast('通道标识不能为空', 'error'); return; }

    try {
        let channelId;
        if (editId) {
            await apiFetch('/api/channels/' + editId, 'PUT', data);
            channelId = parseInt(editId);
        } else {
            const res = await apiFetch('/api/channels', 'POST', data);
            channelId = res.data.id;
        }
        await saveModels(channelId, editId);
        showToast('保存成功', 'success');
        activeId = channelId;
        await loadChannels();
    } catch (e) {
        showToast('保存失败: ' + e.message, 'error');
    }
}

async function saveModels(channelId, isEdit) {
    const rows = document.querySelectorAll('#models-list .model-row');
    const existingCh = isEdit ? channelsData.find(c => c.id === channelId) : null;
    const existingModels = existingCh ? (existingCh.models || []) : [];
    const existingIds = new Set(existingModels.map(m => m.id));
    const keptIds = new Set();
    const toUpdate = [];
    const toAdd = [];

    for (const row of rows) {
        const modelId = row.dataset.modelId ? parseInt(row.dataset.modelId) : null;
        const modelName = row.querySelector('.m-name').value.trim();
        const inputPrice = parseFloat(row.querySelector('.m-input').value) || 0;
        const outputPrice = parseFloat(row.querySelector('.m-output').value) || 0;
        if (!modelName) continue;
        if (modelId && existingIds.has(modelId)) {
            keptIds.add(modelId);
            toUpdate.push({ modelId, modelName, inputPrice, outputPrice });
        } else {
            toAdd.push({ modelName, inputPrice, outputPrice });
        }
    }
    for (const m of existingModels) {
        if (!keptIds.has(m.id)) await apiFetch('/api/channels/models/' + m.id, 'DELETE');
    }
    for (const u of toUpdate) {
        await apiFetch('/api/channels/models/' + u.modelId, 'PUT', { modelName: u.modelName, inputPrice: u.inputPrice, outputPrice: u.outputPrice });
    }
    for (const a of toAdd) {
        await apiFetch('/api/channels/' + channelId + '/models', 'POST', a);
    }
}

// ===== 删除 =====

async function deleteChannel(id) {
    if (!confirm('确定删除此通道及其所有模型配置？')) return;
    try {
        await apiFetch('/api/channels/' + id, 'DELETE');
        showToast('已删除', 'success');
        if (activeId === id) activeId = null;
        await loadChannels();
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

// ===== 工具函数 =====

async function apiFetch(url, method, body) {
    const opts = {
        method: method || 'GET',
        headers: { 'Authorization': 'Bearer ' + authToken, 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || '请求失败');
    return json;
}

function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function escAttr(s) {
    return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
