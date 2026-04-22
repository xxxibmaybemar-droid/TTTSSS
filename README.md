# 🎙️ Gemini TTS v2.0 — SillyTavern Extension

**Compatible with:** SillyTavern **1.17.0+**  
**API:** Google AI Studio (Gemini TTS)  
**Models:** `gemini-3.1-flash-tts-preview` · `gemini-2.5-flash-preview-tts` · `gemini-2.5-pro-preview-tts`

---

## ✨ What's New in v2.0

| | v1 | v2 |
|---|---|---|
| ST API | ❌ wrong imports | ✅ `SillyTavern.getContext()` |
| Quotes extraction | basic regex | ✅ Robust (handles nested, skips asterisks) |
| PCM → Audio | Web Audio API (low compat) | ✅ PCM16 → WAV Blob → `<audio>` |
| Fetch cancel | ❌ no cancel | ✅ AbortController |
| Queue | ❌ race condition | ✅ Mutex-based drain loop |
| Message buttons | ❌ double-bind | ✅ MutationObserver delegation |
| Chat switching | ❌ stale voice map | ✅ CHAT_CHANGED event |
| Per-char style | ❌ | ✅ Per-character style prompt |
| Skip asterisks | ❌ | ✅ Configurable option |
| Settings save | immediate | ✅ Debounced 500ms |
| Waveform | ❌ | ✅ Animated bars |

---

## 📦 Installation

```
SillyTavern/
└── public/
    └── scripts/
        └── extensions/
            └── third-party/
                └── gemini-tts/          ← วางโฟลเดอร์นี้
                    ├── index.js
                    ├── style.css
                    ├── manifest.json
                    └── README.md
```

รีสตาร์ท SillyTavern → เปิด Extensions panel → เห็น **Gemini TTS** ✓

---

## 🔑 Setup (2 นาที)

1. ขอ API Key ฟรีจาก **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)**
2. Extensions panel → **Gemini TTS** → เปิด toggle
3. ใส่ API Key → กด **Test** (ควรขึ้น ✅)
4. เลือก Model และ Read Mode
5. กด **↻ Refresh** เพื่อโหลดรายชื่อตัวละคร
6. กำหนดเสียงใน Voice Map

---

## 🤖 Models

| Model | Speed | Quality | Best for |
|---|---|---|---|
| `gemini-3.1-flash-tts-preview` | ⚡⚡⚡ | ⭐⭐⭐⭐⭐ | Real-time roleplay |
| `gemini-2.5-flash-preview-tts` | ⚡⚡ | ⭐⭐⭐⭐ | Everyday use |
| `gemini-2.5-pro-preview-tts` | ⚡ | ⭐⭐⭐⭐⭐+ | Long-form, best quality |

---

## 📖 Read Modes

### 🗣 คำพูดเท่านั้น (quotes_only)
```
Input:  *เธอยิ้ม* "สวัสดีค่ะ!" *เธอโบกมือ* "ยินดีที่ได้รู้จักนะ"
Output: สวัสดีค่ะ! … ยินดีที่ได้รู้จักนะ
```
- อ่านเฉพาะข้อความใน `"เครื่องหมายคำพูดคู่"`
- ข้าม `"quotes"` ที่อยู่ใน `*asterisks*` โดยอัตโนมัติ

### 📜 คำพูด + บรรยาย (full_text)
```
Input:  *เธอยิ้ม* "สวัสดีค่ะ!" **ด้วยความร่าเริง**
Output: เธอยิ้ม สวัสดีค่ะ! ด้วยความร่าเริง
```
- ลบ `*`, `**`, `#`, `` ` ``, links, code blocks ออกอัตโนมัติ
- มี option "ข้ามข้อความใน *asterisks*" ถ้าอยากฟังเฉพาะคำพูด + text ปกติ

---

## 🎤 Voices (30 ตัว)

**หญิง:** Kore, Leda, Aoede, Zephyr, Callirrhoe, Autonoe, Despina, Erinome, Laomedeia, Achernar, Alnilam, Schedar, Gacrux, Pulcherrima, Achird, Zubenelgenubi, Vindemiatrix, Sadatoni, Murphrid, Sulafat

**ชาย:** Puck, Charon, Fenrir, Orus, Iapetus, Umbriel, Algieba, Algenib, Rasalased, Enceladus

---

## ✨ Style Prompts

**Global** (ใช้กับทุกตัวละคร):
```
Speak warmly and gently, like a caring storyteller.
พูดด้วยน้ำเสียงร่าเริงและสดใส
Use a calm, mysterious tone with slow deliberate pacing.
```

**Per-character** (กด ✏️ ในแต่ละตัวละคร):
```
[Aria]  → Speak softly and shyly, hesitating slightly
[Boss]  → Deep authoritative voice, speak firmly and decisively
[User]  → Natural conversational tone
```

---

## 🛠 Technical Notes

- Audio: PCM16 @ 24kHz → WAV header → Blob URL → `<audio>` element
- Queue: Sequential with mutex, AbortController cancels in-flight requests  
- Buttons: MutationObserver watches `#chat` for new `.mes` nodes  
- Settings: Debounced save (500ms) to `extension_settings.gemini_tts`

---

## 📄 License — MIT
