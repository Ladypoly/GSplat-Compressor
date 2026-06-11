// Copies static assets the app serves itself (no backend) into web/public/:
//  - the SuperSplat viewer site  -> web/public/viewer/
//  - the default viewer settings -> web/public/viewer-settings.json
// Run before dev and build.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pkgRoot(spec) {
  let dir = path.dirname(fileURLToPath(import.meta.resolve(spec)));
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`package root not found for ${spec}`);
    dir = up;
  }
  return dir;
}

const viewerPublic = path.join(pkgRoot('@playcanvas/supersplat-viewer'), 'public');
const destViewer = path.join(ROOT, 'web', 'public', 'viewer');

fs.rmSync(destViewer, { recursive: true, force: true });
fs.mkdirSync(destViewer, { recursive: true });
fs.cpSync(viewerPublic, destViewer, { recursive: true });

// Default viewer settings (kept in repo).
fs.copyFileSync(
  path.join(ROOT, 'viewer-settings.json'),
  path.join(ROOT, 'web', 'public', 'viewer-settings.json')
);

console.log(`copied viewer -> ${path.relative(ROOT, destViewer)}`);
console.log('copied viewer-settings.json -> web/public/');
