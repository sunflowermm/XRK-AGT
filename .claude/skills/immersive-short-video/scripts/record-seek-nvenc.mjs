/**
 * 权威录屏：seekable 逐帧截屏 + h264_nvenc
 * 用法：复制到 tmp/<slug>/record.mjs，改 FINAL / 场景文件名后 node record.mjs
 *
 * 场景页必须实现：
 *   window.__XRK_DUR__  — 时长（秒）
 *   window.__XRK_SEEK__(t) — 渲染到绝对时间 t
 * 并以 ?capture=1 进入静帧模式。
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENE = process.env.XRK_SCENE || 'scenes.html';
const VOICE = process.env.XRK_VOICE || 'voice.mp3';
const FINAL = process.env.XRK_OUT || 'out.mp4';
const framesDir = path.join(__dirname, 'frames');
const finalMp4 = path.join(__dirname, FINAL);
const W = 1080;
const H = 1920;
const FPS = 60;

fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: __dirname, stdio: 'inherit' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} → ${code}`))));
  });
}

const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-dev-shm-usage',
    '--use-angle=d3d11',
    '--enable-gpu-rasterization',
    '--enable-zero-copy',
    '--ignore-gpu-blocklist',
  ],
});

const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
await page.goto(pathToFileURL(path.join(__dirname, SCENE)).href + '?capture=1', {
  waitUntil: 'load',
  timeout: 60000,
});
await page.waitForFunction(() => typeof window.__XRK_SEEK__ === 'function');

const DUR = await page.evaluate(() => window.__XRK_DUR__);
const totalFrames = Math.ceil(DUR * FPS);
console.log(`Capture ${totalFrames} frames @ ${FPS}fps · ${W}×${H} · NVENC after`);

const tStart = Date.now();
for (let i = 0; i < totalFrames; i++) {
  const t = i / FPS;
  await page.evaluate((sec) => {
    window.__XRK_SEEK__(sec);
  }, t);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
  await page.screenshot({
    path: path.join(framesDir, `f-${String(i).padStart(5, '0')}.jpg`),
    type: 'jpeg',
    quality: 92,
  });
  if (i % 120 === 0 || i === totalFrames - 1) {
    const elapsed = ((Date.now() - tStart) / 1000).toFixed(1);
    const fps = (i + 1) / ((Date.now() - tStart) / 1000);
    console.log(`  ${i + 1}/${totalFrames}  t=${t.toFixed(2)}s  ${elapsed}s elapsed  ~${fps.toFixed(1)} f/s`);
  }
}

await browser.close();
console.log('Encoding with h264_nvenc…');

await run('ffmpeg', [
  '-y',
  '-framerate', String(FPS),
  '-i', path.join(framesDir, 'f-%05d.jpg'),
  '-i', VOICE,
  '-vf', `format=yuv420p,fps=${FPS}`,
  '-map', '0:v:0',
  '-map', '1:a:0',
  '-c:v', 'h264_nvenc',
  '-preset', 'p5',
  '-rc', 'vbr',
  '-cq', '16',
  '-b:v', '14M',
  '-maxrate', '20M',
  '-bufsize', '28M',
  '-profile:v', 'high',
  '-movflags', '+faststart',
  '-c:a', 'aac',
  '-b:a', '320k',
  '-ar', '48000',
  '-shortest',
  finalMp4,
]);

fs.rmSync(framesDir, { recursive: true, force: true });

await run('ffprobe', [
  '-v', 'error',
  '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,r_frame_rate,codec_name,bit_rate',
  '-show_entries', 'format=duration,size',
  '-of', 'default=nw=1',
  finalMp4,
]);
console.log('OK', finalMp4);
