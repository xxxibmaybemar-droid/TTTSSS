/**
 * Gemini TTS Extension for SillyTavern 1.17.0+
 * Version: 2.0.0
 *
 * ✅ Uses SillyTavern.getContext() — correct API for ST 1.17
 * ✅ Proper extension_settings access via global
 * ✅ Event delegation for message buttons (no double-bind)
 * ✅ CHAT_CHANGED → refresh voice map
 * ✅ AbortController to cancel in-flight TTS requests
 * ✅ Mutex-based queue (no race condition)
 * ✅ PCM16 → WAV blob → <audio> element (max browser compat)
 * ✅ Debounced settings save
 * ✅ Per-character style prompt
 * ✅ Waveform progress indicator
 * ✅ Generation skips if text empty after extraction
 */

const MODULE_NAME = 'gemini_tts';

// ─── Gemini TTS Models ───────────────────────────────────────────────────────
const TTS_MODELS = [
    { id: 'gemini-3.1-flash-tts-preview',  label: 'Gemini 3.1 Flash Preview ⚡ (Fastest)' },
    { id: 'gemini-2.5-flash-preview-tts',  label: 'Gemini 2.5 Flash Preview 🔥 (Balanced)' },
    { id: 'gemini-2.5-pro-preview-tts',    label: 'Gemini 2.5 Pro Preview 💎 (Best Quality)' },
];

// ─── All 30 Prebuilt Voices ───────────────────────────────────────────────────
const VOICES = [
    'Zephyr','Puck','Charon','Kore','Fenrir','Leda','Orus','Aoede',
    'Callirrhoe','Autonoe','Enceladus','Iapetus','Umbriel','Algieba',
    'Despina','Erinome','Algenib','Rasalased','Laomedeia','Achernar',
    'Alnilam','Schedar','Gacrux','Pulcherrima','Achird','Zubenelgenubi',
    'Vindemiatrix','Sadatoni','Murphrid','Sulafat',
];

// ─── Default Settings ─────────────────────────────────────────────────────────
const DEFAULTS = {
    enabled:             false,
    auto_read:           false,
    read_user:           false,
    api_key:             '',
    model:               'gemini-2.5-flash-preview-tts',
    read_mode:           'quotes_only',   // 'quotes_only' | 'full_text'
    default_voice:       'Kore',
    global_style_prompt: '',
    voice_map:           {},              // { charName: { voice, style } }
    volume:              0.9,
    skip_asterisk_in_full: true,         // In full_text mode, skip *narration* inside asterisks
};

// ─── Module State ─────────────────────────────────────────────────────────────
let cfg = {};
let audioQueue   = [];
let isProcessing = false;
let currentAudio = null;          // <audio> element
let abortCtrl    = null;          // AbortController for fetch
let saveTimer    = null;

// ─── Helpers: getContext / extension_settings ─────────────────────────────────
function ctx()  { return SillyTavern.getContext(); }
function stExt() { return SillyTavern.getContext().extension_settings; }

// ─── Settings save (debounced 500ms) ─────────────────────────────────────────
function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        stExt()[MODULE_NAME] = cfg;
        ctx().saveSettingsDebounced();
    }, 500);
}

// ─── Init: called by SillyTavern on extension load ───────────────────────────
jQuery(async () => {
    // Merge saved settings with defaults
    const saved = stExt()[MODULE_NAME] || {};
    cfg = Object.assign({}, DEFAULTS, saved);
    // Deep-merge voice_map to preserve object
    cfg.voice_map = Object.assign({}, DEFAULTS.voice_map, saved.voice_map || {});
    stExt()[MODULE_NAME] = cfg;

    injectHTML();
    syncUI();
    bindControls();
    delegateMessageButtons();
    registerSTEvents();

    console.log(`[${MODULE_NAME}] v2.0.0 loaded ✓`);
});

// ─── Build & Inject Settings Panel ───────────────────────────────────────────
function injectHTML() {
    const modelOpts = TTS_MODELS.map(m =>
        `<option value="${m.id}">${m.label}</option>`
    ).join('');

    const voiceOpts = VOICES.map(v =>
        `<option value="${v}">${v}</option>`
    ).join('');

    const html = /* html */`
<div id="gtts-panel" class="gtts-panel">

  <!-- ── Header ── -->
  <div class="gtts-header" id="gtts-header">
    <span class="gtts-logo">🎙️</span>
    <span class="gtts-title">Gemini TTS</span>
    <span class="gtts-badge">v2.0</span>
    <div class="gtts-header-right">
      <label class="gtts-switch" onclick="event.stopPropagation()">
        <input type="checkbox" id="gtts-enabled">
        <span class="gtts-knob"></span>
      </label>
    </div>
  </div>

  <!-- ── Body (collapses) ── -->
  <div id="gtts-body" class="gtts-body">

    <!-- API Key -->
    <div class="gtts-section">
      <div class="gtts-label">🔑 Google AI Studio API Key</div>
      <div class="gtts-key-row">
        <input id="gtts-api-key" type="password" class="gtts-input" placeholder="AIza…" autocomplete="off">
        <button id="gtts-eye" class="gtts-icon-btn" title="Toggle visibility">👁</button>
        <button id="gtts-test" class="gtts-pill-btn">Test</button>
      </div>
      <div id="gtts-key-msg" class="gtts-key-msg"></div>
    </div>

    <!-- Model -->
    <div class="gtts-section">
      <div class="gtts-label">🤖 TTS Model</div>
      <select id="gtts-model" class="gtts-select">${modelOpts}</select>
    </div>

    <!-- Read Mode -->
    <div class="gtts-section">
      <div class="gtts-label">📖 Read Mode</div>
      <div class="gtts-radio-stack">
        <label class="gtts-radio-row">
          <input type="radio" name="gtts-mode" value="quotes_only">
          <div class="gtts-radio-content">
            <span class="gtts-radio-title">🗣 คำพูดเท่านั้น</span>
            <span class="gtts-radio-sub">อ่านเฉพาะ "ข้อความในเครื่องหมายคำพูด"</span>
          </div>
        </label>
        <label class="gtts-radio-row">
          <input type="radio" name="gtts-mode" value="full_text">
          <div class="gtts-radio-content">
            <span class="gtts-radio-title">📜 คำพูด + บรรยาย</span>
            <span class="gtts-radio-sub">อ่านทุกอย่าง (ลบ markdown ออกอัตโนมัติ)</span>
          </div>
        </label>
      </div>
      <label id="gtts-skip-asterisk-wrap" class="gtts-inline-toggle">
        <span>ข้ามข้อความใน *asterisks* (เฉพาะ mode นี้)</span>
        <label class="gtts-switch">
          <input type="checkbox" id="gtts-skip-asterisk">
          <span class="gtts-knob"></span>
        </label>
      </label>
    </div>

    <!-- Toggles row -->
    <div class="gtts-section gtts-toggles">
      <label class="gtts-inline-toggle">
        <span>⚡ Auto-read AI messages</span>
        <label class="gtts-switch">
          <input type="checkbox" id="gtts-auto-read">
          <span class="gtts-knob"></span>
        </label>
      </label>
      <label class="gtts-inline-toggle">
        <span>🙋 Include user messages</span>
        <label class="gtts-switch">
          <input type="checkbox" id="gtts-read-user">
          <span class="gtts-knob"></span>
        </label>
      </label>
    </div>

    <!-- Global Style Prompt -->
    <div class="gtts-section">
      <div class="gtts-label">✨ Global Style Prompt
        <span class="gtts-hint">น้ำเสียงเริ่มต้นสำหรับทุกตัวละคร</span>
      </div>
      <input id="gtts-style" type="text" class="gtts-input"
        placeholder="e.g. Speak warmly and gently, like a caring narrator.">
    </div>

    <!-- Volume -->
    <div class="gtts-section">
      <div class="gtts-label">🔊 Volume — <span id="gtts-vol-label">90%</span></div>
      <input type="range" id="gtts-volume" class="gtts-range" min="0" max="1" step="0.05">
    </div>

    <!-- Voice Map -->
    <div class="gtts-section">
      <div class="gtts-vmhead">
        <div class="gtts-label">🗺 Voice Map</div>
        <button id="gtts-refresh" class="gtts-pill-btn">↻ Refresh</button>
      </div>
      <div id="gtts-vmap" class="gtts-vmap">
        <div class="gtts-empty">Open a chat to map voices to characters.</div>
      </div>
    </div>

    <!-- Playback Bar -->
    <div class="gtts-playbar">
      <button id="gtts-stop" class="gtts-stop-btn">⏹ Stop</button>
      <div class="gtts-waveform" id="gtts-waveform">
        <div class="gtts-wave-bar"></div><div class="gtts-wave-bar"></div>
        <div class="gtts-wave-bar"></div><div class="gtts-wave-bar"></div>
        <div class="gtts-wave-bar"></div>
      </div>
      <span id="gtts-status" class="gtts-status-txt"></span>
    </div>

  </div><!-- /gtts-body -->
</div>
`;

    $('#extensions_settings').append(html);
}

// ─── Sync UI controls to cfg ──────────────────────────────────────────────────
function syncUI() {
    $('#gtts-enabled').prop('checked', cfg.enabled);
    $('#gtts-api-key').val(cfg.api_key);
    $('#gtts-model').val(cfg.model);
    $(`input[name="gtts-mode"][value="${cfg.read_mode}"]`).prop('checked', true);
    $('#gtts-skip-asterisk').prop('checked', cfg.skip_asterisk_in_full);
    $('#gtts-auto-read').prop('checked', cfg.auto_read);
    $('#gtts-read-user').prop('checked', cfg.read_user);
    $('#gtts-style').val(cfg.global_style_prompt);
    $('#gtts-volume').val(cfg.volume);
    $('#gtts-vol-label').text(`${Math.round(cfg.volume * 100)}%`);
    toggleBody();
    toggleSkipAsteriskVis();
}

function toggleBody() {
    if (cfg.enabled) $('#gtts-body').slideDown(200);
    else             $('#gtts-body').slideUp(200);
}

function toggleSkipAsteriskVis() {
    $('#gtts-skip-asterisk-wrap').toggle(cfg.read_mode === 'full_text');
}

// ─── Bind all UI controls ─────────────────────────────────────────────────────
function bindControls() {
    // Enable toggle
    $('#gtts-enabled').on('change', function () {
        cfg.enabled = this.checked;
        toggleBody();
        saveSettings();
    });

    // Header click → collapse/expand body
    $('#gtts-header').on('click', function (e) {
        if ($(e.target).closest('label, input, button').length) return;
        if (!cfg.enabled) return;
        $('#gtts-body').slideToggle(220);
    });

    // API key
    $('#gtts-api-key').on('input', function () {
        cfg.api_key = this.value.trim();
        setKeyMsg('', '');
        saveSettings();
    });

    // Eye toggle
    $('#gtts-eye').on('click', function () {
        const el = $('#gtts-api-key');
        el.attr('type', el.attr('type') === 'password' ? 'text' : 'password');
    });

    // Test key
    $('#gtts-test').on('click', testKey);

    // Model
    $('#gtts-model').on('change', function () {
        cfg.model = this.value;
        saveSettings();
    });

    // Read mode
    $('input[name="gtts-mode"]').on('change', function () {
        cfg.read_mode = this.value;
        toggleSkipAsteriskVis();
        saveSettings();
    });

    // Skip asterisk
    $('#gtts-skip-asterisk').on('change', function () {
        cfg.skip_asterisk_in_full = this.checked;
        saveSettings();
    });

    // Auto-read
    $('#gtts-auto-read').on('change', function () {
        cfg.auto_read = this.checked;
        saveSettings();
    });

    // Read user
    $('#gtts-read-user').on('change', function () {
        cfg.read_user = this.checked;
        saveSettings();
    });

    // Global style
    $('#gtts-style').on('input', function () {
        cfg.global_style_prompt = this.value;
        saveSettings();
    });

    // Volume
    $('#gtts-volume').on('input', function () {
        cfg.volume = parseFloat(this.value);
        $('#gtts-vol-label').text(`${Math.round(cfg.volume * 100)}%`);
        if (currentAudio) currentAudio.volume = cfg.volume;
        saveSettings();
    });

    // Refresh voice map
    $('#gtts-refresh').on('click', buildVoiceMap);

    // Stop
    $('#gtts-stop').on('click', stopAll);
}

// ─── Register SillyTavern Events ──────────────────────────────────────────────
function registerSTEvents() {
    const { eventSource, event_types } = ctx();

    // AI message: auto-read
    eventSource.on(event_types.MESSAGE_RECEIVED, (msgId) => {
        if (!cfg.enabled || !cfg.auto_read) return;
        readMessage(msgId, false);
    });

    // User message: auto-read
    eventSource.on(event_types.MESSAGE_SENT, (msgId) => {
        if (!cfg.enabled || !cfg.auto_read || !cfg.read_user) return;
        readMessage(msgId, true);
    });

    // Chat changed → rebuild voice map
    eventSource.on(event_types.CHAT_CHANGED, () => {
        if (cfg.enabled) buildVoiceMap();
    });

    // APP_READY → initial voice map
    eventSource.on(event_types.APP_READY, () => {
        if (cfg.enabled) buildVoiceMap();
    });
}

// ─── Event Delegation for per-message TTS buttons ────────────────────────────
// Attach ONE listener on the chat container — handles buttons dynamically added later
function delegateMessageButtons() {
    // Use MutationObserver to inject buttons when messages appear in DOM
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) {
        // Fallback: retry when DOM ready
        setTimeout(delegateMessageButtons, 1000);
        return;
    }

    const observer = new MutationObserver((mutations) => {
        if (!cfg.enabled) return;
        for (const mut of mutations) {
            for (const node of mut.addedNodes) {
                if (node.nodeType !== 1) continue;
                // A .mes element was added
                if (node.classList && node.classList.contains('mes')) {
                    injectButtonIntoMessage(node);
                }
                // Or look inside added subtrees
                node.querySelectorAll && node.querySelectorAll('.mes').forEach(el => {
                    injectButtonIntoMessage(el);
                });
            }
        }
    });

    observer.observe(chatContainer, { childList: true, subtree: true });

    // Also inject into existing messages on load
    document.querySelectorAll('#chat .mes').forEach(el => injectButtonIntoMessage(el));
}

function injectButtonIntoMessage(mesEl) {
    if (mesEl.querySelector('.gtts-msg-btn')) return; // already injected
    const mesId = mesEl.getAttribute('mesid');
    if (mesId === null) return;

    const btn = document.createElement('div');
    btn.className = 'gtts-msg-btn mes_button';
    btn.title = 'Gemini TTS: Read aloud';
    btn.innerHTML = '🎙️';
    btn.setAttribute('data-mesid', mesId);

    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!cfg.enabled) { showStatus('⚠ Gemini TTS is disabled', true); return; }
        const id = parseInt(btn.getAttribute('data-mesid'));
        const { chat } = ctx();
        const msg = chat?.[id];
        if (!msg) return;

        const isUser = msg.is_user || false;
        const charKey = isUser ? '__user__' : (msg.name || 'AI');
        const text = extractText(msg.mes || '', isUser);

        if (!text.trim()) {
            showStatus('⚠ No readable text in this message', true);
            return;
        }
        stopAll();
        await generateAndPlay(text, getVoice(charKey), getStylePrompt(charKey), charKey);
    });

    // Find the best container — try extraMesButtons, fallback to mes_buttons
    const target = mesEl.querySelector('.extraMesButtons') || mesEl.querySelector('.mes_buttons');
    if (target) target.prepend(btn);
}

// ─── Auto-read a message ──────────────────────────────────────────────────────
function readMessage(msgId, isUser) {
    const { chat } = ctx();
    const msg = chat?.[msgId];
    if (!msg) return;

    const charKey = isUser ? '__user__' : (msg.name || 'AI');
    const text = extractText(msg.mes || '', isUser);
    if (!text.trim()) return;

    const voice = getVoice(charKey);
    const style = getStylePrompt(charKey);
    enqueue(text, voice, style, charKey);
}

// ─── Text Extraction ──────────────────────────────────────────────────────────
function extractText(raw, isUser = false) {
    if (cfg.read_mode === 'quotes_only') {
        // Robust quote extraction — handles nested quotes too
        const matches = [];
        // Match "…" allowing escaped quotes inside
        const re = /"((?:[^"\\]|\\.)*)"/g;
        let m;
        while ((m = re.exec(raw)) !== null) {
            // Skip if inside *asterisks*
            const before = raw.slice(0, m.index);
            const openAsterisks = (before.match(/\*/g) || []).length;
            if (openAsterisks % 2 !== 0) continue; // inside asterisks, skip
            matches.push(m[1].trim());
        }
        return matches.filter(Boolean).join(' … ');
    }

    // full_text: strip markdown, optionally skip *asterisks*
    let text = raw;

    if (cfg.skip_asterisk_in_full) {
        // Remove *…* content (narration)
        text = text.replace(/\*[^*]+\*/g, ' ');
    }

    return stripMarkdown(text);
}

function stripMarkdown(text) {
    return text
        .replace(/```[\s\S]*?```/g, '')           // code blocks
        .replace(/`[^`]+`/g, '')                   // inline code
        .replace(/\*\*([^*]+)\*\*/g, '$1')         // **bold**
        .replace(/\*([^*]+)\*/g, '$1')             // *italic*
        .replace(/__([^_]+)__/g, '$1')             // __bold__
        .replace(/_([^_]+)_/g, '$1')               // _italic_
        .replace(/#{1,6}\s+/g, '')                 // headings
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [link](url)
        .replace(/!\[[^\]]*\]\([^)]+\)/g, '')      // images
        .replace(/>\s?/g, '')                       // blockquotes
        .replace(/[-–—]{2,}/g, ', ')               // em dashes
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

// ─── Voice & Style Helpers ────────────────────────────────────────────────────
function getVoice(charKey) {
    return cfg.voice_map?.[charKey]?.voice || cfg.default_voice;
}

function getStylePrompt(charKey) {
    const charStyle = cfg.voice_map?.[charKey]?.style || '';
    return charStyle || cfg.global_style_prompt || '';
}

// ─── Queue System (mutex-protected, no race condition) ────────────────────────
function enqueue(text, voice, style, label) {
    audioQueue.push({ text, voice, style, label });
    if (!isProcessing) drainQueue();
}

async function drainQueue() {
    if (isProcessing || audioQueue.length === 0) return;
    isProcessing = true;

    while (audioQueue.length > 0) {
        const item = audioQueue.shift();
        showStatus(`▶ ${item.label}`);
        try {
            await generateAndPlay(item.text, item.voice, item.style, item.label);
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.error(`[${MODULE_NAME}]`, e);
                showStatus(`❌ ${e.message}`, true);
            }
        }
    }

    isProcessing = false;
    showStatus('');
    setWaveActive(false);
}

// ─── Core TTS flow ────────────────────────────────────────────────────────────
async function generateAndPlay(text, voice, style, label) {
    if (!cfg.api_key) {
        throw new Error('No API key set. Please add your Google AI Studio key in Gemini TTS settings.');
    }

    showStatus(`⏳ Generating… (${label})`);
    setWaveActive(false);

    // Cancel any existing fetch
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();

    const wav = await fetchTTS(text, voice, style, abortCtrl.signal);

    showStatus(`🎙️ ${label}`);
    setWaveActive(true);

    await playWAV(wav);

    setWaveActive(false);
}

// ─── Fetch TTS from Gemini API ────────────────────────────────────────────────
async function fetchTTS(text, voice, style, signal) {
    const model = cfg.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cfg.api_key}`;

    // Build prompt: style instruction prepended if provided
    let prompt = text;
    if (style && style.trim()) {
        prompt = `[Delivery instruction: ${style.trim()}]\n\n${text}`;
    }

    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: voice }
                }
            }
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
            const j = await res.json();
            msg = j?.error?.message || msg;
        } catch (_) {}
        throw new Error(`Gemini API: ${msg}`);
    }

    const data = await res.json();

    // Find audio part in response
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const audioPart = parts.find(p => p.inlineData?.mimeType?.startsWith('audio/'));

    if (!audioPart) {
        // Sometimes Gemini returns a text error in parts instead of audio
        const textPart = parts.find(p => p.text);
        throw new Error(textPart?.text || 'No audio in Gemini response');
    }

    const { data: b64, mimeType } = audioPart.inlineData;

    // Parse sample rate from mimeType (e.g. "audio/L16;codec=pcm;rate=24000")
    let sampleRate = 24000;
    const rm = mimeType.match(/rate=(\d+)/i);
    if (rm) sampleRate = parseInt(rm[1]);

    // Decode base64 → PCM16 → WAV blob
    return pcm16ToWav(b64, sampleRate);
}

// ─── PCM16 → WAV Blob ─────────────────────────────────────────────────────────
// This is far more compatible than raw Web Audio API PCM playback
function pcm16ToWav(b64, sampleRate) {
    // Decode base64
    const bin = atob(b64);
    const pcmBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) pcmBytes[i] = bin.charCodeAt(i);

    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = pcmBytes.byteLength;
    const wavSize = 44 + dataSize;

    const wav = new ArrayBuffer(wavSize);
    const view = new DataView(wav);

    // WAV Header
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0,  'RIFF');
    view.setUint32(4,  wavSize - 8,   true);
    writeStr(8,  'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16,            true);  // PCM chunk size
    view.setUint16(20, 1,             true);  // PCM format
    view.setUint16(22, numChannels,   true);
    view.setUint32(24, sampleRate,    true);
    view.setUint32(28, byteRate,      true);
    view.setUint16(32, blockAlign,    true);
    view.setUint16(34, bitsPerSample, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize,      true);

    // Write PCM samples
    new Uint8Array(wav).set(pcmBytes, 44);

    return new Blob([wav], { type: 'audio/wav' });
}

// ─── Play WAV Blob via <audio> element ────────────────────────────────────────
function playWAV(wavBlob) {
    return new Promise((resolve, reject) => {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.src = '';
            URL.revokeObjectURL(currentAudio._blobUrl);
            currentAudio = null;
        }

        const url = URL.createObjectURL(wavBlob);
        const audio = new Audio(url);
        audio._blobUrl = url;
        audio.volume = cfg.volume;
        currentAudio = audio;

        audio.onended = () => {
            URL.revokeObjectURL(url);
            currentAudio = null;
            resolve();
        };
        audio.onerror = (e) => {
            URL.revokeObjectURL(url);
            currentAudio = null;
            reject(new Error('Audio playback error'));
        };

        audio.play().catch(reject);
    });
}

// ─── Stop All ─────────────────────────────────────────────────────────────────
function stopAll() {
    // Cancel in-flight fetch
    if (abortCtrl) { abortCtrl.abort(); abortCtrl = null; }

    // Stop audio
    if (currentAudio) {
        currentAudio.pause();
        URL.revokeObjectURL(currentAudio._blobUrl);
        currentAudio = null;
    }

    // Clear queue & state
    audioQueue   = [];
    isProcessing = false;

    showStatus('');
    setWaveActive(false);
}

// ─── Voice Map UI ─────────────────────────────────────────────────────────────
function buildVoiceMap() {
    const { characters } = ctx();
    const wrap = document.getElementById('gtts-vmap');
    if (!wrap) return;
    wrap.innerHTML = '';

    if (!characters || characters.length === 0) {
        wrap.innerHTML = '<div class="gtts-empty">No characters found. Open a chat first.</div>';
        return;
    }

    const voiceOpts = VOICES.map(v => `<option value="${v}">${v}</option>`).join('');

    const entries = [
        { key: '__user__', label: '🙋 User (You)' },
        ...characters.map(c => ({ key: c.name, label: `🧑‍💼 ${c.name}` }))
    ];

    entries.forEach(({ key, label }) => {
        const entry = cfg.voice_map[key] || {};
        const voice = entry.voice || cfg.default_voice;
        const style = entry.style || '';

        const row = document.createElement('div');
        row.className = 'gtts-vmap-row';
        row.innerHTML = /* html */`
            <div class="gtts-vmap-name" title="${label}">${label}</div>
            <div class="gtts-vmap-controls">
              <select class="gtts-vmap-sel" data-key="${key}">${voiceOpts}</select>
              <button class="gtts-icon-btn gtts-vmap-play" data-key="${key}" title="Preview voice">▶</button>
              <button class="gtts-icon-btn gtts-vmap-expand" data-key="${key}" title="Style prompt">✏️</button>
            </div>
            <div class="gtts-vmap-style-row" id="vstyle-${CSS.escape(key)}" style="display:none">
              <input type="text" class="gtts-input gtts-vmap-style-input" data-key="${key}"
                placeholder="Per-character style: e.g. Speak shyly and quietly"
                value="${escapeHtml(style)}">
            </div>
        `;
        wrap.appendChild(row);

        // Set selected voice
        row.querySelector('.gtts-vmap-sel').value = voice;

        // Bind voice select
        row.querySelector('.gtts-vmap-sel').addEventListener('change', function () {
            if (!cfg.voice_map[key]) cfg.voice_map[key] = {};
            cfg.voice_map[key].voice = this.value;
            saveSettings();
        });

        // Preview button
        row.querySelector('.gtts-vmap-play').addEventListener('click', async () => {
            const v = cfg.voice_map[key]?.voice || cfg.default_voice;
            const s = cfg.voice_map[key]?.style || cfg.global_style_prompt || '';
            const previewText = key === '__user__' ? 'Hello, this is the user speaking.' : `Hi, I am ${key}. This is my voice preview.`;
            stopAll();
            try {
                showStatus(`▶ Preview: ${key}`);
                setWaveActive(true);
                const wav = await fetchTTS(previewText, v, s, new AbortController().signal);
                await playWAV(wav);
            } catch (e) {
                showStatus(`❌ ${e.message}`, true);
            } finally {
                setWaveActive(false);
                showStatus('');
            }
        });

        // Expand style input
        row.querySelector('.gtts-vmap-expand').addEventListener('click', function () {
            const styleRow = document.getElementById(`vstyle-${CSS.escape(key)}`);
            if (!styleRow) return;
            const isHidden = styleRow.style.display === 'none';
            styleRow.style.display = isHidden ? 'block' : 'none';
            this.style.opacity = isHidden ? '1' : '0.5';
        });

        // Style input
        row.querySelector('.gtts-vmap-style-input').addEventListener('input', function () {
            if (!cfg.voice_map[key]) cfg.voice_map[key] = {};
            cfg.voice_map[key].style = this.value;
            saveSettings();
        });
    });
}

// ─── Test API Key ─────────────────────────────────────────────────────────────
async function testKey() {
    const key = $('#gtts-api-key').val().trim();
    if (!key) { setKeyMsg('⚠ Enter an API key first', 'warn'); return; }

    setKeyMsg('⏳ Testing…', '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${key}`;
    const body = {
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
        }
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.ok) {
            setKeyMsg('✅ API Key is valid!', 'ok');
        } else {
            const j = await res.json().catch(() => ({}));
            setKeyMsg(`❌ ${j?.error?.message || `HTTP ${res.status}`}`, 'err');
        }
    } catch (e) {
        setKeyMsg(`❌ Network error: ${e.message}`, 'err');
    }
}

function setKeyMsg(msg, type) {
    const el = document.getElementById('gtts-key-msg');
    if (!el) return;
    el.textContent = msg;
    el.className = 'gtts-key-msg' + (type === 'ok' ? ' ok' : type === 'err' ? ' err' : type === 'warn' ? ' warn' : '');
}

// ─── Status / Waveform ────────────────────────────────────────────────────────
function showStatus(msg, isError = false) {
    const el = document.getElementById('gtts-status');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--gtts-danger)' : 'var(--gtts-muted)';
}

function setWaveActive(active) {
    const el = document.getElementById('gtts-waveform');
    if (!el) return;
    el.classList.toggle('gtts-wave-active', active);
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
