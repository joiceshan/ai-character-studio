/* ============================================
   AI 人物工坊 - 应用逻辑
   ============================================ */

// ---------- 全局状态 ----------
const State = {
    character: null,
    api: {
        provider: 'custom',
        baseUrl: '',
        apiKey: '',
        model: 'gpt-4o-mini',
        temperature: 0.7
    },
    messages: [], // 当前对话历史
    currentWriteType: 'article'
};

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

// ---------- 本地存储 ----------
function saveToStorage() {
    try {
        localStorage.setItem('ai_character', JSON.stringify(State.character));
        localStorage.setItem('ai_api', JSON.stringify(State.api));
        localStorage.setItem('ai_messages', JSON.stringify(State.messages));
    } catch (e) {
        console.warn('保存失败:', e);
    }
}

function loadFromStorage() {
    try {
        const char = localStorage.getItem('ai_character');
        const api = localStorage.getItem('ai_api');
        const msgs = localStorage.getItem('ai_messages');
        if (char) State.character = JSON.parse(char);
        if (api) State.api = { ...State.api, ...JSON.parse(api) };
        if (msgs) State.messages = JSON.parse(msgs);
    } catch (e) {
        console.warn('加载失败:', e);
    }
}

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
    updateCharacterPreview();
    updateSettingsForm();
    restoreMessages();
    populateCharacterForm();
}

function updateCharacterPreview() {
    const preview = document.getElementById('chatCharacterPreview');
    const miniAvatar = document.getElementById('miniAvatar');
    const miniName = document.getElementById('miniName');
    const miniStatus = document.getElementById('miniStatus');

    if (State.character && State.character.name) {
        miniAvatar.textContent = State.character.avatar || '🤖';
        miniName.textContent = State.character.name;
        miniStatus.textContent = State.character.identity || '已就绪，开始对话吧';
    } else {
        miniAvatar.textContent = '🤖';
        miniName.textContent = '未设定角色';
        miniStatus.textContent = '请先去「设定」创建人物';
    }

    // 快捷提示
    const quickPrompts = document.getElementById('quickPrompts');
    if (State.character && State.character.name) {
        quickPrompts.style.display = 'flex';
    } else {
        quickPrompts.style.display = 'none';
    }
}

// ---------- 头像网格 ----------
function initAvatarGrid() {
    const grid = document.getElementById('avatarGrid');
    grid.innerHTML = AVATAR_OPTIONS.map(avatar => 
        `<button class="avatar-option" data-avatar="${avatar}">${avatar}</button>`
    ).join('');
    
    grid.querySelectorAll('.avatar-option').forEach(btn => {
        btn.addEventListener('click', () => {
            const avatar = btn.dataset.avatar;
            document.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            document.getElementById('avatarPreview').textContent = avatar;
            if (State.character) State.character.avatar = avatar;
        });
    });
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
        
        State.character = {
            avatar: document.querySelector('.avatar-option.selected')?.dataset.avatar || '🤖',
            name,
            identity: document.getElementById('charIdentity').value.trim(),
            personality: document.getElementById('charPersonality').value.trim(),
            background: document.getElementById('charBackground').value.trim(),
            greeting: document.getElementById('charGreeting').value.trim()
        };
        
        saveToStorage();
        updateCharacterPreview();
        
        // 更新头像选中
        document.querySelectorAll('.avatar-option').forEach(b => {
            b.classList.toggle('selected', b.dataset.avatar === State.character.avatar);
        });
        document.getElementById('avatarPreview').textContent = State.character.avatar;
        
        showToast('✨ 人物设定已保存', 'success');
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
    if (!State.character) return;
    
    document.getElementById('charName').value = State.character.name || '';
    document.getElementById('charIdentity').value = State.character.identity || '';
    document.getElementById('charPersonality').value = State.character.personality || '';
    document.getElementById('charBackground').value = State.character.background || '';
    document.getElementById('charGreeting').value = State.character.greeting || '';
    
    document.querySelectorAll('.avatar-option').forEach(b => {
        b.classList.toggle('selected', b.dataset.avatar === State.character.avatar);
    });
    document.getElementById('avatarPreview').textContent = State.character.avatar || '🤖';
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
            State.character = { ...preset };
            populateCharacterForm();
            saveToStorage();
            updateCharacterPreview();
            modal.style.display = 'none';
            showToast(`已载入「${preset.name}」`, 'success');
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
            case 'openai':
                baseUrl.value = 'https://api.openai.com/v1';
                model.value = 'gpt-4o-mini';
                break;
            case 'claude':
                baseUrl.value = 'https://api.anthropic.com/v1';
                model.value = 'claude-3-haiku-20240307';
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
        const statusEl = document.getElementById('apiStatus');
        statusEl.style.display = 'none';
        
        if (!State.api.baseUrl || !State.api.apiKey) {
            showApiStatus('error', '请先填写 API Base URL 和 API Key');
            return;
        }
        
        showLoading('正在测试连接...');
        try {
            await sendRequest([{ role: 'user', content: 'hi' }], 0.1);
            showApiStatus('success', '✅ 连接成功！API 配置正确');
            showToast('连接成功', 'success');
        } catch (err) {
            showApiStatus('error', '❌ 连接失败: ' + err.message);
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
}

// ---------- AI API 请求 ----------
async function sendRequest(messages, temperature) {
    if (!State.api.baseUrl || !State.api.apiKey) {
        throw new Error('请先在「API」页面配置接口');
    }

    // 构建 system prompt (人物设定)
    let systemPrompt = '你是一个角色扮演助手。';
    if (State.character) {
        const c = State.character;
        systemPrompt = `请扮演以下角色，始终以该角色的身份和语气回答，不要跳出角色：

【角色名称】：${c.name}
${c.identity ? `【身份/职业】：${c.identity}` : ''}
${c.personality ? `【性格特点】：${c.personality}` : ''}
${c.background ? `【背景故事】：${c.background}` : ''}

请自然地回应，不要在回复中说明自己是在扮演角色。用该角色的口吻说话。`;
    }

    const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
    ];

    const response = await fetch(`${State.api.baseUrl}/chat/completions`, {
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

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content || '';
}

// ---------- 对话功能 ----------
function initChat() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');

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

    // 清空对话
    document.getElementById('clearChatBtn').addEventListener('click', () => {
        if (State.messages.length === 0) return;
        if (confirm('确定要清空当前对话吗？')) {
            State.messages = [];
            saveToStorage();
            renderMessages();
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
    if (!State.character) {
        showToast('请先在「设定」创建人物', 'error');
        switchToTab('character');
        return;
    }
    
    if (!State.api.baseUrl) {
        showToast('请先在「API」配置接口', 'error');
        switchToTab('settings');
        return;
    }

    // 添加用户消息
    State.messages.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';
    renderMessages();
    scrollToBottom();

    // 显示打字动画
    const typingEl = addTypingIndicator();

    try {
        const reply = await sendRequest(State.messages);
        // 移除打字动画，添加 AI 回复
        typingEl.remove();
        State.messages.push({ role: 'assistant', content: reply });
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
    div.innerHTML = `
        <div class="msg-avatar">${State.character?.avatar || '🤖'}</div>
        <div class="msg-content">
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    container.appendChild(div);
    scrollToBottom();
    return div;
}

function renderMessages() {
    const container = document.getElementById('chatMessages');
    const empty = document.getElementById('chatEmpty');
    
    if (State.messages.length === 0) {
        container.innerHTML = '';
        container.appendChild(empty);
        empty.style.display = 'block';
        return;
    }
    
    container.innerHTML = '';
    
    // 如果有设定的角色，且没有历史消息，显示欢迎语
    if (State.character && State.character.greeting && State.messages.length === 0) {
        const welcomeMsg = document.createElement('div');
        welcomeMsg.className = 'message ai';
        welcomeMsg.innerHTML = `
            <div class="msg-avatar">${State.character.avatar}</div>
            <div class="msg-content">${escapeHtml(State.character.greeting)}</div>
        `;
        container.appendChild(welcomeMsg);
    }
    
    State.messages.forEach(msg => {
        const div = document.createElement('div');
        div.className = 'message ' + (msg.role === 'user' ? 'user' : 'ai');
        const avatar = msg.role === 'user' ? '🙂' : (State.character?.avatar || '🤖');
        div.innerHTML = `
            <div class="msg-avatar">${avatar}</div>
            <div class="msg-content">${formatMessage(msg.content)}</div>
        `;
        container.appendChild(div);
    });
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
    // 简单处理换行和粗体
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
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
    if (State.character) {
        const c = State.character;
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
