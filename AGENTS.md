# AGENTS.md

## Purpose
This file is for agentic coding assistants working in `E:\PyProject\KatopGpt`.
Use it as the repository-specific source for commands, architecture notes, and code style.

## Rule Files
- No `.cursorrules` file was found.
- No files were found under `.cursor/rules/`.
- No `.github/copilot-instructions.md` file was found.
- If any of those files appear later, treat them as additional constraints alongside this file.

## Project Snapshot
- Electron desktop LLM chat client with a React renderer.
- Stack: React 18, TypeScript 5, Vite 6, Tailwind CSS 3, Zustand 4, Electron 33.
- UI language is Chinese; user-facing copy should stay Chinese.
- Main features: multi-provider chat, streaming responses, search augmentation, OCR fallback,
  Markdown workspace, and document extraction for `pptx`, `pdf`, and `docx`.
- TypeScript runs in `strict` mode.
- Path alias `@/* -> src/*` exists, but most source files prefer relative imports.
- No lint, formatter, or automated test framework is configured.

## Repo Map
- `src/components/`: renderer UI components.
- `src/services/`: chat API, OCR, search, webpage parsing, document-agent helpers.
- `src/store/`: Zustand stores for chat state and workspace state.
- `src/types/index.ts`: shared business types and `DEFAULT_SETTINGS`.
- `src/index.css`: Tailwind layers and shared utility classes like `btn-primary` and `glass-panel`.
- `electron/main.ts`: Electron main process, IPC handlers, workspace filesystem, API proxying.
- `electron/preload.ts`: `contextBridge` API exposed to the renderer.
- `src/vite-env.d.ts`: renderer typings for `window.electronAPI`.
- `dist/`, `dist-renderer/`, `dist-electron/`, and `electron/*.d.ts`: generated output; do not hand-edit.

## Source Of Truth
- Chat/provider/settings models live in `src/types/index.ts`.
- Persisted chat-state migration logic lives in `src/store/chatStore.ts`.
- Workspace session behavior lives in `src/store/workspaceStore.ts`.
- Streaming behavior is split between `src/services/chatApi.ts` and `electron/main.ts`.
- Search behavior is split between `src/services/searchApi.ts` and `src/services/webpage.ts`.
- Any IPC change must stay aligned across `electron/main.ts`, `electron/preload.ts`, and `src/vite-env.d.ts`.

## Commands
- Install dependencies: `npm install`
- Renderer-only dev server: `npm run dev`
- Electron dev launch: `npm run electron:dev`
- Production build/package: `npm run build`
- Preview renderer build: `npm run preview`
- Fast type-check only: `npx tsc --noEmit`

## Command Notes
- `npm run dev` starts Vite for the renderer only; Electron-only APIs are unavailable there.
- `npm run electron:dev` runs a Vite build and then launches `electron .`; it is not a real hot-reload loop.
- `npm run build` runs `tsc && vite build --config vite.config.ts && electron-builder`.
- `npx tsc --noEmit` is the lightest useful validation command for most code-only changes.

## Lint / Test Reality
- ESLint: none.
- Prettier or other formatter: none.
- Unit/integration/E2E tests: none.
- No `*.test.*` or `*.spec.*` files were found.
- Single-test command: not available because no test runner is installed.
- Manual verification is the normal validation path today.

## Recommended Validation
- Type-only or logic-only changes: run `npx tsc --noEmit`.
- Renderer UI changes: use `npm run dev` for quick browser verification.
- Electron, IPC, workspace, or filesystem changes: use `npm run electron:dev`.
- Packaging-sensitive changes: use `npm run build`.
- Search-related regressions: consult `QUICK_TEST_GUIDE.md` for the existing manual checklist.

## Architecture Notes
- The renderer must tolerate browser-only mode where `window.electronAPI` is missing.
- Electron-only capabilities are guarded with optional chaining and graceful fallbacks.
- `chatStore` uses Zustand `persist`; schema changes require a version bump and migration.
- `workspaceStore` keeps workspace sessions keyed by conversation; do not flatten that behavior.
- The workspace filesystem currently only allows `.md`, `.markdown`, and `.txt` files in `electron/main.ts`.
- Search and webpage enrichment are non-blocking helpers; failures should not stop the main chat flow.
- The chat UI batches streaming updates with `requestAnimationFrame` to reduce store churn.
- Document extraction support is implemented through Electron IPC, not directly in the renderer.

## Style Guide

### Imports
- Follow the local file's existing import style before trying to reorder everything.
- In general: React/core imports first, third-party packages next, app modules after that.
- Keep type-only imports explicit with `import type`.
- Prefer relative imports for nearby app modules; use `@/` only when it clearly improves readability.
- Renderer imports usually omit file extensions; Electron code may include `.ts` when the existing file already does.

### Formatting
- Use 2-space indentation.
- Use single quotes.
- Avoid semicolons unless the surrounding file already needs them.
- Keep trailing commas in multiline objects, arrays, params, and JSX props when nearby code does.
- Prefer early returns and small helpers over deeply nested inline logic.
- Keep comments sparse; add them only for genuinely non-obvious behavior.

### React And State
- Components are function components; do not introduce class components.
- The dominant export style is `export default function ComponentName()`.
- Declare component props with a nearby `interface XProps`.
- Keep hooks at the top of the component.
- Event handlers usually use `handleX` naming.
- Business state belongs in Zustand stores, not React context.
- Prefer store actions over ad hoc state mutation in components.

### TypeScript
- Shared business types belong in `src/types/index.ts` unless they are truly file-local.
- Prefer explicit interfaces and string unions over loose object shapes.
- Use `unknown` for caught errors and narrow with `instanceof Error`.
- Avoid introducing new `any`; there are a few localized exceptions around markdown rendering.
- Preserve optional properties where the runtime actually permits them.
- If you change persisted settings or data shapes, update `DEFAULT_SETTINGS` and migration logic together.

### Naming
- Components, interfaces, types, and classes: `PascalCase`.
- Variables, functions, store actions, and helpers: `camelCase`.
- Module-level constants and regexes: `UPPER_SNAKE_CASE`.
- Boolean flags: prefix with `is`, `has`, `can`, or `should`.
- Keep internal identifiers in English even though visible UI text is Chinese.

### Error Handling
- User-facing error messages should stay in Chinese.
- Prefer graceful degradation for optional features like OCR, search, webpage reads, and Electron bridges.
- Use custom error classes when status codes matter; this repo already uses `ChatApiError` and `SearchApiError`.
- Parse upstream API error bodies defensively.
- Clean up readers, listeners, and subscriptions in `finally` blocks.
- Do not leak secrets in logs or error messages.
- Avoid adding more request-body logging because API keys are sensitive.

### Electron, IPC, And UI
- Keep `contextIsolation: true` and `nodeIntegration: false` intact.
- Expose the minimum necessary API through `contextBridge`.
- Validate and normalize external URLs before opening them.
- Validate workspace paths before reading or writing local files.
- If you add an IPC channel, update `electron/main.ts`, `electron/preload.ts`, and `src/vite-env.d.ts` in the same change.
- Styling is Tailwind-first; reuse utilities from `src/index.css` before inventing new patterns.
- Preserve the existing dark, glassy desktop UI unless the task explicitly changes design direction.
- Icons come from `lucide-react`.

## Practical Checklist
- Match imports, formatting, and naming to nearby files.
- Keep visible copy in Chinese and consistent with the existing tone.
- Avoid hand-editing generated output in `dist*` directories or `electron/*.d.ts`.
- If you touch persistence, verify versioning and migrations.
- If you touch IPC, verify preload and renderer typings stay in sync.
- Run the lightest relevant validation command for the scope of the change.
- Be explicit when validation could not be run or when manual verification is still required.
