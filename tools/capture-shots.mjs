// Capture the game's screenshots for the entry: serve game/ locally, render each
// scene named in shots.json in headless Chromium, and save JPEGs under screenshots/.
// Run from the repo root: node tools/capture-shots.mjs
import { createServer } from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const gameDir = join(root, 'game');
const shotsDir = join(root, 'screenshots');
const CHROME = join(process.env.HOME, '.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell');
// The Playwright ffmpeg build (~/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux) has no
// PNG decoder and cannot read the screenshots, so conversion uses the system ffmpeg.
const FFMPEG = '/usr/bin/ffmpeg';
const MAX_BYTES = 250 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(gameDir, path === '/' ? 'index.html' : path);
  if (!file.startsWith(gameDir) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const shots = JSON.parse(readFileSync(join(root, 'shots.json'), 'utf8'));
try {
  for (const shot of shots) {
    const png = join(tmpdir(), `neon-palms-${shot.name}.png`);
    const url = `http://127.0.0.1:${port}/index.html${shot.query}`;
    const chromeArgs = [
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      '--window-size=1280,720', '--virtual-time-budget=8000',
      `--screenshot=${png}`, url,
    ];
    // Chromium must be spawned asynchronously: a synchronous spawn would block
    // this process's event loop, and the HTTP server above could never answer
    // the page requests (a self-deadlock). Bound each attempt and retry.
    const runChrome = () => new Promise((resolve) => {
      const child = spawn(CHROME, chromeArgs, { stdio: 'inherit' });
      const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
      child.on('error', () => { clearTimeout(timer); resolve(); });
      child.on('close', () => { clearTimeout(timer); resolve(); });
    });
    let captured = false;
    for (let attempt = 1; attempt <= 3 && !captured; attempt++) {
      await runChrome();
      captured = existsSync(png);
    }
    if (!captured) throw new Error(`Chromium produced no screenshot for ${shot.name}`);
    const out = join(shotsDir, shot.name);
    // Re-encode as JPEG, lowering quality (higher -q:v) until under the cap.
    for (let q = 4; ; q += 2) {
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', png, '-q:v', String(q), out], { stdio: 'inherit' });
      if (statSync(out).size <= MAX_BYTES || q >= 30) break;
    }
    rmSync(png, { force: true });
    console.log(`${shot.name}: ${statSync(out).size} bytes`);
  }
} finally {
  server.close();
}

// The kit's old third screenshot is not in the new list; remove it.
rmSync(join(shotsDir, '3-end.jpg'), { force: true });

console.log('screenshots/ now holds:');
for (const shot of shots) {
  const f = join(shotsDir, shot.name);
  console.log(`  ${shot.name}  ${existsSync(f) ? statSync(f).size : 'MISSING'} bytes`);
}
writeFileSync(join(tmpdir(), 'capture-shots-done.txt'), 'ok\n');
