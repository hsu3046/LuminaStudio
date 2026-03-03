# Lumina Studio

<p align="center">
  <strong>Native macOS Image Viewer & AI Image Generation Studio</strong><br>
  Built with Tauri v2 + React 19
</p>

---

## Summary-en

Lumina Studio is a free macOS app that lets you browse your photo library and create new images with AI — all in one place. Pick any photos from your folders, use them as inspiration, and generate stunning new images with a single click. Supports Google Gemini, OpenAI, and SeedDream (API key required for AI generation).

## Summary-ko

Lumina Studio는 macOS용 무료 앱으로, 내 컴퓨터의 사진을 갤러리로 감상하고 AI로 새로운 이미지를 만들 수 있습니다. 마음에 드는 사진을 골라 영감의 소스로 활용하면, 클릭 한 번으로 멋진 이미지가 생성됩니다. Google Gemini, OpenAI, SeedDream을 지원합니다 (AI 이미지 생성에는 각 서비스의 API 키 발급이 필요합니다).

## Summary-ja

Lumina Studioは、macOS用の無料アプリです。パソコン内の写真をギャラリーとして閲覧し、AIで新しい画像を作成できます。お気に入りの写真をインスピレーションとして選び、ワンクリックで素敵な画像を生成。Google Gemini、OpenAI、SeedDreamに対応しています（AI画像生成には各サービスのAPIキーの取得が必要です）。

---

## ✨ Features

### 📁 Gallery — Local Image Browser

- **Directory navigation** with breadcrumb path display and parent folder traversal
- **Smart file filtering** — automatically shows only images, videos, and folders (hides system/config files)
- **Cached thumbnails** — Lanczos3-quality JPEG thumbnails with on-disk MD5-hashed cache (`~/Library/Caches/lumina-studio/thumbnails/`)
- **Lazy loading** with IntersectionObserver and a 3-concurrent-request semaphore for smooth performance
- **Pagination** — loads 30 items at a time with a "Load More" button for predictable scrolling
- **Selection mode** — multi-select up to 5 images with visual checkmarks, then send them as AI generation references
- **Quick Access** sidebar — one-click navigation to Home and Pictures directories

### 🖼️ Lightbox — Fullscreen Image Viewer

- Full-resolution image display with dark overlay
- Keyboard navigation (← → arrow keys)
- Filename display overlay

### 🎨 AI Image Generation

Generate images using three AI providers, all via Tauri's native HTTP plugin (bypasses CORS — no proxy server needed):

| Provider | Model | Reference Support | Response Format |
|----------|-------|-------------------|-----------------|
| **Google Gemini** | gemini-3.1-flash-image-preview | ✅ via `inlineData` parts | base64 inline |
| **OpenAI** | gpt-image-1 | ✅ via multipart `image[]` | b64_json / url |
| **ByteDance SeedDream** | seedream-4-5-251128 | ✅ via `image` param | url |

**Generation options:**
- **8 aspect ratios** — 1:1, 3:2, 2:3, 4:3, 3:4, 16:9, 9:16, 21:9
- **3 quality levels** — Standard, 2K, 4K
- **Batch generation** — 1–4 images per request
- **Real-time cost estimation** per provider/quality/size
- **Reference images** — use gallery photos as generation references (max 5)

### 🔗 Gallery → Generate Workflow

A seamless workflow connecting browsing and creation:

1. Enter **Selection Mode** in Gallery (checkbox button)
2. Select up to 5 reference images
3. Click "Use as Reference" → automatically switches to Generate page
4. Reference images are pre-loaded and ready for AI generation

### ⚙️ Settings

- Per-provider API key management
- Default provider, quality, and aspect ratio configuration
- All settings stored in `localStorage` — **never transmitted externally**

---

## 🛠 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 19, TypeScript, Vite 7 | UI & state management |
| **Backend** | Rust, Tauri v2 | Native OS integration, image processing |
| **Image Processing** | `image` crate (Lanczos3) | Thumbnail generation |
| **HTTP** | `tauri-plugin-http` | CORS-free API requests at Rust level |
| **File System** | `tauri-plugin-fs`, `walkdir` | Directory scanning & file access |
| **Styling** | Vanilla CSS (Dark Theme) | Custom dark UI |
| **Icons** | Lucide React | UI iconography |

---

## 📦 Installation

### Download DMG (macOS)

Go to the [Releases](../../releases) page and download the latest `.dmg` file.

> ⚠️ **Unsigned app:** On first launch, macOS Gatekeeper will block the app.
> Go to **System Settings → Privacy & Security → Open Anyway** to allow it.

### Build from Source

```bash
# Prerequisites: Node.js 18+, Rust 1.77+

git clone https://github.com/user/lumina-studio.git
cd lumina-studio
npm install

# Development
npm run tauri dev

# Production Build (macOS DMG)
npm run tauri build -- --bundles dmg
```

---

## 🔑 API Keys

Configure your AI provider API keys in the Settings page:

| Provider | Get API Key |
|----------|------------|
| Gemini | [Google AI Studio](https://aistudio.google.com/) |
| OpenAI | [OpenAI Platform](https://platform.openai.com/) |
| SeedDream | [BytePlus Console](https://console.bytepluses.com/) |

> 🔒 API keys are stored **only in your local `localStorage`** and are sent directly from the app to the respective API endpoints via Tauri's native HTTP engine. They are never transmitted to any third-party server.

---

## 🏗 Architecture

```
Frontend (React 19)          Backend (Rust / Tauri v2)       External APIs
┌─────────────────┐          ┌──────────────────────┐        ┌──────────────┐
│ App.tsx          │──IPC───▶│ commands.rs           │        │ Gemini       │
│ ├─ Gallery View  │         │ ├─ scan_directory     │        │ OpenAI       │
│ ├─ Generate Page │         │ ├─ get_thumbnail      │        │ SeedDream    │
│ └─ Settings Page │         │ └─ get_image_base64   │        └──────────────┘
│                  │         └──────────────────────┘               ▲
│ imageGen.ts      │──tauriFetch (Rust HTTP)────────────────────────┘
└─────────────────┘
```

---

## 📄 License

This project is licensed under the **GNU General Public License v3.0** — see the [LICENSE](LICENSE) file for details.

Copyright (c) 2026 KnowAI
