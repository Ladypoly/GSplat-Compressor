# GSplat Compressor

A small **100% client-side** web tool to convert and compress 3D Gaussian splats:
**load → compress → review → export**. Files never leave your browser — all
compression runs locally via [`@playcanvas/splat-transform`](https://github.com/playcanvas/splat-transform),
with the [SuperSplat viewer](https://github.com/playcanvas/supersplat-viewer) for
a linked before/after preview.

- **Load** a splat (`.ply`, `.compressed.ply`, `.sog`, `.spz`, `.splat`, `.ksplat`, `.lcc`) — read in-browser, nothing uploaded.
- **Compress / convert** to **SOG**, **Compressed PLY**, or **SPZ** (v3 gzip by default — broadly compatible, e.g. Unity gsplat readers).
- **Decimate** with a slider (keep %) or by exact **target splat count**; optional NaN filtering and spherical-harmonic band capping.
- **Review** original vs. result side by side with size / ratio / % saved / splat count. The two 3D views share a **linked camera**.
- **Export** with one click — filename is `<original>_<NN>pct.<ext>`.

## Requirements

A WebGPU-capable browser (Chrome/Edge) for SOG. SPZ and compressed-PLY work anywhere modern.

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build / preview

```bash
npm run build    # static site -> dist/
npm run preview  # serve the built dist/ locally
```

## Deploy (GitHub Pages)

Pushing to `main` builds and deploys via `.github/workflows/deploy.yml`
(enable Pages → "GitHub Actions" in repo settings). The Vite `base` is relative
(`./`), so it works from a project subpath (`https://<user>.github.io/<repo>/`).
The site is fully static — any static host (Cloudflare Pages, Netlify, …) works too.

## How it works

```
browser only — no server
 ├─ file picked  -> ArrayBuffer (never uploaded)
 ├─ readFile (MemoryReadFileSystem)      -> DataTable (splat count = numRows)
 ├─ processDataTable [filterNaN, filterBands, decimate]
 ├─ writeFile (MemoryFileSystem)         -> Uint8Array (SOG via WebGPU + WebP wasm)
 ├─ download via Blob
 └─ preview: blob: URL -> SuperSplat viewer iframe (compressed-PLY proxy for SOG/SPZ)
```

Notes:
- The SuperSplat viewer renders PLY-family content from a `blob:` URL; SOG/SPZ
  outputs are previewed via an equivalent compressed-PLY proxy (same splats).
- `scripts/copy-assets.mjs` (run by `prepare-assets`) copies the viewer site and
  `viewer-settings.json` into `web/public/`.
- Vite keeps the WebP `.wasm` filename unhashed so the emscripten module's
  `new URL('webp.wasm', import.meta.url)` resolves in the production build.

## Project layout

```
web/            frontend (index.html, main.js, style.css)
web/public/     generated: viewer/ + viewer-settings.json (gitignored)
scripts/        copy-assets.mjs, gen-test-splat.mjs
viewer-settings.json   default SuperSplat viewer settings
vite.config.js  static build config (base './', wasm handling)
```

## Testing

`scripts/gen-test-splat.mjs` writes a minimal valid 3DGS PLY for local testing:

```bash
node scripts/gen-test-splat.mjs sample.ply 20000
```
