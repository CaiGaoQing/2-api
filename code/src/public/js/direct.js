// Direct 转发通道管理
(function() {
    const authToken = localStorage.getItem('authToken');
    if (!authToken) { window.location.href = '/pages/home.html'; return; }

    // 初始化侧边栏
    document.getElementById('sidebar-container').innerHTML = getSidebarHTML();
    initSidebar('direct');
    updateSidebarStats();

    const headers = { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' };
    let allChannels = [];

    // Toast
    function showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    // 加载通道列表
    async function loadChannels() {
        try {
            const res = await fetch('/api/direct/channels', { headers });
            if (!res.ok) throw new Error('加载失败');
            allChannels = await res.json();
            renderTable();
            updateStats();
        } catch (err) {
            showToast(err.message, 'error');
        }
    }

    // 更新统计
    function updateStats() {
        const total = allChannels.length;
        const active = allChannels.filter(c => c.status === 'active').length;
        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-active').textContent = active;
        document.getElementById('displayed-count').textContent = total;
    }

    // 渲染表格
    function renderTable() {
        const tbody = document.getElementById('channel-tbody');
        const empty = document.getElementById('empty-state');

        if (!allChannels.length) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        tbody.innerHTML = allChannels.map(ch => {
            const maskedKey = ch.apiKey ? ch.apiKey.substring(0, 8) + '...' + ch.apiKey.slice(-4) : '';
            const statusClass = ch.status === 'active' ? 'status-active' : 'status-disabled';
            const statusText = ch.status === 'active' ? '活跃' : '禁用';
            const lastUsed = ch.lastUsedAt ? new Date(ch.lastUsedAt).toLocaleString('zh-CN') : '-';

            return `<tr>
                <td>${ch.id}</td>
                <td><strong>${ch.name}</strong></td>
                <td><code style="font-size:11px;word-break:break-all;">${ch.upstreamUrl}</code></td>
                <td><code style="font-size:11px;">${maskedKey}</code></td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${ch.useCount}</td>
                <td>${ch.failCount}</td>
                <td style="font-size:12px;">${lastUsed}</td>
                <td style="font-size:12px;">${ch.note || '-'}</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-action btn-edit" title="编辑" onclick="editChannel(${ch.id})">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="btn-action btn-toggle" title="${ch.status === 'active' ? '禁用' : '启用'}" onclick="toggleChannel(${ch.id}, '${ch.status}')">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                ${ch.status === 'active'
                                    ? '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>'
                                    : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'}
                            </svg>
                        </button>
                        <button class="btn-action btn-delete" title="删除" onclick="deleteChannel(${ch.id})">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </td>
            </tr>`;
        }).join('');
    }

    // 模态框
    const modal = document.getElementById('channel-modal');
    const openModal = (editData) => {
        document.getElementById('modal-title').textContent = editData ? '编辑转发通道' : '添加转发通道';
        document.getElementById('edit-id').value = editData ? editData.id : '';
        document.getElementById('input-name').value = editData ? editData.name : '';
        document.getElementById('input-url').value = editData ? editData.upstreamUrl : '';
        document.getElementById('input-key').value = editData ? editData.apiKey : '';
        document.getElementById('input-note').value = editData ? (editData.note || '') : '';
        modal.classList.add('active');
    };
    const closeModal = () => modal.classList.remove('active');

    document.getElementById('add-channel-btn').addEventListener('click', () => openModal(null));
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    // 保存
    document.getElementById('modal-submit').addEventListener('click', async () => {
        const editId = document.getElementById('edit-id').value;
        const data = {
            name: document.getElementById('input-name').value.trim(),
            upstreamUrl: document.getElementById('input-url').value.trim(),
            apiKey: document.getElementById('input-key').value.trim(),
            note: document.getElementById('input-note').value.trim(),
        };

        if (!data.name || !data.upstreamUrl || !data.apiKey) {
            showToast('请填写必填字段', 'error');
            return;
        }

        try {
            const url = editId ? `/api/direct/channels/${editId}` : '/api/direct/channels';
            const method = editId ? 'PUT' : 'POST';
            const res = await fetch(url, { method, headers, body: JSON.stringify(data) });
            if (!res.ok) throw new Error((await res.json()).error || '操作失败');
            showToast(editId ? '通道已更新' : '通道已添加');
            closeModal();
            loadChannels();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    // 全局操作函数
    window.editChannel = (id) => {
        const ch = allChannels.find(c => c.id === id);
        if (ch) openModal(ch);
    };

    window.toggleChannel = async (id, currentStatus) => {
        const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
        try {
            const res = await fetch(`/api/direct/channels/${id}`, {
                method: 'PUT', headers, body: JSON.stringify({ status: newStatus })
            });
            if (!res.ok) throw new Error('操作失败');
            showToast(newStatus === 'active' ? '已启用' : '已禁用');
            loadChannels();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    window.deleteChannel = async (id) => {
        if (!confirm('确定删除此通道？')) return;
        try {
            const res = await fetch(`/api/direct/channels/${id}`, { method: 'DELETE', headers });
            if (!res.ok) throw new Error('删除失败');
            showToast('已删除');
            loadChannels();
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    // 初始化
    loadChannels();
})();
