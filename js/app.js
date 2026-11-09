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

// 聊天内容分级
const RATING_MAP = {
    all: {
        label: '全年龄',
        badge: 'G',
        short: '健康向，不含成人内容',
        prompt: '内容健康向，适合所有年龄。不涉及性、血腥、暴力等成人话题，以日常、友情、亲情、成长为主。'
    },
    r14: {
        label: 'R14',
        badge: 'R14',
        short: '轻度暧昧与含蓄暗示',
        prompt: '轻度情感向（14+）。允许轻度暧昧、心跳加速的心理描写、含蓄的情感暗示和适度玩笑。禁止露骨性描写、性行为细节、血腥暴力细节。'
    },
    r16: {
        label: 'R16',
        badge: 'R16',
        short: '亲密接触与浪漫氛围',
        prompt: '青涩亲密向（16+）。允许接吻、拥抱等亲密肢体接触的描写，以及较直接的情感与欲望暗示。可以营造浪漫暧昧氛围，但不做露骨细节刻画。'
    },
    r18: {
        label: 'R18',
        badge: 'R18',
        short: '成熟直白的情感表达',
        prompt: '成人向（18+）。允许成熟、直白的情感表达与亲密氛围描写，语气可以更大胆暧昧。但仍需保持文学性，避免堆砌露骨的性行为细节。'
    },
    r20: {
        label: 'R20',
        badge: 'R20',
        short: '更直接的成人氛围',
        prompt: '成熟进阶向（20+）。这是面向成年读者的分级，你可以坦诚、直白地描写亲密互动与情欲场景，使用成熟、挑逗的语言和意象。不必回避身体细节，但仍需融入叙事节奏，让情感、心理与身体描写交织。角色可以主动表达欲望，对话可以露骨。'
    },
    r23: {
        label: 'R23',
        badge: 'R23',
        short: '最开放的成熟分级',
        prompt: '完全开放成人向（23+）。这是最高的开放级别，你可以进行最露骨、最直接、最细节的成人内容创作，包括明确的身体描写、露骨的情欲对话、直白的亲密互动。语气可以火热、挑逗、甚至带有角色扮演/支配服从等元素。只要不触碰安全底线（未成年人、违法），一切成熟题材都可自由展开，优先满足剧情张力与角色欲求。'
    }
};

// 全分级通用的安全底线
const RATING_SAFETY_RULE = `
【内容安全底线（最高优先级，任何分级都不可突破）】
1. 绝不生成涉及未成年人的性化内容或暗示。
2. 绝不生成违法内容（如犯罪教程、真实伤害他人的方法、危险物品制作等）。
3. 若角色年龄段为孩童(0-12)或少年(13-17)，一律按「全年龄」标准输出，忽略更高的分级设置。
4. 若用户要求突破以上底线，请保持角色口吻温和拒绝，并自然转移话题。`;

// 计算某角色实际生效的分级（未成年角色强制全年龄）
function resolveRating(char) {
    if (!char) return RATING_MAP.all;
    if (char.ageGroup === 'child' || char.ageGroup === 'teen') return RATING_MAP.all;
    return RATING_MAP[char.rating] || RATING_MAP.all;
}

// 给每个角色生成唯一 id
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- 本地存储 ----------
// 存储防抖 + 归档：避免每次全量序列化把主线程卡爆
const SAVE_DEBOUNCE_MS = 1800;
const MAX_ACTIVE_MSGS_PER_CHAR = 80;   // 主 key 里每角色最多留这么多条，超出的归档
let __saveTimer = null;
let __savePending = false;

function saveToStorage() {
    __savePending = true;
    if (__saveTimer) return;  // 已经排队了就不再开新计时器
    __saveTimer = setTimeout(() => {
        __saveTimer = null;
        __savePending = false;
        __doSaveToStorage();
    }, SAVE_DEBOUNCE_MS);
}

function __doSaveToStorage() {
    try {
        // ✅ 过滤掉 __uiOnly 标记的消息（"让 TA 继续"生成的 fake user 不入 storage）
        const convs = State.conversations || {};
        Object.keys(convs).forEach(id => {
            const arr = convs[id] || [];
            const filtered = arr.filter(m => !m || !m.__uiOnly);
            convs[id] = filtered.map(m => {
                if (m && '__uiOnly' in m) { const { __uiOnly, ...rest } = m; return rest; }
                return m;
            });
        });

        // 对话归档：每个角色超过 MAX_ACTIVE_MSGS_PER_CHAR 的老消息挪到单独 key
        Object.keys(convs).forEach(id => {
            const arr = convs[id] || [];
            if (arr.length > MAX_ACTIVE_MSGS_PER_CHAR) {
                const keep = MAX_ACTIVE_MSGS_PER_CHAR;
                const tail = arr.slice(-keep);
                const head = arr.slice(0, arr.length - keep);

                // 合并老的归档
                let archive = [];
                try { archive = JSON.parse(localStorage.getItem('ai_conversation_archive_' + id) || '[]'); } catch {}
                archive = archive.concat(head).slice(-500);  // 归档上限 500，防止越存越大
                localStorage.setItem('ai_conversation_archive_' + id, JSON.stringify(archive));

                convs[id] = tail;
            }
        });

        // 角色头像压缩：customAvatar 如果是 base64 且太长，存之前留个小缩略图标记
        const chars = State.characters.map(c => {
            const copy = { ...c };
            if (copy.customAvatar && copy.customAvatar.length > 80000) {
                // 太长的头像存之前先标记下（用户编辑时会重新上传，这里先保留原值）
                // 80KB 以上的 base64 写 localStorage 很慢，但不丢数据
            }
            return copy;
        });

        localStorage.setItem('ai_characters', JSON.stringify(chars));
        localStorage.setItem('ai_active_character', State.activeCharacterId || '');
        localStorage.setItem('ai_conversations', JSON.stringify(convs));
        localStorage.setItem('ai_api', JSON.stringify(State.api));
        refreshWriteCharSelect();
    } catch (e) {
        console.warn('保存失败:', e);
    }
}

// 读对话时把归档拼回来（只读一次，避免反复反序列化）
let __archiveLoaded = false;
function loadArchiveIntoState() {
    if (__archiveLoaded) return;
    __archiveLoaded = true;
    try {
        const convs = State.conversations || {};
        Object.keys(convs).forEach(id => {
            const archive = localStorage.getItem('ai_conversation_archive_' + id);
            if (!archive) return;
            try {
                const arr = JSON.parse(archive);
                if (Array.isArray(arr) && arr.length > 0) {
                    convs[id] = [...arr, ...(convs[id] || [])];
                }
            } catch {}
        });
    } catch {}
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
    // 把归档的老对话拼回来（只读一次）
    loadArchiveIntoState();
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
    initChatFab();
    initFontSize();
    updateUI();

    // 页面切后台/关闭时强制把防抖的 save flush 掉，防止丢数据
    const flushSave = () => {
        if (__saveTimer) {
            clearTimeout(__saveTimer);
            __saveTimer = null;
            __doSaveToStorage();
        }
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') flushSave();
    });
    window.addEventListener('beforeunload', flushSave);
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

            // tab 切换后重新检测浮动滚动按钮是否该显示
            if (State.__refreshFab) {
                State.__refreshFab();
                setTimeout(State.__refreshFab, 400);
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
        if (miniAvatar) renderCharacterAvatar(miniAvatar, c);
        if (miniName) miniName.textContent = c.name;
        const ageLabel = AGE_LABEL_MAP[c.ageGroup] || '';
        const rating = resolveRating(c);
        const parts = [c.identity, ageLabel].filter(Boolean);
        if (miniStatus) {
            miniStatus.textContent = (parts.join(' · ') || '已就绪，开始对话吧');
        }

        // 聊天页分级快捷按钮
        const chip = document.getElementById('ratingChip');
        if (chip) {
            chip.style.display = 'inline-block';
            chip.textContent = `${rating.badge} ▾`;
            chip.classList.toggle('restricted', c.ageGroup === 'child' || c.ageGroup === 'teen');
        }
    } else {
        if (miniAvatar) miniAvatar.textContent = '🤖';
        if (miniName) miniName.textContent = '未选择角色';
        if (miniStatus) miniStatus.textContent = '点击左侧列表选择一个角色';
        const chip = document.getElementById('ratingChip');
        if (chip) chip.style.display = 'none';
    }
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
            scrollToBottom();
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
    document.getElementById('charRating').value = 'all';
    document.getElementById('charPersonality').value = '';
    document.getElementById('charBackground').value = '';
    document.getElementById('charGreeting').value = '';
    // 重置头像
    pendingCustomAvatar = '';
    document.querySelectorAll('.avatar-option').forEach(b => b.classList.remove('selected'));
    const first = document.querySelector('.avatar-option');
    if (first) {
        first.classList.add('selected');
        setAvatarDisplay(first.dataset.avatar, false);
    }
    document.getElementById('avatarFileInput').value = '';
    document.getElementById('clearCustomAvatarBtn').style.display = 'none';
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

// 表当前正在编辑的自定义头像（base64），未保存前只存在这里
let pendingCustomAvatar = '';

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
            pendingCustomAvatar = ev.target.result;
            document.getElementById('clearCustomAvatarBtn').style.display = 'inline-block';
            showToast('头像已更新，记得点「保存人物设定」', 'success');
        };
        reader.readAsDataURL(file);
    });
    document.getElementById('clearCustomAvatarBtn').addEventListener('click', () => {
        clearCustomAvatarBtn();
        // 取消自定义后回到第一个 emoji
        const first = document.querySelector('.avatar-option');
        if (first) first.classList.add('selected');
        setAvatarDisplay(first?.dataset.avatar || '🤖', false);
    });
}

function clearCustomAvatarBtn() {
    pendingCustomAvatar = '';
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
    // ✨ AI 帮我设定角色 —— 一句话生成
    document.getElementById('aiGenCharBtn').addEventListener('click', openAiGenSheet);

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

        const charData = {
            avatar: emojiAvatar,
            customAvatar: pendingCustomAvatar,
            name,
            identity: document.getElementById('charIdentity').value.trim(),
            ageGroup: document.getElementById('charAgeGroup').value,
            rating: document.getElementById('charRating').value,
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

    // 清除该角色对话记忆（只清空对话，保留人物设定）
    document.getElementById('clearMemoryBtn').addEventListener('click', () => {
        const c = getActiveChar();
        if (!c) { showToast('请先选择角色', 'error'); return; }
        const id = c.id;
        const msgs = State.conversations[id] || [];
        if (msgs.length === 0) { showToast('该角色没有对话记忆', 'error'); return; }
        if (confirm(`确定清除「${c.name}」的全部对话记忆？\n（人物设定会保留，下次对话从 0 开始）`)) {
            State.conversations[id] = [];
            saveToStorage();
            updateUI();
            showToast('对话记忆已清除', 'success');
        }
    });

    // 分享（导出精简分享码：不含头像 base64，字段名压到最短）
    document.getElementById('exportCharBtn').addEventListener('click', () => {
        const nameEl = document.getElementById('charName');
        const name = nameEl.value.trim();
        if (!name) { showToast('请先填写人物名称', 'error'); return; }

        const emojiAvatar = document.querySelector('.avatar-option.selected')?.dataset.avatar || '';
        const data = {
            t: 'acs',
            n: name,
            a: emojiAvatar,
            i: document.getElementById('charIdentity').value.trim(),
            g: document.getElementById('charAgeGroup').value,
            r: document.getElementById('charRating').value,
            p: document.getElementById('charPersonality').value.trim(),
            b: document.getElementById('charBackground').value.trim(),
            s: document.getElementById('charGreeting').value.trim()
        };
        openShareSheet(JSON.stringify(data));
    });

    // 导入（粘贴分享码重建角色）
    document.getElementById('importCharBtn').addEventListener('click', openImportSheet);

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
    document.getElementById('charRating').value = c.rating || 'all';
    document.getElementById('charPersonality').value = c.personality || '';
    document.getElementById('charBackground').value = c.background || '';
    document.getElementById('charGreeting').value = c.greeting || '';

    document.querySelectorAll('.avatar-option').forEach(b => {
        b.classList.toggle('selected', b.dataset.avatar === c.avatar);
    });

    // 关键：同步编辑中的自定义头像，保存时用这个值
    pendingCustomAvatar = c.customAvatar || '';
    if (pendingCustomAvatar) {
        setAvatarDisplay(pendingCustomAvatar, true);
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
                rating: 'all',
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

async function sendRequest(messages, temperature, extraInstruction, responseFormat) {
    if (!State.api.baseUrl || !State.api.apiKey) {
        throw new Error('请先在「API」页面配置接口');
    }

    // 构建 system prompt (人物设定)
    let systemPrompt = '你是一个角色扮演助手。';
    const activeChar = getActiveChar();
    if (activeChar) {
        const c = activeChar;
        const ageLabel = AGE_LABEL_MAP[c.ageGroup];
        const rating = resolveRating(c);
        systemPrompt = `请扮演以下角色，始终以该角色的身份和语气回答，不要跳出角色：

【角色名称】：${c.name}
${c.identity ? `【身份/职业】：${c.identity}` : ''}
${ageLabel ? `【年龄段】：${ageLabel}` : ''}
${c.personality ? `【性格特点】：${c.personality}` : ''}
${c.background ? `【背景故事】：${c.background}` : ''}

【内容分级】：${rating.label}
${rating.prompt}
${RATING_SAFETY_RULE}

关于回复格式的约定：
- 可以用 *动作描写* 或 *表情* 来表现神态，例如：*微微一笑* 没关系的
- *xxx* 之间的内容是动作、表情、心理活动，不是直接说出来的台词
- 台词部分直接写出来即可，不需要加引号

请自然地回应，不要在回复中说明自己是在扮演角色。用该角色的口吻说话。`;
    }

    if (extraInstruction) {
        systemPrompt += '\n\n---\n【本次回复的额外指令】\n' + extraInstruction;
    }

    const fullMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.filter(m => m.role === 'user' || m.role === 'assistant')
    ];

    const url = `${State.api.baseUrl}/chat/completions`;
    const body = {
        model: State.api.model,
        messages: fullMessages,
        temperature: temperature ?? State.api.temperature,
        stream: false
    };
    if (responseFormat) body.response_format = responseFormat;

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${State.api.apiKey}`
            },
            body: JSON.stringify(body)
        });
    } catch (networkErr) {
        State.__lastRawResp = { err: 'FETCH_FAIL: ' + networkErr.message };
        throw new Error('网络错误（可能是 CORS 或无法连接）: ' + networkErr.message);
    }

    const text = await response.text();
    State.__lastRawResp = { ok: response.ok, status: response.status, text: text.slice(0, 1500) };
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

// ---------- 聊天页内容分级切换 ----------
function openRatingPicker() {
    const c = getActiveChar();
    if (!c) {
        showToast('请先选择一个角色', 'error');
        return;
    }

    const restricted = c.ageGroup === 'child' || c.ageGroup === 'teen';
    const current = c.rating || 'all';
    const optionsEl = document.getElementById('ratingOptions');

    optionsEl.innerHTML = Object.entries(RATING_MAP).map(([key, r]) => {
        const disabled = restricted && key !== 'all';
        return `
            <button class="rating-option${key === current ? ' selected' : ''}${disabled ? ' disabled' : ''}" data-key="${key}">
                <span class="rating-badge">${r.badge}</span>
                <span class="rating-text">
                    <span class="rating-label">${r.label}</span>
                    <span class="rating-short">${r.short}</span>
                </span>
                ${key === current ? '<span class="rating-check">✓</span>' : ''}
            </button>`;
    }).join('');

    document.getElementById('ratingPickerNote').style.display = restricted ? 'block' : 'none';

    optionsEl.querySelectorAll('.rating-option').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('disabled')) {
                showToast('该角色年龄段为未成年，已强制限制为全年龄', 'error');
                return;
            }
            const key = btn.dataset.key;
            const idx = State.characters.findIndex(x => x.id === State.activeCharacterId);
            if (idx >= 0) {
                State.characters[idx].rating = key;
                saveToStorage();
                updateUI();
            }
            closeRatingPicker();
            showToast(`已切换为 ${RATING_MAP[key].label}`, 'success');
        });
    });

    document.getElementById('ratingPicker').classList.add('show');
}

function closeRatingPicker() {
    document.getElementById('ratingPicker').classList.remove('show');
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

    // 内容分级快捷切换
    document.getElementById('ratingChip')?.addEventListener('click', openRatingPicker);
    document.getElementById('closeRatingPicker')?.addEventListener('click', closeRatingPicker);
    document.getElementById('ratingPicker')?.addEventListener('click', (e) => {
        if (e.target.id === 'ratingPicker') closeRatingPicker();
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

    // 帮我继续聊
    document.getElementById('continueChatBtn')?.addEventListener('click', continueChat);

    // 清空当前对话（只清当前角色）
    // 清空 / 删除对话（弹出多选菜单）
    const clearBtn = document.getElementById('clearChatBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openClearSheet();
        });
    }
}

// ---------- 删除对话：底部抽屉（动态挂到 body，避免被父级布局裁切） ----------
// ---------- 分享角色（页面内展示精简分享码） ----------
function openShareSheet(json) {
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `
        <div class="sheet-handle"></div>
        <div class="sheet-title">📤 分享角色</div>
        <div class="sheet-sub">长按下面的文字 → 选「复制」即可发给朋友</div>
        <div class="share-json-box" id="shareJsonBox"></div>
        <button class="sheet-item" id="shareCopyBtn">📋 一键复制到剪贴板</button>
        <button class="sheet-cancel">关闭</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    // 用 div 显示（长按会弹系统复制菜单），用 textContent 赋值避免 HTML 被转义/注入
    sheet.querySelector('#shareJsonBox').textContent = json;

    const close = () => {
        overlay.remove();
        sheet.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    overlay.addEventListener('click', close);
    sheet.querySelector('.sheet-cancel').addEventListener('click', close);

    // 一键复制：hidden textarea + execCommand('copy') —— 移动端最稳的组合
    sheet.querySelector('#shareCopyBtn').addEventListener('click', () => {
        try {
            const ta = document.createElement('textarea');
            ta.value = json;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            ta.style.top = '-9999px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, ta.value.length);
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            if (ok) showToast('✅ 已复制到剪贴板', 'success');
            else showToast('❌ 复制失败，请长按文字手动复制', 'error');
        } catch (e) {
            showToast('❌ 复制失败，请长按文字手动复制', 'error');
        }
    });
}

// ---------- 导入角色（页面内粘贴框，兼容各种字段名/杂字） ----------
// ---------- AI 帮我设定角色（一句话生成所有字段） ----------
function openAiGenSheet() {
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `
        <div class="sheet-handle"></div>
        <div class="sheet-title">✨ AI 帮我设定角色</div>
        <div class="sheet-sub">用一句话描述你想要的角色，比如：「一个温柔又有点腹黑的古代女医官」</div>
        <textarea class="import-json-box" id="aiGenInput" rows="3" placeholder="例：一个2000年的女高中生，外表乖但内心毒舌，喜欢画画，成绩很好"></textarea>
        <div class="sheet-row">
            <div class="sheet-row-item">
                <label class="ai-gen-label">年龄段</label>
                <select class="ai-gen-select" id="aiGenAge">
                    <option value="">AI 自己定</option>
                    <option value="child">孩童 (0-12)</option>
                    <option value="teen">少年 (13-17)</option>
                    <option value="young">青年 (18-29)</option>
                    <option value="adult">壮年 (30-49)</option>
                    <option value="middle">中年 (50-64)</option>
                    <option value="senior">老年 (65+)</option>
                </select>
            </div>
            <div class="sheet-row-item">
                <label class="ai-gen-label">内容分级</label>
                <select class="ai-gen-select" id="aiGenRating">
                    <option value="all">G · 全年龄</option>
                    <option value="r14">R14</option>
                    <option value="r16">R16</option>
                    <option value="r18">R18</option>
                    <option value="r20">R20</option>
                    <option value="r23">R23</option>
                </select>
            </div>
        </div>
        <div class="sheet-tip" id="aiGenErr" style="display:none;color:#f56565;"></div>
        <button class="sheet-item" id="aiGenDoBtn">✨ 让 AI 帮我填好</button>
        <button class="sheet-cancel">取消</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    const close = () => {
        overlay.remove();
        sheet.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', close);
    sheet.querySelector('.sheet-cancel').addEventListener('click', close);

    const btn = sheet.querySelector('#aiGenDoBtn');
    const errBox = sheet.querySelector('#aiGenErr');

    btn.addEventListener('click', async () => {
        errBox.style.display = 'none';
        const desc = sheet.querySelector('#aiGenInput').value.trim();
        if (!desc) {
            errBox.style.display = 'block';
            errBox.textContent = '请先写一句对角色的描述';
            return;
        }
        if (!State.api.baseUrl || !State.api.apiKey) {
            errBox.style.display = 'block';
            errBox.textContent = '请先去「⚙️ API」页面配置接口';
            return;
        }
        const ageFixed = sheet.querySelector('#aiGenAge').value;
        const ratingFixed = sheet.querySelector('#aiGenRating').value;

        btn.disabled = true;
        btn.textContent = '⏳ AI 正在构思...';
        try {
            const d = await aiGenerateCharacter(desc, ageFixed, ratingFixed);
            // 回填表单
            document.getElementById('charName').value = d.name || '';
            document.getElementById('charIdentity').value = d.identity || '';
            document.getElementById('charAgeGroup').value = d.ageGroup || (ageFixed || 'young');
            document.getElementById('charRating').value = d.rating || ratingFixed;
            document.getElementById('charPersonality').value = d.personality || '';
            document.getElementById('charBackground').value = d.background || '';
            document.getElementById('charGreeting').value = d.greeting || '';
            // AI 不生成头像，让用户自己选
            pendingCustomAvatar = '';
            window.__charFormMode = 'new';
            window.__charFormEditId = null;
            close();
            showToast('✨ 已填好，请检查后点保存', 'success');
        } catch (e) {
            errBox.style.display = 'block';
            errBox.textContent = '生成失败：' + (e.message || e);
        } finally {
            btn.disabled = false;
            btn.textContent = '✨ 让 AI 帮我填好';
        }
    });
}

// 独立的 AI 生成角色调用（不走 sendRequest，不带任何角色上下文）
async function aiGenerateCharacter(desc, ageFixed, ratingFixed) {
    const url = `${State.api.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const ageHint = ageFixed ? `（年龄阶段强制为 ${ageFixed}）` : '';
    const ratingHint = ratingFixed ? `（内容分级强制为 ${ratingFixed}）` : '';

    const prompt = `请根据下面的描述，构思一个完整的角色扮演角色，并只输出一段严格的 JSON 对象，不要输出任何额外的解释、代码块标记或前后缀：

角色描述：${desc}${ageHint}${ratingHint}

JSON 必须包含以下字段（全部为字符串）：
{
  "name": "角色名字（2-4字中文，不姓也可以，起个有辨识度的名字）",
  "identity": "身份/职业（20字内，例：古代女医官 / 高中生 / 海盗船长）",
  "ageGroup": "孩童|少年|青年|壮年|中年|老年",
  "rating": "all|r14|r16|r18|r20|r23",
  "personality": "性格特点（2-3句，描述说话语气、脾气、喜好）",
  "background": "背景故事（3-5句，交代出身、经历、现在的处境）",
  "greeting": "TA 跟用户打招呼的第一句话（可以用 *动作描写*，例：*微微一笑* 你好呀，今天想聊点什么？）"
}

内容安全底线：
- 若角色年龄段为孩童(0-12)或少年(13-17)，rating 一律为 "all"（强制全年龄）
- 绝不生成未成年人的性化内容或暗示
- 绝不生成违法内容

只输出 JSON，不要任何额外文字，不要用 \`\`\`json 包裹。`;

    let resp;
    try {
        resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${State.api.apiKey}`
            },
            body: JSON.stringify({
                model: State.api.model,
                messages: [
                    { role: 'system', content: '你是角色设定师，只输出合法 JSON，绝不输出任何 JSON 之外的文字。' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                stream: false,
                response_format: { type: 'json_object' }
            })
        });
    } catch (e) {
        throw new Error('网络错误：' + e.message);
    }

    if (!resp.ok) {
        let txt = '';
        try { txt = await resp.text(); } catch {}
        throw new Error(`API 返回 ${resp.status}：${txt.slice(0, 120)}`);
    }
    const j = await resp.json();
    let content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    content = content.trim();

    // 宽容解析：去掉可能的代码块标记，截取 { ... } 本体
    content = content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    const st = content.indexOf('{'), en = content.lastIndexOf('}');
    if (st >= 0 && en > st) content = content.slice(st, en + 1);

    let obj;
    try {
        obj = JSON.parse(content);
    } catch (e) {
        throw new Error('AI 返回格式不是合法 JSON，请再试一次');
    }
    if (!obj || typeof obj !== 'object') throw new Error('AI 返回了奇怪的东西');
    if (!obj.name) throw new Error('AI 没能给角色起名字，描述再具体点试试');

    return obj;
}

function openImportSheet() {
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `
        <div class="sheet-handle"></div>
        <div class="sheet-title">📥 导入角色</div>
        <div class="sheet-sub">把朋友发来的分享码粘贴到下面</div>
        <textarea class="import-json-box" id="importJsonBox" placeholder="粘贴分享码，形如 {&quot;t&quot;:&quot;acs&quot;,&quot;n&quot;:&quot;名字&quot;,...}"></textarea>
        <div class="sheet-tip" id="importErr" style="display:none;color:#f56565;"></div>
        <button class="sheet-item" id="importDoBtn">✅ 导入并填入设定表</button>
        <button class="sheet-cancel">取消</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    const ta = sheet.querySelector('#importJsonBox');
    const errBox = sheet.querySelector('#importErr');

    const close = () => {
        overlay.remove();
        sheet.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    overlay.addEventListener('click', close);
    sheet.querySelector('.sheet-cancel').addEventListener('click', close);

    const fail = (msg) => {
        errBox.style.display = 'block';
        errBox.textContent = msg;
    };

    sheet.querySelector('#importDoBtn').addEventListener('click', () => {
        errBox.style.display = 'none';

        // 🔴 宽容解析：去空白/换行/引号包裹/HTML 实体，只截取 { ... } 本体
        let s = (ta.value || '').trim();
        s = s.replace(/^\uFEFF/, '')
             .replace(/&quot;|&#34;/g, '"')
             .replace(/&#39;|&apos;/g, "'")
             .replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>');
        // 去掉可能被包在别人加的引号里
        if (/^["']\s*\{/.test(s)) s = s.slice(1, s.lastIndexOf('}') + 1);
        const st = s.indexOf('{'), en = s.lastIndexOf('}');
        if (st >= 0 && en > st) s = s.slice(st, en + 1);

        let d;
        try {
            d = JSON.parse(s);
        } catch (e) {
            fail('分享码不完整或格式错误：' + e.message);
            return;
        }
        // 万一被二次 stringify（整段是个字符串）
        if (typeof d === 'string') {
            try { d = JSON.parse(d); } catch {}
        }
        if (!d || typeof d !== 'object') {
            fail('分享码格式不对，应为 { ... } 形式的对象');
            return;
        }

        // 兼容精简码（n/i/p/b/s）和旧版长字段，再兜底几个常见中文键
        const name = (d.n || d.name || d['名字'] || d['姓名'] || '').toString().trim();
        if (!name) {
            fail('分享码里没有找到人物名字（缺少 n / name 字段），请确认复制完整');
            return;
        }

        document.getElementById('charName').value = name;
        document.getElementById('charIdentity').value = d.i || d.identity || '';
        document.getElementById('charAgeGroup').value = d.g || d.ageGroup || 'young';
        document.getElementById('charRating').value = d.r || d.rating || 'all';
        document.getElementById('charPersonality').value = d.p || d.personality || '';
        document.getElementById('charBackground').value = d.b || d.background || '';
        document.getElementById('charGreeting').value = d.s || d.greeting || '';

        // 头像：旧版可能带 customAvatar，优先用；否则回退 emoji
        if (d.customAvatar && typeof d.customAvatar === 'string' && d.customAvatar.length > 10) {
            pendingCustomAvatar = d.customAvatar;
        } else {
            pendingCustomAvatar = '';
            const av = d.a || d.avatar;
            if (av) {
                document.querySelectorAll('.avatar-option').forEach(b => {
                    b.classList.toggle('selected', b.dataset.avatar === av);
                });
            }
        }

        window.__charFormMode = 'new';
        window.__charFormEditId = null;
        close();
        showToast(`✨ 已导入「${name}」，检查后点保存`, 'success');
    });
}

function openClearSheet() {
    const c = getActiveChar();
    if (!c) { showToast('请先选择角色', 'error'); return; }
    const id = State.activeCharacterId;
    const msgs = State.conversations[id] || [];
    if (msgs.length === 0) { showToast('对话已经是空的', 'error'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    overlay.id = 'clearSheetOverlay';

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `
        <div class="sheet-handle"></div>
        <div class="sheet-title">删除「${escapeHtml(c.name)}」的对话</div>
        <div class="sheet-sub">当前共 ${msgs.length} 条消息</div>
        <button class="sheet-item" data-action="all">🗑️ 清空全部对话（保留角色）</button>
        <button class="sheet-item" data-action="last5">⬅️ 删除最后 5 条</button>
        <button class="sheet-item" data-action="last10">⬅️ 删除最后 10 条</button>
        <button class="sheet-item" data-action="onlyAi">🤖 只删除 AI 的回复</button>
        <button class="sheet-item" data-action="onlyUser">🙂 只删除我发的消息</button>
        <div class="sheet-tip">💡 每条消息头像下方有 ✕ 可单独删除</div>
        <button class="sheet-cancel">取消</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    const close = () => {
        overlay.remove();
        sheet.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    overlay.addEventListener('click', close);
    sheet.querySelector('.sheet-cancel').addEventListener('click', close);

    sheet.querySelectorAll('.sheet-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const cur = State.conversations[id] || [];
            let modified = false;

            if (action === 'all') {
                if (confirm(`确定清空与「${c.name}」的全部对话？`)) {
                    State.conversations[id] = [];
                    modified = true;
                    showToast('对话已清空', 'success');
                }
            } else if (action === 'last5' || action === 'last10') {
                const n = action === 'last5' ? 5 : 10;
                const actual = Math.min(n, cur.length);
                if (confirm(`确定删除最后 ${actual} 条对话？`)) {
                    State.conversations[id].splice(cur.length - actual, actual);
                    modified = true;
                    showToast(`已删除最后 ${actual} 条`, 'success');
                }
            } else if (action === 'onlyAi') {
                if (confirm('确定删除所有 AI 回复，保留你的消息？')) {
                    State.conversations[id] = cur.filter(m => m.role !== 'assistant');
                    modified = true;
                    showToast('AI 回复已清除', 'success');
                }
            } else if (action === 'onlyUser') {
                if (confirm('确定删除你发的所有消息，保留 AI 回复？')) {
                    State.conversations[id] = cur.filter(m => m.role !== 'user');
                    modified = true;
                    showToast('你的消息已清除', 'success');
                }
            }

            if (modified) {
                saveToStorage();
                renderMessages();
                scrollToBottom();
                close();
            }
        });
    });
}

async function sendMessage() {
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const text = input.value.trim();

    if (!text) return;
    if (State.sending) {
        showToast('上一条还在回复中，请稍候', 'error');
        return;
    }
    const c = getActiveChar();
    if (!c) {
        showToast('请先在左侧选择一个角色', 'error');
        return;
    }

    // ✅ 用户真的发消息了，清掉"让 TA 继续"残留的 fake user
    State.__pendingFakeUser = null;
    const activeId = State.activeCharacterId;
    if (activeId && State.conversations[activeId]) {
        State.conversations[activeId] = State.conversations[activeId].filter(m => !m || !m.__uiOnly);
    }

    if (!State.api.baseUrl) {
        showToast('请先在「API」配置接口', 'error');
        switchToTab('settings');
        return;
    }

    const id = State.activeCharacterId;
    if (!State.conversations[id]) State.conversations[id] = [];
    const msgs = State.conversations[id];

    // 添加用户消息并立即保存（即使接口失败也不会丢失）
    msgs.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';
    saveToStorage();
    renderMessages();
    scrollToBottom();

    // 显示打字动画
    State.sending = true;
    setSendingUI(true);
    const typingEl = addTypingIndicator();

    try {
        const reply = await sendRequest(msgs);
        typingEl.remove();
        msgs.push({ role: 'assistant', content: reply });
        saveToStorage();
        renderMessages();
        scrollToBottom();
    } catch (err) {
        typingEl.remove();
        msgs.push({ role: 'error', content: '⚠️ 回复失败：' + err.message + '\n（可重新发送再试，或到「⚙️ API」检查配置）' });
        renderMessages();
        scrollToBottom();
        showToast('❌ ' + err.message, 'error');
    } finally {
        State.sending = false;
        setSendingUI(false);
    }
}

// 从 AI 返回的文本里宽容提取 JSON 对象（去掉 ``` 代码块、截取 { ... }）
function extractJsonObject(text) {
    if (!text) return null;
    let s = String(text).trim()
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '');
    const st = s.indexOf('{'), en = s.lastIndexOf('}');
    if (st < 0 || en <= st) return null;
    s = s.slice(st, en + 1);
    try {
        const o = JSON.parse(s);
        return (o && typeof o === 'object') ? o : null;
    } catch {
        return null;
    }
}

// 让 AI 模拟"对话另一方（用户）"单独说一句话。
// 不走 sendRequest（它会先拼角色设定的 system prompt），直接用单条 user 消息发请求。
async function sendRawUserSimRequest(userSimPrompt) {
    if (!State.api.baseUrl || !State.api.apiKey) return '';
    const url = `${State.api.baseUrl}/chat/completions`;
    const body = {
        model: State.api.model,
        messages: [{ role: 'user', content: userSimPrompt }],
        temperature: State.api.temperature ?? 0.7,
        stream: false
    };
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${State.api.apiKey}`
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) return '';
    const text = await response.text();
    try {
        const data = JSON.parse(text);
        return (data.choices?.[0]?.message?.content || '').trim();
    } catch {
        return '';
    }
}

// 输入框和「帮我继续聊」按钮统一的 loading/禁用态
function setSendingUI(sending) {
    const sendBtn = document.getElementById('sendBtn');
    const continueBtn = document.getElementById('continueChatBtn');
    if (sendBtn) sendBtn.disabled = sending;
    if (continueBtn) {
        continueBtn.disabled = sending;
        continueBtn.textContent = sending ? '⏳ TA 正在思考…' : '✨ 不知道聊什么？让 TA 继续';
    }
}

// 用户没说话，让 AI 主动接下一句话题
async function continueChat() {
    const sendBtn = document.getElementById('sendBtn');
    const continueBtn = document.getElementById('continueChatBtn');

    if (State.sending) {
        showToast('TA 正在说话，请稍候', 'error');
        return;
    }
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

    // 只有一条欢迎语时也可以继续（会跳过它，让 AI 主动打招呼）
    if (msgs.length === 0) {
        // 把欢迎语也带进上下文，让 AI 基于它接下一句
    }

    State.sending = true;
    setSendingUI(true);
    const typingEl = addTypingIndicator();

    try {
        // ✅ 一次 API 调用，让 AI 输出对话脚本，拆成 3 条气泡：TA 说 → 你（AI 模拟）说 → TA 再说
        // 这样最后一条永远是 TA 那边，且只调用一次，没有 fake user 污染 history 的问题
        const scriptPrompt = `现在对话安静了。请你以这个角色的口吻，继续对话。
请输出一段 3 行的对话脚本，格式严格如下（每一行都以"TA说："或"你说："开头）：

TA说：（你的角色主动接下一句，可带 *动作描写*）
你说：（对话另一方听到后会自然回应一句，15-30字，口语化）
TA说：（你的角色再回应"你说"的那一句，可带 *动作描写*）

⚠️ 严格要求：
- 只输出这三行，不要解释、不要加引号、不要加```代码块标记
- "TA说："是你的角色说的，"你说："是对话另一方（屏幕前的真人用户）会说的
- 三行要能自然衔接，像真实对话
- 每条台词 1-2 句自然语气`;

        const scriptReply = await sendRequest(msgs, undefined, scriptPrompt);
        typingEl.remove();

        // 解析三行
        const scriptText = (scriptReply || '').trim();
        const lines = scriptText.split(/\n+/).map(l => l.trim()).filter(Boolean);

        const extracts = [];  // [{role: 'assistant'|'user', text: '...'}]
        for (const line of lines) {
            let m;
            m = line.match(/^(?:TA\s*说\s*[:：]\s*)(.+)$/i);
            if (m) { extracts.push({ role: 'assistant', text: m[1].trim() }); continue; }
            m = line.match(/^(?:你\s*说\s*[:：]\s*)(.+)$/);
            if (m) { extracts.push({ role: 'user', text: m[1].trim() }); continue; }
            m = line.match(/^(?:我\s*说\s*[:：]\s*)(.+)$/);  // 有些模型会用"我说"代替"你说"
            if (m) { extracts.push({ role: 'user', text: m[1].trim() }); continue; }
        }

        // 如果完全没解析出来，fallback：把整段当 assistant 台词
        if (extracts.length === 0) {
            if (scriptText) extracts.push({ role: 'assistant', text: scriptText });
        }

        // 修正顺序：保证最后一条是 TA（assistant）
        if (extracts.length > 0 && extracts[extracts.length - 1].role !== 'assistant') {
            extracts.pop();
        }

        // 如果没 assistant，放弃
        const hasAssistant = extracts.some(e => e.role === 'assistant');
        if (!hasAssistant) {
            showToast('❌ AI 没返回有效的继续对话脚本', 'error');
            return;
        }

        // ✅ 把所有 assistant push 进 msgs（入 history），user 的只临时显示不入 history
        const fakeUserText = extracts.find(e => e.role === 'user')?.text || null;
        for (const e of extracts) {
            if (e.role === 'assistant') {
                msgs.push({ role: 'assistant', content: e.text });
            }
        }
        State.__pendingFakeUser = fakeUserText;

        saveToStorage();
        renderMessages();
        scrollToBottom();
    } catch (err) {
        typingEl.remove();
        msgs.push({ role: 'error', content: '⚠️ 继续对话失败：' + err.message });
        renderMessages();
        scrollToBottom();
        showToast('❌ ' + err.message, 'error');
    } finally {
        State.sending = false;
        setSendingUI(false);
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

function createMessageDiv(role, content, index, onDelete) {
    const div = document.createElement('div');
    if (role === 'error') {
        div.className = 'msg-error';
        div.textContent = content;
        return div;
    }
    div.className = 'message ' + (role === 'user' ? 'user' : 'ai');

    // 头像列：头像 + 下方删除按钮
    const avatarCol = document.createElement('div');
    avatarCol.className = 'msg-avatar-col';

    const avatarEl = document.createElement('div');
    avatarEl.className = 'msg-avatar';
    if (role === 'user') {
        avatarEl.textContent = '🙂';
    } else {
        renderCharacterAvatar(avatarEl, getActiveChar());
    }
    avatarCol.appendChild(avatarEl);

    if (typeof index === 'number' && onDelete) {
        const delBtn = document.createElement('button');
        delBtn.className = 'msg-del-btn';
        delBtn.type = 'button';
        delBtn.title = '删除这条消息';
        delBtn.setAttribute('aria-label', '删除这条消息');
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('删除这条消息？\n（删除后 AI 的上下文也会变化）')) {
                onDelete(index);
            }
        });
        avatarCol.appendChild(delBtn);
    }

    const contentEl = document.createElement('div');
    contentEl.className = 'msg-content';
    contentEl.innerHTML = formatMessage(content);
    div.appendChild(avatarCol);
    div.appendChild(contentEl);

    return div;
}

function renderMessages() {
    const container = document.getElementById('chatMessages');
    if (!container) return;

    const c = getActiveChar();
    const allMsgs = getActiveMessages().filter(m => m && m.content && String(m.content).trim());
    const charId = c ? c.id : null;
    const WINDOW = 40;  // 🔴 止血：窗口降到 40 条，进一步减 DOM

    const charChanged = State.__lastCharId !== charId;
    State.__lastCharId = charId;

    // 页面没选角色
    if (!c) {
        container.innerHTML = '';
        const placeholder = document.createElement('div');
        placeholder.className = 'empty-state';
        placeholder.innerHTML = '<div class="empty-icon">🎭</div><h3>选择一个角色开始对话</h3><p>左侧列表点选一个角色，或点 ➕ 新建</p>';
        container.appendChild(placeholder);
        return;
    }

    // 目标消息集
    const finalSlice = allMsgs.length > WINDOW
        ? allMsgs.slice(-WINDOW)
        : allMsgs;
    const finalSkipped = allMsgs.length - finalSlice.length;

    // 如果正在增量拆帧渲染，先等它结束
    if (State.__renderingBatch) return;

    // DOM 已渲染的数量
    const currentCount = Array.from(container.children).filter(
        el => el.classList && (el.classList.contains('message') || el.classList.contains('msg-error'))
    ).length;

    // 角色没变 + DOM 数量等于目标 → 可能只是最后一条换了内容，补动画就好
    // 🔴 额外：必须比对 DOM 最后一条文本和消息列表最后一条文本，防止「AI 继续对话」时
    // typing indicator 临时占位 + WINDOW 上限导致 currentCount 刚好等于目标长度，
    // 触发短路把 AI 新回复吞掉
    let domLastText = '';
    const domLastMsg = container.querySelector('.message:last-child');
    if (domLastMsg) {
        const c = domLastMsg.querySelector('.msg-content');
        domLastText = (c ? c.textContent : '').trim();
    }
    const msgLastText = (finalSlice[finalSlice.length - 1]?.content || '').trim();
    if (!charChanged && currentCount === finalSlice.length && currentCount > 0 && finalSkipped === 0
        && domLastText === msgLastText) {
        const last = container.lastElementChild;
        if (last && last.classList) last.classList.add('msg-in');
        if (State.__refreshFab) State.__refreshFab();
        return;
    }

    // 全量重建（先清空，然后拆帧 append）
    container.innerHTML = '';

    const deleteAtIndex = (i) => {
        const id = State.activeCharacterId;
        if (!id) return;
        State.conversations[id].splice(i, 1);
        saveToStorage();
        renderMessages();
        scrollToBottom();
    };

    // 折叠按钮
    if (finalSkipped > 0) {
        const unfold = document.createElement('button');
        unfold.className = 'msg-unfold';
        unfold.textContent = `📜 查看更早的 ${finalSkipped} 条对话`;
        unfold.addEventListener('click', () => {
            State.__forceFullRender = true;
            renderMessages();
            setTimeout(() => { State.__forceFullRender = false; }, 500);
        });
        container.appendChild(unfold);
    }

    const msgsToRender = allMsgs.length === 0 && c.greeting
        ? [{ role: 'assistant', content: c.greeting }]
        : finalSlice;

    // 如果 forceFullRender 打开了，最多渲染 120 条（还是留上限防止 DOM 爆炸）
    const fullCap = State.__forceFullRender ? 120 : msgsToRender.length;
    const renderSet = msgsToRender.slice(-fullCap);

    // 🔴 拆帧渲染：每帧只追加 4 条，避免一次性 innerHTML / createElement 堵住主线程
    let idx = 0;
    const perFrame = 4;
    State.__renderingBatch = true;

    const tick = () => {
        if (!document.body.contains(container)) {
            State.__renderingBatch = false;
            return;
        }
        const end = Math.min(idx + perFrame, renderSet.length);
        for (; idx < end; idx++) {
            const msg = renderSet[idx];
            const globalIdx = allMsgs.length - finalSlice.length + idx;
            const el = createMessageDiv(msg.role, msg.content, globalIdx, deleteAtIndex);
            container.appendChild(el);
        }

        if (idx < renderSet.length) {
            requestAnimationFrame(tick);
        } else {
            // 全部渲染完毕
            State.__renderingBatch = false;

            // ✅ 插入 fake user：找最后两条都是 assistant 的情况，插在它们之间
            if (State.__pendingFakeUser) {
                const children = Array.from(container.children);
                let lastAI = null;   // 倒数第一个 assistant
                let prevAI = null;   // 倒数第二个 assistant
                for (let i = children.length - 1; i >= 0; i--) {
                    const el = children[i];
                    if (el.classList && el.classList.contains('message') && el.classList.contains('ai')) {
                        if (!lastAI) lastAI = el;
                        else { prevAI = el; break; }
                    }
                }
                const fakeEl = createMessageDiv('user', State.__pendingFakeUser, -1, null);
                if (prevAI && lastAI) {
                    // 两个 assistant 都找到，插在它们之间（= 倒数第一个 assistant 之前）
                    container.insertBefore(fakeEl, lastAI);
                } else if (lastAI) {
                    // 只找到一个 assistant，插在它前面
                    container.insertBefore(fakeEl, lastAI);
                } else {
                    container.appendChild(fakeEl);
                }
                State.__pendingFakeUser = null;
            }

            const last = container.lastElementChild;
            if (last && last.classList) last.classList.add('msg-in');

            if (State.__refreshFab) State.__refreshFab();
            scrollToBottom();
        }
    };
    requestAnimationFrame(tick);
}

function restoreMessages() {
    renderMessages();
}

function scrollToBottom() {
    setTimeout(() => scrollChatTo('bottom'), 50);
}

// ---------- 聊天滚动按钮（回到顶部 / 滚到底部） ----------
// 各端真正能滚的容器不一样（桌面是 #chatMessages，手机可能是 body 或 html），
// 所以把消息框及其整条祖先链上所有「可滚动」的元素都滚一遍，最稳妥。
function scrollChatTo(where) {
    const list = document.getElementById('chatMessages');
    const candidates = [];
    if (list) {
        candidates.push(list);
        let p = list.parentElement;
        while (p) {
            candidates.push(p);
            p = p.parentElement;
        }
    }
    candidates.push(document.body, document.documentElement);

    candidates.forEach(el => {
        if (!el) return;
        const max = el.scrollHeight - el.clientHeight;
        if (max > 4) el.scrollTop = where === 'top' ? 0 : max;
    });

    if (where === 'top') window.scrollTo(0, 0);
    else window.scrollTo(0, Math.max(document.body.scrollHeight, document.documentElement.scrollHeight));
}

function initChatFab() {
    if (State.__scrollBound) return;
    State.__scrollBound = true;

    // 事件委托：即使某个初始化步骤出错，点击也不会失效
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target || !target.closest) return;
        const isTop = target.closest('#fabTopInline');
        const isBottom = target.closest('#fabBottomInline');
        if (!isTop && !isBottom) return;

        e.preventDefault();
        scrollChatTo(isTop ? 'top' : 'bottom');
        showToast(isTop ? '已回到顶部' : '已滚到最新');
    });
}

// ---------- 聊天字号调节 ----------
const FONT_SIZE_OPTIONS = [
    { label: '小', px: 13 },
    { label: '标准', px: 15 },
    { label: '大', px: 17 },
    { label: '特大', px: 19 },
    { label: '巨大', px: 22 }
];

function applyFontSize(px) {
    document.documentElement.style.setProperty('--chat-font-size', px + 'px');
    try { localStorage.setItem('ai_font_size', String(px)); } catch (e) {}
}

function initFontSize() {
    let saved = parseInt(localStorage.getItem('ai_font_size') || '', 10);
    if (!Number.isFinite(saved) || saved < 10 || saved > 30) saved = 15;
    applyFontSize(saved);

    const btn = document.getElementById('fontBtn');
    if (!btn) return;
    btn.addEventListener('click', openFontSheet);
}

function openFontSheet() {
    const current = parseInt(localStorage.getItem('ai_font_size') || '', 10) || 15;

    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `
        <div class="sheet-handle"></div>
        <div class="sheet-title">调整聊天字号</div>
        <div class="sheet-sub">当前：${current}px</div>
        ${FONT_SIZE_OPTIONS.map(o => `
            <button class="sheet-item" data-px="${o.px}">
                ${o.label}（${o.px}px）${o.px === current ? ' ✓' : ''}
            </button>`).join('')}
        <button class="sheet-cancel">取消</button>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    const close = () => { overlay.remove(); sheet.remove(); };
    overlay.addEventListener('click', close);
    sheet.querySelector('.sheet-cancel').addEventListener('click', close);

    sheet.querySelectorAll('.sheet-item').forEach(item => {
        item.addEventListener('click', () => {
            const px = parseInt(item.dataset.px, 10);
            applyFontSize(px);
            showToast(`字号已设为 ${px}px`, 'success');
            close();
        });
    });
}

function formatMessage(text) {
    if (!text) return '';
    // 超长回复截断保护：单次 AI 回复偶尔能到几千字，正则 + innerHTML 会卡主线程
    let truncated = false;
    let safeText = text;
    if (text.length > 4000) {
        safeText = text.slice(0, 3500);
        truncated = true;
    }
    let html = escapeHtml(safeText);
    // **粗体**
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // *动作/表情* -> 斜体动作（对话无关的旁白）
    html = html.replace(/(^|[^\*])\*([^\*\n]+?)\*/g, '$1<em class="action">$2</em>');
    html = html.replace(/\n/g, '<br>');
    if (truncated) html += `<br><span class="msg-truncated">…(回复过长，已截断前 ${safeText.length} 字)</span>`;
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
function refreshWriteCharSelect() {
    const sel = document.getElementById('writeCharSelect');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— 无特定人物（纯写作）—</option>';
    State.characters.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.avatar || '👤'} ${c.name}${c.identity ? ' · ' + c.identity : ''}`;
        sel.appendChild(opt);
    });
    // 保留上次选择（如果角色还存在），否则默认选中当前激活角色
    if (prev && State.characters.find(c => c.id === prev)) {
        sel.value = prev;
    } else if (State.activeCharacterId && State.characters.find(c => c.id === State.activeCharacterId)) {
        sel.value = State.activeCharacterId;
    }
}

function initWrite() {
    refreshWriteCharSelect();

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

    // 修改功能
    initWriteEdit();
}

async function generateArticle() {
    const topic = document.getElementById('writeTopic').value.trim();
    const requirements = document.getElementById('writeRequirements').value.trim();
    const length = document.getElementById('writeLength').value;
    const style = document.getElementById('writeStyle').value;
    const ratingKey = document.getElementById('writeRating').value;

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
    const styleMap = {
        default: '自然流畅、娓娓道来',
        formal: '正式书面、严谨规范',
        casual: '轻松随意、口语化',
        literary: '文艺优美、辞藻华丽',
        humorous: '幽默风趣、诙谐调侃',
        poetic: '诗意浪漫、意境悠远',
        melancholy: '伤感忧郁、细腻绵长',
        tense: '紧张悬疑、节奏紧凑',
        intimate: '亲密温柔、细腻动人',
        bold: '大胆直白、坦率真诚',
        erotic: '情欲张力、暧昧挑逗、克制但诱人',
        explicit: '露骨直白、坦率描写、不做遮掩'
    };

    // 从下拉框取选定的写作角色，没选则用当前激活角色，再没则 null
    const writeCharId = document.getElementById('writeCharSelect')?.value;
    let activeChar = null;
    if (writeCharId) {
        activeChar = State.characters.find(c => c.id === writeCharId) || null;
    } else {
        activeChar = getActiveChar();
    }

    // 分级安全处理：未成年角色强制全年龄
    let effectiveRating = RATING_MAP[ratingKey] || RATING_MAP.all;
    if (activeChar && (activeChar.ageGroup === 'child' || activeChar.ageGroup === 'teen')) {
        effectiveRating = RATING_MAP.all;
    }

    // 风格与分级匹配：erotic/explicit 在低于 R18 时降级为 bold
    let effectiveStyleKey = style;
    if ((style === 'erotic' || style === 'explicit') &&
        !['r18', 'r20', 'r23'].includes(ratingKey)) {
        effectiveStyleKey = 'bold';
    }
    // 未成年角色不允许 erotic/explicit
    if ((style === 'erotic' || style === 'explicit') &&
        activeChar && (activeChar.ageGroup === 'child' || activeChar.ageGroup === 'teen')) {
        effectiveStyleKey = 'bold';
    }
    const effectiveStyle = styleMap[effectiveStyleKey] || styleMap.default;

    let systemPrompt = '你是一位才华横溢的作家，擅长根据人物身份进行创作。';
    if (activeChar) {
        const c = activeChar;
        const ageLabel = AGE_LABEL_MAP[c.ageGroup] || '';
        systemPrompt = `请以以下人物的身份和风格进行创作：

【角色名称】：${c.name}
${c.identity ? `【身份/职业】：${c.identity}` : ''}
${ageLabel ? `【年龄段】：${ageLabel}` : ''}
${c.personality ? `【性格/风格】：${c.personality}` : ''}
${c.background ? `【背景故事】：${c.background}` : ''}

【内容分级】：${effectiveRating.label}
${effectiveRating.prompt}
${RATING_SAFETY_RULE}

创作时请始终保持该角色的独特风格、语言特点和思维方式，让文字仿佛从角色内心自然流淌出来。`;
    } else {
        systemPrompt = `你是一位才华横溢的作家。

【内容分级】：${effectiveRating.label}
${effectiveRating.prompt}
${RATING_SAFETY_RULE}`;
    }

    let userPrompt = `请创作一篇文章，主题：「${topic}」。

要求：
- 篇幅：${lengthMap[length]}
- 风格：${effectiveStyle}
${requirements ? `- 额外要求：${requirements}` : ''}`;

    showLoading('✍️ 正在创作中...');
    try {
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
        const content = data.choices[0].message.content;

        document.getElementById('writeOutput').style.display = 'block';
        document.getElementById('outputTitle').textContent = `文章 · ${topic}`;
        document.getElementById('outputContent').innerHTML = formatWriteContent(content);
        document.getElementById('writeOutput').scrollIntoView({ behavior: 'smooth' });

        // 保存当前生成结果，供修改功能使用
        State.lastWrittenContent = content;
        State.lastWrittenMeta = { topic, requirements, length, style: effectiveStyle, ratingKey };
        document.getElementById('editPanel').style.display = 'none';

        showToast('✨ 创作完成', 'success');
    } catch (err) {
        showToast('❌ ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}

// ---------- 写作：修改 ----------
function initWriteEdit() {
    const editBtn = document.getElementById('editOutputBtn');
    const closeEditBtn = document.getElementById('closeEditBtn');
    const applyEditBtn = document.getElementById('applyEditBtn');
    if (!editBtn) return;

    editBtn.addEventListener('click', () => {
        if (!State.lastWrittenContent) {
            showToast('先生成一篇文章才能修改哦', 'error');
            return;
        }
        document.getElementById('editOriginalContent').textContent = State.lastWrittenContent;
        document.getElementById('editInstruction').value = '';
        document.getElementById('editPanel').style.display = 'block';
        document.getElementById('editPanel').scrollIntoView({ behavior: 'smooth' });
    });

    if (closeEditBtn) closeEditBtn.addEventListener('click', () => {
        document.getElementById('editPanel').style.display = 'none';
    });

    if (applyEditBtn) applyEditBtn.addEventListener('click', applyWriteEdit);
}

async function applyWriteEdit() {
    const instruction = document.getElementById('editInstruction').value.trim();
    if (!instruction) {
        showToast('请告诉 AI 怎么改', 'error');
        return;
    }
    if (!State.lastWrittenContent) return;
    if (!State.api.baseUrl) {
        showToast('请先在「API」配置接口', 'error');
        return;
    }

    const meta = State.lastWrittenMeta || {};
    const writeCharId = document.getElementById('writeCharSelect')?.value;
    let activeChar = null;
    if (writeCharId) {
        activeChar = State.characters.find(c => c.id === writeCharId) || null;
    } else {
        activeChar = getActiveChar();
    }

    // 分级 & 风格沿用原生成设置
    const effectiveRating = (function() {
        let r = RATING_MAP[meta.ratingKey] || RATING_MAP.all;
        if (activeChar && (activeChar.ageGroup === 'child' || activeChar.ageGroup === 'teen')) {
            r = RATING_MAP.all;
        }
        return r;
    })();

    let systemPrompt = '你是一位才华横溢的作家，擅长根据人物身份进行创作与修改润色。';
    if (activeChar) {
        const c = activeChar;
        const ageLabel = AGE_LABEL_MAP[c.ageGroup] || '';
        systemPrompt = `请以以下人物的身份进行修改创作：

【角色名称】：${c.name}
${c.identity ? `【身份/职业】：${c.identity}` : ''}
${ageLabel ? `【年龄段】：${ageLabel}` : ''}
${c.personality ? `【性格/风格】：${c.personality}` : ''}
${c.background ? `【背景故事】：${c.background}` : ''}

【内容分级】：${effectiveRating.label}
${effectiveRating.prompt}
${RATING_SAFETY_RULE}

修改时必须保留角色口吻，使修改后的文字如同该角色亲自重写。`;
    } else {
        systemPrompt = `你是一位才华横溢的作家。

【内容分级】：${effectiveRating.label}
${effectiveRating.prompt}
${RATING_SAFETY_RULE}`;
    }

    const userPrompt = `这是之前已经生成的文章（原文仅供参考，你可以完全重写以满足修改要求）：

--- 原文开始 ---
${State.lastWrittenContent}
--- 原文结束 ---

请按照以下要求修改这篇文章：

「${instruction}」

${meta.length ? `- 保持篇幅约 ${meta.length}` : ''}
${meta.style ? `- 保持或适配风格：${meta.style}` : ''}

请直接输出修改后的完整文章，不要复述修改要求。`;

    showLoading('✏️ 正在修改中...');
    try {
        const resp = await fetch(`${State.api.baseUrl}/chat/completions`, {
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
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const content = data.choices[0].message.content;

        State.lastWrittenContent = content;
        document.getElementById('outputContent').innerHTML = formatWriteContent(content);
        document.getElementById('editPanel').style.display = 'none';
        document.getElementById('outputContent').scrollIntoView({ behavior: 'smooth' });
        showToast('✨ 修改完成', 'success');
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
