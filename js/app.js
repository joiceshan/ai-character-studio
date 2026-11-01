/* ============================================
   AI 人物工坊 - 应用逻辑
   ============================================ */

// ---------- 全局状态 ----------
const State = {
    characters: [],             // 所有已保存的角色 [{id, avatar, customAvatar, name, identity, ageGroup, personality, background, greeting, createdAt}]
    activeCharacterId: null,    // 当前选中角色 id
    conversations: {},          // { characterId: [{role, content}, ...] }
    api: {
        provider: 'custom',
        baseUrl: '',
        apiKey: '',
        model: 'gpt-4o-mini',
        temperature: 0.7
    },
    currentWriteType: 'article'
};

const AGE_LABEL_MAP = {
    child: '孩童', teen: '少年', young: '青年',
    adult: '壮年', middle: '中年', senior: '老年'
};

// 给每个角色生成唯一 id
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- 本地存储 ----------
function saveToStorage() {
    try {
        localStorage.setItem('ai_characters', JSON.stringify(State.characters));
        localStorage.setItem('ai_active_character', State.activeCharacterId || '');
        localStorage.setItem('ai_conversations', JSON.stringify(State.conversations));
        localStorage.setItem('ai_api', JSON.stringify(State.api));
    } catch (e) {
        console.warn('保存失败:', e);
    }
}

function loadFromStorage() {
    try {
        const chars = localStorage.getItem('ai_characters');
        const active = localStorage.getItem('ai_active_character');
        const convs = localStorage.getItem('ai_conversations');
        const api = localStorage.getItem('ai_api');

        if (chars) State.characters = JSON.parse(chars);
        if (active) State.activeCharacterId = active || null;
        if (convs) State.conversations = JSON.parse(convs);
        if (api) State.api = { ...State.api, ...JSON.parse(api) };

        // 向后兼容：把旧的单 character 结构迁移进来
        const legacyChar = localStorage.getItem('ai_character');
        const legacyMsgs = localStorage.getItem('ai_messages');
        if (legacyChar && State.characters.length === 0) {
            try {
                const c = JSON.parse(legacyChar);
                const id = genId();
                State.characters.push({ ...c, id, createdAt: Date.now() });
                State.activeCharacterId = id;
                if (legacyMsgs) {
                    const msgs = JSON.parse(legacyMsgs);
                    if (Array.isArray(msgs)) State.conversations[id] = msgs;
                }
                saveToStorage();
            } catch {}
        }
    } catch (e) {
        console.warn('加载失败:', e);
    }
}

// ---------- 当前角色便捷访问 ----------
function getActiveChar() {
    return State.characters.find(c => c.id === State.activeCharacterId) || null;
}

function getActiveMessages() {
    if (!State.activeCharacterId) return [];
    return State.conversations[State.activeCharacterId] || [];
}

// ---------- 预设角色 ----------
const PRESET_CHARACTERS = [
    {
        avatar: '📚',
        name: '苏格拉底',
        identity: '古希腊哲学家',
        personality: '善于用提问引导思考，语气沉稳智慧，喜欢用寓言和比喻。',
        background: '古希腊著名哲学家，柏拉图的老师。通过对话和辩证法探索真理。',
        greeting: '你好，年轻人。今天我们要探讨什么是智慧呢？'
    },
    {
        avatar: '🌙',
        name: '林黛玉',
        identity: '红楼梦角色',
        personality: '敏感细腻，多愁善感，说话含蓄优雅，喜欢诗词。',
        background: '《红楼梦》中的女主角之一，才情出众，寄人篱下。',
        greeting: '宝玉？不，是你来了。方才还在对着落花叹气呢...'
    },
    {
        avatar: '🚀',
        name: '爱因斯坦',
        identity: '物理学家',
        personality: '好奇心旺盛，说话直率幽默，喜欢用简单语言解释复杂理论。',
        background: '20世纪最伟大的物理学家之一，相对论的提出者。',
        greeting: '嘿！你知道吗，时间其实是相对的——不过那是另一个话题了。'
    },
    {
        avatar: '🎭',
        name: '莎士比亚',
        identity: '剧作家',
        personality: '语言华丽优美，善用比喻和修辞，有时会吟诗。',
        background: '英国文艺复兴时期伟大的剧作家、诗人。',
        greeting: 'To be, or not to be... 啊，请原谅我的沉思。你好，朋友！'
    },
    {
        avatar: '🧙',
        name: '哈利·波特',
        identity: '魔法师',
        personality: '勇敢善良，略带幽默，说话直率友好。',
        background: '霍格沃茨魔法学校的学生，大难不死的男孩。',
        greeting: '嘿！你也收到霍格沃茨的入学通知书了吗？开个玩笑！'
    },
    {
        avatar: '💻',
        name: '程序员老王',
        identity: '资深工程师',
        personality: '毒舌幽默，喜欢用代码比喻人生，偶尔吐槽 bug。',
        background: '十年经验的全栈工程师，深夜改 bug 是日常。',
        greeting: '又写 bug 了？别慌，Ctrl+Z 还能救你。'
    }
];

// ---------- 头像选项 ----------
const AVATAR_OPTIONS = [
    '🤖','🧑','👩','👨','👧','👦','🧙','🧚','🧛','🧜',
    '🧝','🧞','🧟','🦸','🦹','🤴','👸','👲','👳','👷',
    '💂','🕵️','🎤','🎨','🎭','📚','✈️','🚀','🌟','🌸'
];

// ---------- 初始化 ----------
document.addEventListener('DOMContentLoaded', () => {
    loadFromStorage();
    initTabs();
    initAvatarGrid();
    initCharacterForm();
    initSettingsForm();
    initChat();
    initWrite();
    updateUI();
});

// ---------- Tab 切换 ----------
function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(btn => {
        btn.addEventListener('click', () => {
            tabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            document.getElementById('tab-' + tabId).classList.add('active');
            
            // 移动端自动滚动到顶部
            if (window.innerWidth <= 640) {
                document.getElementById('tab-' + tabId).scrollTop = 0;
            }
        });
    });
}

// ---------- UI 更新 ----------
function updateUI() {
    renderCharSidebar();
    updateCharacterPreview();
    updateSettingsForm();
    renderMessages();
    populateCharacterForm();
}

function updateCharacterPreview() {
    const miniAvatar = document.getElementById('miniAvatar');
    const miniName = document.getElementById('miniName');
    const miniStatus = document.getElementById('miniStatus');

    const c = getActiveChar();
    if (c) {
        renderCharacterAvatar(miniAvatar, c);
        miniName.textContent = c.name;
        const ageLabel = AGE_LABEL_MAP[c.ageGroup] || '';
        miniStatus.textContent = [c.identity, ageLabel].filter(Boolean).join(' · ') || '已就绪，开始对话吧';
    } else {
        miniAvatar.textContent = '🤖';
        miniName.textContent = '未选择角色';
        miniStatus.textContent = '点击左侧列表选择一个角色';
    }

    // 快捷提示
    const quickPrompts = document.getElementById('quickPrompts');
    quickPrompts.style.display = c ? 'flex' : 'none';
}

// ---------- 角色侧边栏 ----------
function renderCharSidebar() {
    const list = document.getElementById('charList');
    if (!list) return;
    list.innerHTML = '';

    if (State.characters.length === 0) {
        list.innerHTML = '<div class="sidebar-empty">还没有角色<br>去「设定」创建第一个吧</div>';
        return;
    }

    State.characters.forEach(c => {
        const li = document.createElement('div');
        li.className = 'char-item' + (c.id === State.activeCharacterId ? ' active' : '');
        li.dataset.id = c.id;

        const avatarEl = document.createElement('div');
        avatarEl.className = 'char-item-avatar';
        renderCharacterAvatar(avatarEl, c);

        const info = document.createElement('div');
        info.className = 'char-item-info';
        const name = document.createElement('div');
        name.className = 'char-item-name';
        name.textContent = c.name;
        const ageLabel = AGE_LABEL_MAP[c.ageGroup] || '';
        const identityLine = [c.identity, ageLabel].filter(Boolean).join(' · ') || '无身份';
        const sub = document.createElement('div');
        sub.className = 'char-item-sub';
        sub.textContent = identityLine;

        info.appendChild(name);
        info.appendChild(sub);

        const del = document.createElement('button');
        del.className = 'char-item-del';
        del.textContent = '✕';
        del.title = '删除角色';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm(`确定删除「${c.name}」以及与 TA 的对话历史吗？`)) {
                State.characters = State.characters.filter(x => x.id !== c.id);
                delete State.conversations[c.id];
                if (State.activeCharacterId === c.id) {
                    State.activeCharacterId = State.characters[0]?.id || null;
                }
                saveToStorage();
                updateUI();
                showToast('已删除', 'success');
            }
        });

        li.appendChild(avatarEl);
        li.appendChild(info);
        li.appendChild(del);

        li.addEventListener('click', () => {
            State.activeCharacterId = c.id;
            saveToStorage();
            updateUI();
            // 移动端收起侧边栏
            closeSidebar();
        });

        list.appendChild(li);
    });
}

function selectCharacter(id) {
    State.activeCharacterId = id;
    saveToStorage();
    updateUI();
}

function createNewCharacterAndEdit() {
    switchToTab('character');
    // 先清空表单
    document.getElementById('charName').value = '';
    document.getElementById('charIdentity').value = '';
    document.getElementById('charAgeGroup').value = '';
    document.getElementById('charPersonality').value = '';
    document.getElementById('charBackground').value = '';
    document.getElementById('charGreeting').value = '';
    // 重置头像
    document.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
    const first = document.querySelector('.avatar-option');
    if (first) first.click();
    // 存一个标记，保存时当新建
    window.__charFormMode = 'new';
    window.__charFormEditId = null;
}

function editExistingCharacter(id) {
    const c = State.characters.find(x => x.id === id);
    if (!c) return;
    selectCharacter(id);
    populateCharacterForm();
    switchToTab('character');
    window.__charFormMode = 'edit';
    window.__charFormEditId = id;
}

function switchToTab(tabName) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.click();
}

// ---------- 头像网格 ----------
function initAvatarGrid() {
    const grid = document.getElementById('avatarGrid');
    grid.innerHTML = AVATAR_OPTIONS.map(avatar => 
        `<button class="avatar-option" data-avatar="${avatar}">${avatar}</button>`
    ).join('');
    
    grid.querySelectorAll('.avatar-option').forEach(btn => {
        btn.addEventListener('click', () => {
            clearAvatarSelection();
            btn.classList.add('selected');
            setAvatarDisplay(btn.dataset.avatar, false);
            clearCustomAvatarBtn();
        });
    });

    // 自定义头像上传
    document.getElementById('uploadAvatarBtn').addEventListener('click', () => {
        document.getElementById('avatarFileInput').click();
    });
    document.getElementById('avatarFileInput').addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('请选择图片文件', 'error');
            return;
        }
        if (file.size > 2 * 1024 * 1024) {
            showToast('图片不要超过 2MB', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = (ev) => {
            clearAvatarSelection();
            setAvatarDisplay(ev.target.result, true);
            document.getElementById('clearCustomAvatarBtn').style.display = 'inline-block';
            showToast('头像已更新，记得点「保存人物设定」', 'success');
        };
        reader.readAsDataURL(file);
    });
    document.getElementById('clearCustomAvatarBtn').addEventListener('click', clearCustomAvatarBtn);
}

function clearCustomAvatarBtn() {
    document.getElementById('avatarFileInput').value = '';
    document.getElementById('clearCustomAvatarBtn').style.display = 'none';
}

function clearAvatarSelection() {
    document.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
}

function setAvatarDisplay(value, isImage) {
    const preview = document.getElementById('avatarPreview');
    preview.innerHTML = '';
    if (isImage) {
        const img = document.createElement('img');
        img.src = value;
        img.alt = 'avatar';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '50%';
        preview.appendChild(img);
    } else {
        preview.textContent = value || '🤖';
    }
}

// 统一从 character 里渲染头像（img 或 emoji）
function renderCharacterAvatar(el, char) {
    el.innerHTML = '';
    if (char?.customAvatar) {
        const img = document.createElement('img');
        img.src = char.customAvatar;
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '50%';
        el.appendChild(img);
    } else {
        el.textContent = char?.avatar || '🤖';
    }
}

// ---------- 人物设定表单 ----------
function initCharacterForm() {
    // 保存按钮
    document.getElementById('saveCharBtn').addEventListener('click', () => {
        const name = document.getElementById('charName').value.trim();
        if (!name) {
            showToast('请输入人物名称', 'error');
            return;
        }

        const emojiAvatar = document.querySelector('.avatar-option.selected')?.dataset.avatar || '';
        const mode = window.__charFormMode || 'new';
        const editId = window.__charFormEditId;

        // 如果是编辑但当前没有 customAvatar 存着，从表单里还原
        const editExisting = editId ? State.characters.find(c => c.id === editId) : null;
        const existingCustom = editExisting?.customAvatar || '';

        const charData = {
            avatar: emojiAvatar,
            customAvatar: existingCustom,
            name,
            identity: document.getElementById('charIdentity').value.trim(),
            ageGroup: document.getElementById('charAgeGroup').value,
            personality: document.getElementById('charPersonality').value.trim(),
            background: document.getElementById('charBackground').value.trim(),
            greeting: document.getElementById('charGreeting').value.trim()
        };

        let savedId;
        if (mode === 'edit' && editId) {
            // 更新已有
            const idx = State.characters.findIndex(c => c.id === editId);
            if (idx >= 0) {
                State.characters[idx] = { ...State.characters[idx], ...charData };
                savedId = editId;
            }
        } else {
            // 新建
            savedId = genId();
            State.characters.push({ id: savedId, createdAt: Date.now(), ...charData });
        }

        State.activeCharacterId = savedId;
        saveToStorage();
        updateUI();
        showToast('✨ 人物已保存', 'success');
    });

    // 预设按钮
    document.getElementById('loadPresetBtn').addEventListener('click', openPresetModal);
    document.getElementById('closePresetBtn').addEventListener('click', () => {
        document.getElementById('presetModal').style.display = 'none';
    });
    document.getElementById('presetModal').addEventListener('click', (e) => {
        if (e.target.id === 'presetModal') e.target.style.display = 'none';
    });
}

function populateCharacterForm() {
    // 用当前 active 角色回填
    const c = getActiveChar();
    if (!c) return;

    document.getElementById('charName').value = c.name || '';
    document.getElementById('charIdentity').value = c.identity || '';
    document.getElementById('charAgeGroup').value = c.ageGroup || '';
    document.getElementById('charPersonality').value = c.personality || '';
    document.getElementById('charBackground').value = c.background || '';
    document.getElementById('charGreeting').value = c.greeting || '';

    document.querySelectorAll('.avatar-option').forEach(b => {
        b.classList.toggle('selected', b.dataset.avatar === c.avatar);
    });
    if (c.customAvatar) {
        setAvatarDisplay(c.customAvatar, true);
        document.getElementById('clearCustomAvatarBtn').style.display = 'inline-block';
    } else {
        setAvatarDisplay(c.avatar || '🤖', false);
        document.getElementById('clearCustomAvatarBtn').style.display = 'none';
    }

    window.__charFormMode = 'edit';
    window.__charFormEditId = c.id;
}

function openPresetModal() {
    const modal = document.getElementById('presetModal');
    const list = document.getElementById('presetList');

    list.innerHTML = PRESET_CHARACTERS.map((char, i) => `
        <div class="preset-item" data-index="${i}">
            <div class="preset-avatar">${char.avatar}</div>
            <div class="preset-info">
                <div class="preset-name">${char.name}</div>
                <div class="preset-desc">${char.identity}</div>
            </div>
        </div>
    `).join('');

    list.querySelectorAll('.preset-item').forEach(item => {
        item.addEventListener('click', () => {
            const preset = PRESET_CHARACTERS[parseInt(item.dataset.index)];
            const id = genId();
            State.characters.push({
                id, createdAt: Date.now(),
                avatar: preset.avatar, customAvatar: '',
                name: preset.name, identity: preset.identity,
                ageGroup: '',
                personality: preset.personality,
                background: preset.background,
                greeting: preset.greeting
            });
            State.activeCharacterId = id;
            populateCharacterForm();
            saveToStorage();
            updateUI();
            modal.style.display = 'none';
            showToast(`已载入「${preset.name}」（新建）`, 'success');
        });
    });

    modal.style.display = 'flex';
}

// ---------- 设置表单 ----------
function initSettingsForm() {
    // 提供商切换
    document.getElementById('apiProvider').addEventListener('change', (e) => {
        const baseUrl = document.getElementById('apiBaseUrl');
        const model = document.getElementById('apiModel');
        switch (e.target.value) {
            case 'deepseek':
                baseUrl.value = 'https://api.deepseek.com/v1';
                model.value = 'deepseek-chat';
                break;
            case 'openai':
                baseUrl.value = 'https://api.openai.com/v1';
                model.value = 'gpt-4o-mini';
                break;
            case 'claude':
                baseUrl.value = 'https://api.anthropic.com/v1';
                model.value = 'claude-3-haiku-20240307';
                break;
            case 'openrouter':
                baseUrl.value = 'https://openrouter.ai/api/v1';
                model.value = 'openai/gpt-4o-mini';
                break;
            default:
                baseUrl.value = '';
                model.value = 'gpt-4o-mini';
        }
    });

    // 温度滑块
    const tempSlider = document.getElementById('apiTemperature');
    const tempValue = document.getElementById('tempValue');
    tempSlider.addEventListener('input', () => {
        tempValue.textContent = tempSlider.value;
    });

    // 密码显示切换
    document.getElementById('toggleKeyVisibility').addEventListener('click', () => {
        const input = document.getElementById('apiKey');
        input.type = input.type === 'password' ? 'text' : 'password';
    });

    // 保存按钮
    document.getElementById('saveApiBtn').addEventListener('click', () => {
        collectApiSettings();
        saveToStorage();
        showToast('💾 API 设置已保存', 'success');
    });

    // 测试按钮
    document.getElementById('testApiBtn').addEventListener('click', async () => {
        collectApiSettings();
        hideApiStatus();

        if (!State.api.baseUrl || !State.api.apiKey) {
            showApiStatus('error', '请先填写 API Base URL 和 API Key');
            return;
        }

        // 明显的格式校验，避免无效 Key 白跑一趟
        if (State.api.provider === 'deepseek' && !/^sk-[0-9a-zA-Z]{20,}$/.test(State.api.apiKey)) {
            showApiStatus('error',
                '❌ API Key 格式不正确\n' +
                '你填的是：' + State.api.apiKey + '\n' +
                'DeepSeek 的 Key 应为 sk- 开头、后面跟约 32 位字符，例如 sk-abcdef1234567890abcdef1234567890\n' +
                '请到 https://platform.deepseek.com/api_keys 复制完整的 Key');
            return;
        }

        showLoading('正在测试连接...');
        try {
            const result = await rawTestConnection();
            showApiStatus('success', '✅ 连接成功！AI 回复:「' + result + '」');
            showToast('连接成功', 'success');
            console.log('[API测试] 成功:', result);
        } catch (err) {
            console.error('[API测试] 失败:', err);
            const detail = err.message || String(err);
            showApiStatus('error', '❌ ' + detail);
            showToast('连接失败', 'error');
        } finally {
            hideLoading();
        }
    });
}

function collectApiSettings() {
    State.api = {
        provider: document.getElementById('apiProvider').value,
        baseUrl: document.getElementById('apiBaseUrl').value.trim().replace(/\/$/, ''),
        apiKey: document.getElementById('apiKey').value.trim(),
        model: document.getElementById('apiModel').value.trim(),
        temperature: parseFloat(document.getElementById('apiTemperature').value)
    };
}

function updateSettingsForm() {
    if (!State.api) return;
    document.getElementById('apiProvider').value = State.api.provider || 'custom';
    document.getElementById('apiBaseUrl').value = State.api.baseUrl || '';
    document.getElementById('apiKey').value = State.api.apiKey || '';
    document.getElementById('apiModel').value = State.api.model || 'gpt-4o-mini';
    document.getElementById('apiTemperature').value = State.api.temperature ?? 0.7;
    document.getElementById('tempValue').textContent = State.api.temperature ?? 0.7;
}

function showApiStatus(type, msg) {
    const el = document.getElementById('apiStatus');
    el.className = 'api-status ' + type;
    el.textContent = msg;
    // 关键：必须清掉 inline style，否则 class 里的 display:block 无法生效
    el.style.display = 'block';
}

function hideApiStatus() {
    const el = document.getElementById('apiStatus');
    el.className = 'api-status';
    el.textContent = '';
    el.style.display = 'none';
}

// ---------- AI API 请求 ----------

// 简单直接测试连接（不带角色设定）
async function rawTestConnection() {
    const url = `${State.api.baseUrl}/chat/completions`;
    const body = JSON.stringify({
        model: State.api.model,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 20
    });

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${State.api.apiKey}`
            },
            body: body
        });
    } catch (networkErr) {
        // 网络层错误（CORS、DNS、SSL、连接拒绝等）
        throw new Error('网络错误: ' + networkErr.message);
    }

    const text = await response.text();
    
    if (!response.ok) {
        let detail = text;
        try {
            const j = JSON.parse(text);
            detail = j.error?.message || j.message || text;
        } catch {}
        
        // 常见错误友好提示
        if (response.status === 401) detail = 'API Key 无效或格式错误 (401)\n' + detail;
        else if (response.status === 404) detail = 'API 地址错误或模型不存在 (404)\n' + detail;
        else if (response.status === 429) detail = '请求频率超限 (429)\n' + detail;
        
        throw new Error(`HTTP ${response.status}: ${detail}`);
    }

    try {
        const data = JSON.parse(text);
        return data.choices?.[0]?.message?.content || '(空回复)';
    } catch (parseErr) {
        throw new Error('响应解析失败: ' + text.slice(0, 200));
    }
}

async function sendRequest(messages, temperature) {
    if (!State.api.baseUrl || !State.api.apiKey) {
        throw new Error('请先在「API」页面配置接口');
    }

    // 构建 system prompt (人物设定)
    let systemPrompt = '你是一个角色扮演助手。';
    const activeChar = getActiveChar();
    if (activeChar) {
        const c = activeChar;
        const ageLabel = AGE_LABEL_MAP[c.ageGroup];
        systemPrompt = `请扮演以下角色，始终以该角色的身份和语气回答，不要跳出角色：

【角色名称】：${c.name}
${c.identity ? `【身份/职业】：${c.identity}` : ''}
${ageLabel ? `【年龄段】：${ageLabel}` : ''}
${c.personality ? `【性格特点】：${c.personality}` : ''}
${c.background ? `【背景故事】：${c.background}` : ''}

关于回复格式的约定：
- 可以用 *动作描写* 或 *表情* 来表现神态，例如：*微微一笑* 没关系的
- *xxx* 之间的内容是动作、表情、心理活动，不是直接说出来的台词
- 台词部分直接写出来即可，不需要加引号

请自然地回应，不要在回复中说明自己是在扮演角色。用该角色的口吻说话。`;
    }

    const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
    ];

    const url = `${State.api.baseUrl}/chat/completions`;
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${State.api.apiKey}`
            },
            body: JSON.stringify({
                model: State.api.model,
                messages: fullMessages,
                temperature: temperature ?? State.api.temperature,
                stream: false
            })
        });
    } catch (networkErr) {
        throw new Error('网络错误（可能是 CORS 或无法连接）: ' + networkErr.message);
    }

    const text = await response.text();
    if (!response.ok) {
        let detail = text;
        try {
            const j = JSON.parse(text);
            detail = j.error?.message || j.message || text;
        } catch {}
        throw new Error(`${response.status}: ${detail}`);
    }

    try {
        const data = JSON.parse(text);
        return data.choices[0].message.content || '';
    } catch {
        throw new Error('响应格式异常: ' + text.slice(0, 100));
    }
}

// ---------- 对话功能 ----------
// 关闭移动端角色侧边栏
function closeSidebar() {
    document.getElementById('chatSidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('show');
}

function initChat() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');

    // 侧边栏切换（移动端）
    const sidebar = document.getElementById('chatSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    document.getElementById('sidebarToggle')?.addEventListener('click', () => {
        const opening = !sidebar.classList.contains('open');
        sidebar.classList.toggle('open', opening);
        overlay.classList.toggle('show', opening);
    });
    // 点遮罩关闭侧边栏
    overlay?.addEventListener('click', closeSidebar);
    // 侧边栏头部关闭按钮
    document.getElementById('closeSidebarBtn')?.addEventListener('click', closeSidebar);
    // 点主对话区关闭
    document.getElementById('chatMessages')?.addEventListener('click', closeSidebar);
    // 从对话页快速新建角色
    document.getElementById('newCharacterFromChat')?.addEventListener('click', () => {
        createNewCharacterAndEdit();
    });

    // 输入自适应高度
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });

    // Enter 发送
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    sendBtn.addEventListener('click', sendMessage);

    // 清空当前对话（只清当前角色）
    document.getElementById('clearChatBtn').addEventListener('click', () => {
        const id = State.activeCharacterId;
        if (!id) {
            showToast('请先选择角色', 'error');
            return;
        }
        const msgs = State.conversations[id] || [];
        if (msgs.length === 0) {
            showToast('对话已经是空的', 'error');
            return;
        }
        if (confirm('确定清空与当前角色的对话吗？')) {
            State.conversations[id] = [];
            saveToStorage();
            renderMessages();
            showToast('对话已清空', 'success');
        }
    });

    // 快捷提示
    document.getElementById('quickPrompts').addEventListener('click', (e) => {
        if (e.target.classList.contains('quick-prompt')) {
            input.value = e.target.textContent;
            input.focus();
        }
    });
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();

    if (!text) return;
    const c = getActiveChar();
    if (!c) {
        showToast('请先在左侧选择一个角色', 'error');
        return;
    }

    if (!State.api.baseUrl) {
        showToast('请先在「API」配置接口', 'error');
        switchToTab('settings');
        return;
    }

    const id = State.activeCharacterId;
    if (!State.conversations[id]) State.conversations[id] = [];
    const msgs = State.conversations[id];

    // 添加用户消息
    msgs.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';
    renderMessages();
    scrollToBottom();

    // 显示打字动画
    const typingEl = addTypingIndicator();

    try {
        const reply = await sendRequest(msgs);
        typingEl.remove();
        msgs.push({ role: 'assistant', content: reply });
        renderMessages();
        scrollToBottom();
        saveToStorage();
    } catch (err) {
        typingEl.remove();
        showToast('❌ ' + err.message, 'error');
    }
}

function addTypingIndicator() {
    const container = document.getElementById('chatMessages');
    const div = document.createElement('div');
    div.className = 'message ai';
    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';
    renderCharacterAvatar(avatarEl, getActiveChar());
    const contentEl = document.createElement('div');
    contentEl.className = 'msg-content';
    contentEl.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    div.appendChild(avatarEl);
    div.appendChild(contentEl);
    container.appendChild(div);
    scrollToBottom();
    return div;
}

function createMessageDiv(role, content) {
    const div = document.createElement('div');
    div.className = 'message ' + (role === 'user' ? 'user' : 'ai');
    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';
    if (role === 'user') {
        avatarEl.textContent = '🙂';
    } else {
        renderCharacterAvatar(avatarEl, getActiveChar());
    }
    const contentEl = document.createElement('div');
    contentEl.className = 'msg-content';
    contentEl.innerHTML = formatMessage(content);
    div.appendChild(avatarEl);
    div.appendChild(contentEl);
    return div;
}

function renderMessages() {
    const container = document.getElementById('chatMessages');
    const empty = document.getElementById('chatEmpty');
    const c = getActiveChar();
    const msgs = getActiveMessages();

    container.innerHTML = '';

    if (!c) {
        empty.innerHTML = '<div class="empty-icon">🎭</div><h3>选择一个角色开始对话</h3><p>左侧列表点选一个角色，或点 ➕ 新建</p>';
        container.appendChild(empty);
        empty.style.display = 'block';
        return;
    }

    if (msgs.length === 0) {
        // 显示欢迎语
        if (c.greeting) {
            container.appendChild(createMessageDiv('assistant', c.greeting));
        }
        // 仍然 append 空 state 隐藏占位
        empty.style.display = 'none';
        return;
    }

    // 有历史消息时也显示欢迎语（如果配置了）
    if (c.greeting && msgs.length > 0 && !msgs.find(m => m.role === 'assistant')) {
        // no-op
    }

    msgs.forEach(msg => {
        container.appendChild(createMessageDiv(msg.role, msg.content));
    });
    empty.style.display = 'none';
}

function restoreMessages() {
    renderMessages();
}

function scrollToBottom() {
    const container = document.getElementById('chatMessages');
    setTimeout(() => {
        container.scrollTop = container.scrollHeight;
    }, 50);
}

function formatMessage(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // **粗体**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // *动作/表情* -> 斜体动作（对话无关的旁白）
    html = html.replace(/(^|[^\*])\*([^\*\n]+?)\*/g, '$1<em class="action">$2</em>');
    html = html.replace(/\n/g, '<br>');
    return html;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function switchToTab(tabName) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    if (btn) btn.click();
}

// ---------- 写作功能 ----------
function initWrite() {
    // 类型切换
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            State.currentWriteType = btn.dataset.type;
        });
    });

    // 生成按钮
    document.getElementById('generateBtn').addEventListener('click', generateArticle);

    // 复制按钮
    document.getElementById('copyOutputBtn').addEventListener('click', () => {
        const content = document.getElementById('outputContent').innerText;
        navigator.clipboard.writeText(content).then(() => {
            showToast('已复制到剪贴板', 'success');
        });
    });

    // 重新生成
    document.getElementById('regenerateBtn').addEventListener('click', generateArticle);
}

async function generateArticle() {
    const topic = document.getElementById('writeTopic').value.trim();
    const requirements = document.getElementById('writeRequirements').value.trim();
    const length = document.getElementById('writeLength').value;
    const style = document.getElementById('writeStyle').value;
    const type = State.currentWriteType;

    if (!topic) {
        showToast('请输入写作主题', 'error');
        return;
    }

    if (!State.api.baseUrl) {
        showToast('请先在「API」配置接口', 'error');
        switchToTab('settings');
        return;
    }

    const lengthMap = { short: '约300字', medium: '约800字', long: '约1500字' };
    const typeMap = {
        article: '文章',
        story: '故事',
        poem: '诗歌',
        letter: '信件',
        essay: '随笔',
        speech: '演讲稿'
    };

    let systemPrompt = '你是一位才华横溢的作家。';
    const activeChar = getActiveChar();
    if (activeChar) {
        const c = activeChar;
        systemPrompt = `请以以下人物的身份和风格进行创作：

【角色】：${c.name}
${c.identity ? `【身份】：${c.identity}` : ''}
${c.personality ? `【性格/风格】：${c.personality}` : ''}
${c.background ? `【背景】：${c.background}` : ''}

创作时请保持该角色的独特风格和语言特点。`;
    }

    let userPrompt = `请创作一篇${typeMap[type]}，主题：「${topic}」。

要求：
- 篇幅：${lengthMap[length]}
- 风格：${style === 'default' ? '自然流畅' : style}
${requirements ? `- 额外要求：${requirements}` : ''}`;

    showLoading('✍️ 正在创作中...');
    try {
        const response = await sendRequest(
            [
                { role: 'user', content: userPrompt }
            ],
            0.9
        );
        
        // 直接用角色设定的 system prompt 版本
        const response2 = await fetch(`${State.api.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${State.api.apiKey}`
            },
            body: JSON.stringify({
                model: State.api.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.9
            })
        });

        if (!response2.ok) {
            const err = await response2.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${response2.status}`);
        }

        const data = await response2.json();
        const content = data.choices[0].message.content || response;
        
        document.getElementById('writeOutput').style.display = 'block';
        document.getElementById('outputTitle').textContent = `${typeMap[type]} · ${topic}`;
        document.getElementById('outputContent').innerHTML = formatWriteContent(content);
        document.getElementById('writeOutput').scrollIntoView({ behavior: 'smooth' });
        
        showToast('✨ 创作完成', 'success');
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}

function formatWriteContent(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // 处理标题行
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    // 处理粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // 处理换行（两个换行为段落）
    html = html.replace(/\n\n/g, '</p><p>');
    html = html.replace(/\n/g, '<br>');
    // 包裹段落
    if (!html.startsWith('<p>')) html = '<p>' + html;
    if (!html.endsWith('</p>')) html = html + '</p>';
    return html;
}

// ---------- 加载动画 ----------
function showLoading(text) {
    document.getElementById('loadingText').textContent = text || 'AI 正在思考中...';
    document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

// ---------- Toast ----------
let toastTimer = null;
function showToast(msg, type = '') {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.className = 'toast ' + type;
    toast.classList.add('show');
    
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 2500);
}
