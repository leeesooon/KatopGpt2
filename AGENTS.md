# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-11
**Commit:** 9beb150
**Branch:** main

## OVERVIEW

Electron desktop LLM chat client (KatopGPT). React 18 + TypeScript + Vite 6 + Tailwind CSS 3 + Zustand 4. Chinese UI (zh-CN). Supports multiple API providers, streaming responses, image/file attachments, and OCR fallback for non-multimodal models.

## STRUCTURE

```
./
├── electron/              # Electron main process + preload (IPC bridge)
├── src/
│   ├── components/        # 7 React components (all functional, no class components)
│   │   ├── ChatView.tsx   # Main chat orchestrator — sends messages, handles streaming
│   │   ├── InputArea.tsx  # Message input — text, images, files, drag-and-drop, paste
│   │   ├── SettingsModal.tsx  # Provider CRUD, model params, API key management
│   │   ├── Sidebar.tsx    # Conversation list with rename/delete
│   │   ├── MessageBubble.tsx  # Markdown rendering with syntax highlighting
│   │   ├── ModelSelector.tsx  # Provider/model dropdown selector
│   │   └── TitleBar.tsx   # Custom frameless window controls
│   ├── services/
│   │   ├── chatApi.ts     # OpenAI-compatible streaming API client (async generator)
│   │   └── ocr.ts         # Tesseract.js OCR for images on non-multimodal models
│   ├── store/
│   │   └── chatStore.ts   # Zustand store — conversations, settings, streaming state
│   ├── types/
│   │   └── index.ts       # All TypeScript interfaces + resolveApiConfig() helper
│   ├── App.tsx            # Root layout: TitleBar + Sidebar + ChatView + SettingsModal
│   ├── main.tsx           # React entry point
│   └── index.css          # Tailwind layers + markdown styles + glass-panel utilities
├── dist/                  # Vite build output (web assets)
└── dist-electron/         # Compiled Electron main/preload
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new component | `src/components/` | Functional component, default export, Tailwind classes |
| Change API behavior | `src/services/chatApi.ts` | `streamChat()` is an async generator yielding chunks |
| Modify data model | `src/types/index.ts` | All interfaces live here; update store migration if schema changes |
| Change state/persistence | `src/store/chatStore.ts` | Zustand + `persist` middleware; bump `version` on schema change |
| Electron/IPC changes | `electron/main.ts` + `electron/preload.ts` | Context bridge pattern; add to both files |
| Styling/theme | `tailwind.config.js` + `src/index.css` | Custom `primary` and `surface` color scales |
| Build config | `vite.config.ts` | Electron plugin handles main/preload compilation |

## CONVENTIONS

- **No linter/formatter configured** — no ESLint, Prettier, or pre-commit hooks
- **Path alias**: `@/*` maps to `src/*` (tsconfig + vite)
- **Components**: Functional only, `export default function Name()` pattern
- **State access**: `useChatStore()` hook everywhere, no prop drilling for global state
- **Icons**: Lucide React exclusively (`lucide-react`)
- **Styling**: Tailwind utility classes inline; reusable utilities in `index.css` (`btn-primary`, `btn-ghost`, `input-field`, `glass-panel`)
- **Chinese UI strings**: All user-facing text is in Chinese (e.g. `'新对话'`, `'发送消息...'`)
- **Streaming throttle**: `requestAnimationFrame` used to batch state updates during streaming

## ANTI-PATTERNS (THIS PROJECT)

- **API keys logged to console** — `chatApi.ts` logs full request bodies via `console.dir`; do not add more sensitive logging
- **No tests** — no test framework, no test files exist
- **No CI/CD** — no GitHub Actions, Makefile, or Dockerfile
- **Deprecated transitive deps** — `glob` and `tar` in `package-lock.json` have known vulnerabilities

## UNIQUE STYLES

- **Multi-provider architecture**: Users configure N providers (OpenAI, DeepSeek, etc.) each with N models. `resolveApiConfig()` flattens `ModelSelection → ApiConfig` for API calls
- **Store migration**: `chatStore.ts` has versioned migrations (v0→v1: single-api to multi-provider; v1→v2: string[] models to ModelConfig[]). Bump `version` and add migration case when changing persisted schema
- **OCR fallback**: When user attaches images to a non-multimodal model, images are OCR'd via tesseract.js and text is prepended to the message
- **Frameless window**: Electron `frame: false` with custom `TitleBar.tsx`; CSS uses `-webkit-app-region: drag/no-drag`
- **Glass morphism**: `.glass-panel` class uses `backdrop-blur-xl` + semi-transparent backgrounds

## COMMANDS

```bash
npm run dev            # Vite dev server (browser-only, no Electron)
npm run electron:dev   # Build + launch Electron app
npm run build          # tsc && vite build && electron-builder (production)
npm run preview        # Vite preview of built web assets
```

## NOTES

- `tsconfig.json` has `noUnusedLocals: false` and `noUnusedParameters: false` — unused vars won't error
- Zustand persistence key: `'katop-gpt-storage'` in localStorage
- `window.electronAPI` is typed implicitly — no global `.d.ts` declaration file exists
- `postcss.config.js` uses CommonJS (`module.exports`), rest of config is mixed ESM/CJS
- The `nul` file in root is likely accidental (Windows NUL device artifact)
