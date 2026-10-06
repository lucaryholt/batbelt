# Working in batbelt

## Project shape

- `src/` is the Node.js/TypeScript host and module backend. Hono routes live with each module.
- `web/src/` is the React/Vite frontend. The shared sidebar, routing, and global shortcuts live in `web/src/shell/`.
- `src-tauri/` is the macOS menu-bar wrapper.
- Each module is under `src/modules/<name>/`, with its UI under `web/src/modules/<name>/` and focused documentation in the backend module's `README.md`.
- Module metadata (`id`, title, pages) is the source for host registration, sidebar links, and keyboard page navigation.

## Development conventions

- Use strict TypeScript and ES modules. Backend relative imports include the `.js` extension; frontend imports follow the existing extensionless style.
- Keep module-specific behavior inside its module. Put cross-module navigation and keyboard behavior in the shared shell.
- Treat YAML and API input as untrusted: normalize values, validate required fields, reject invalid values with clear messages, and preserve backward-compatible defaults.
- Keep backend and frontend API types synchronized when changing response shapes.
- Do not edit generated output in `dist/`, build artifacts, lockfiles, or user configuration unless the task requires it.
- Preserve existing user config. Seed files only when missing; do not silently overwrite them.
- Use generic examples such as `a-team`, `b-team`, `svc-1`, and `kind-dev`; do not introduce organization, product, or real team names.
- Update the root README and the relevant module README when behavior, configuration, routes, requirements, or keyboard shortcuts change.

## Tests and verification

- Add or update colocated Vitest tests (`*.test.ts`) for backend behavior and config parsing.
- Run the narrowest relevant tests while iterating: `npm test -- <test paths>`.
- Before handing off substantive changes, run:
  - `npm run typecheck`
  - `npm test`
- Run `npm run build` when changing build integration, frontend entry points, routing, or desktop packaging.
- For UI changes, also verify the affected flow manually when browser access is available. Check keyboard handlers with focused inputs so global shortcuts do not steal text entry.

## Useful commands

```bash
npm run dev       # API on 3870 and Vite UI on 3871
npm run typecheck
npm test
npm run build
npm run desktop:dev
```

Node.js 20 or newer is required. Optional module CLIs (`kubectl`, `bao`, `gh`, `code`, `pi`, and Kitty tools) may be absent in development; keep missing-tool states graceful.

## Releases

- Run `npm run release -- patch|minor|major|X.Y.Z` only from a clean `main` synchronized with `origin/main`.
- The release script synchronizes versions in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.
- Releases require macOS, npm, Cargo/Tauri, Git, and an authenticated `gh` CLI. They run typechecking, tests, and the desktop build before committing or publishing.
- The script creates `Release vX.Y.Z`, pushes the annotated tag, and uploads the unsigned DMG with GitHub-generated notes.
- Do not rewrite release history after a push. If GitHub publication fails, use the retry command printed by the script.
