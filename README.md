# 🖼️ Lumina Studio

## Tagline-en

Pick photos from your own library as creative references, generate new images with Gemini, OpenAI, or SeedDream, and save everything straight to your machine — one app, one seamless flow.

## Tagline-ko

내 컴퓨터에 쌓아둔 사진을 레퍼런스로 골라, Gemini · OpenAI · SeedDream으로 새 이미지를 생성하고, 바로 내 폴더에 저장까지. 모든 흐름이 하나의 앱에서 완결됩니다.

## Tagline-ja

手持ちの写真をリファレンスに選んで、Gemini・OpenAI・SeedDreamで新しい画像を生成。そのまま自分のフォルダに自動保存まで — すべての流れが、ひとつのアプリで完結します。

---

## Summary-en

What if the photos already on your computer could become the starting point for AI-generated images?
Lumina Studio lets you browse your local photo library, pick your favorite shots as creative references, and generate new images — all without switching apps.
Choose from three AI providers: Gemini, OpenAI, or SeedDream. Generated images are automatically saved to a folder you set.
Browse, generate, and save — one app, one uninterrupted flow.

## Summary-ko

폴더에 쌓아둔 사진들, AI 이미지 생성에 바로 활용할 수 있다면 어떨까요?
Lumina Studio는 내 컴퓨터의 사진을 빠르게 탐색하고, 마음에 드는 이미지를 레퍼런스로 골라 AI 이미지를 바로 생성합니다.
Gemini, OpenAI, SeedDream — 3가지 AI 모델 중 원하는 걸 골라 쓸 수 있고, 생성된 이미지는 지정한 폴더에 자동으로 저장됩니다.
브라우저 탭을 오가거나 따로 앱을 열 필요 없이, 탐색부터 생성, 저장까지 하나의 흐름으로 완결됩니다.

## Summary-ja

手持ちの写真を、AI画像生成のスタート地点に。
Lumina Studioなら、ローカルの写真ライブラリをすばやく見渡して、気に入ったショットをリファレンスに選ぶだけ。
Gemini・OpenAI・SeedDreamの3つのAIモデルから好きなものを選んで、そのまま新しい画像を生成できます。
生成した画像は指定フォルダに自動保存。ブラウズから生成、保存まで、すべてひとつのアプリで完結します。

---

## ✨ What It Does

- **Browse your local photos at native speed** — Lanczos3-quality cached thumbnails load instantly, with lazy loading and smart file filtering that hides system clutter.
- **Select references and generate in one flow** — Pick up to 5 photos from your gallery and send them straight to AI generation as creative references.
- **Generate images with 3 AI providers** — Google Gemini, OpenAI (gpt-image-1), and ByteDance SeedDream, all through Tauri's native HTTP engine — no CORS hacks, no proxy servers.
- **Choose your canvas** — 8 aspect ratios, 3 quality levels (up to 4K), and batch generation of 1–4 images per request.
- **See costs before you click** — Real-time cost estimation per provider, quality, and size so there are no billing surprises.
- **Auto-save generated images** — Configure a save folder in Settings and never lose a creation again.
- **Keep your keys safe** — API keys live only in localStorage, sent directly to providers via the native Rust HTTP layer — never stored or routed through any third-party server.
- **View images in a fullscreen lightbox** — Full-resolution display with keyboard navigation and filename overlay.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 + Vite 7 |
| Language | TypeScript (Strict) |
| Native Backend | Rust + Tauri v2 |
| Image Processing | `image` crate (Lanczos3) |
| HTTP | `tauri-plugin-http` (CORS-free) |
| File System | `tauri-plugin-fs` + `walkdir` |
| Styling | Vanilla CSS (Dark Theme) |
| Icons | Lucide React |

---

## 📦 Installation

### Download DMG (macOS)

Go to the [Releases](../../releases) page and download the latest `.dmg` file.

> ⚠️ **Unsigned app:** On first launch, macOS Gatekeeper will block the app.
> Go to **System Settings → Privacy & Security → Open Anyway** to allow it.

### Build from Source

```bash
# Prerequisites: Node.js 18+, Rust 1.77+

git clone https://github.com/hsu3046/LuminaStudio.git
cd LuminaStudio
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

## 📁 Project Structure

```
├── src/                    # React frontend
│   ├── App.tsx             # Main application shell & routing
│   ├── App.css             # Global styles (dark theme)
│   ├── pages/              # Page components (Gallery, Generate)
│   ├── services/           # API clients & settings logic
│   └── utils/              # Shared utilities
├── src-tauri/              # Rust backend (Tauri v2)
│   ├── src/                # Rust commands (scan, thumbnails, base64)
│   └── Cargo.toml          # Rust dependencies
├── api/                    # Serverless proxy (Vercel)
├── public/                 # Static assets
├── docs/                   # Project documentation
└── package.json            # Node dependencies & scripts
```

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

## � Roadmap

- [ ] Windows & Linux support
- [ ] Image editing & annotation tools
- [ ] Prompt history & favorites
- [ ] Batch processing from folder selection
- [ ] Plugin system for additional AI providers

---

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat(scope): add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

---

## �📄 License

This project is licensed under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html).

---

*Built by [KnowAI](https://knowai.space) · © 2026 KnowAI*
