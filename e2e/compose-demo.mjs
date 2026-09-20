#!/usr/bin/env node
// Composites the frames captured by e2e/extension.spec.ts into one demo video: the shop
// page as the base layer, with each toolbar popup overlaid top-right for exactly the
// interval it was open — the way it looks in a real browser.
//
// Usage: node e2e/compose-demo.mjs   (after `npx playwright test`)
// Output: e2e/output/demo.mp4 and e2e/output/demo.gif

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const OUTPUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'output');
const FRAMES = path.join(OUTPUT, 'frames');
const PAGE = { width: 1280, height: 800 };
// A real popup is at most 800×600; ours is 320 wide plus a scrollbar when it overflows.
const POPUP = { width: 340, height: 600 };
const POPUP_HOLD_SECONDS = 0.35; // keep a closed popup's last frame briefly, like the real fade
const TAIL_SECONDS = 1.5;

function ffmpeg(args, label) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed while ${label}`);
}

/**
 * Re-renders every frame of a stream onto a fixed-size canvas. A popup resizes itself as
 * its content changes, and ffmpeg re-initialises (and effectively truncates) a filtergraph
 * whenever an input's dimensions change mid-stream, so sizes are normalised up front.
 * Popup frames are padded with transparency, so the overlay is only as tall as the popup.
 */
function normalize(stream, kind) {
  const dir = path.join(FRAMES, `${stream.name}-normalized`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const filter =
    kind === 'popup'
      ? `crop=min(iw\\,${POPUP.width}):min(ih\\,${POPUP.height}):0:0,format=rgba,pad=${POPUP.width}:${POPUP.height}:0:0:color=black@0.0`
      : `scale=${PAGE.width}:${PAGE.height}:force_original_aspect_ratio=decrease,pad=${PAGE.width}:${PAGE.height}:(ow-iw)/2:(oh-ih)/2:color=white`;
  return {
    ...stream,
    frames: stream.frames.map((frame, i) => {
      const file = path.join(dir, `${String(i).padStart(5, '0')}.png`);
      ffmpeg(['-i', frame.file, '-vf', filter, '-frames:v', '1', file], `normalising ${stream.name} frame ${i}`);
      return { ts: frame.ts, file };
    }),
  };
}

/** Writes an ffmpeg concat list where each frame lasts until the next one arrived. */
function writeConcatList(stream, endTs) {
  const lines = [];
  stream.frames.forEach((frame, i) => {
    const next = stream.frames[i + 1];
    const duration = Math.max(0.001, (next ? next.ts : endTs) - frame.ts);
    lines.push(`file '${frame.file}'`, `duration ${duration.toFixed(4)}`);
  });
  // The concat demuxer ignores the final duration unless the last file is repeated.
  lines.push(`file '${stream.frames.at(-1).file}'`);
  const file = path.join(FRAMES, `${stream.name}.txt`);
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const manifest = JSON.parse(fs.readFileSync(path.join(FRAMES, 'manifest.json'), 'utf8'));
const streams = manifest.streams.filter((s) => s.frames.length > 0);
const rawShop = streams.find((s) => s.name === 'shop');
if (!rawShop) throw new Error('no shop frames were recorded');

console.log('normalising frames…');
const shop = normalize(rawShop, 'page');
const popups = streams.filter((s) => s.name.startsWith('popup')).map((s) => normalize(s, 'popup'));

const t0 = shop.frames[0].ts;
const tEnd = Math.max(...[shop, ...popups].map((s) => s.frames.at(-1).ts)) + TAIL_SECONDS;

const inputs = ['-f', 'concat', '-safe', '0', '-i', writeConcatList(shop, tEnd)];
const filters = [`[0:v]fps=20,format=yuv420p[base]`];
let last = 'base';

popups.forEach((popup, i) => {
  const offset = popup.frames[0].ts - t0;
  inputs.push('-f', 'concat', '-safe', '0', '-i', writeConcatList(popup, popup.frames.at(-1).ts + POPUP_HOLD_SECONDS));
  filters.push(`[${i + 1}:v]setpts=PTS+${offset.toFixed(4)}/TB[p${i}]`);
  // eof_action=pass removes the overlay once the popup stream ends, i.e. when it closed.
  filters.push(`[${last}][p${i}]overlay=x=W-w-28:y=52:eof_action=pass[v${i}]`);
  last = `v${i}`;
});

const mp4 = path.join(OUTPUT, 'demo.mp4');
const gif = path.join(OUTPUT, 'demo.gif');

console.log('encoding…');
ffmpeg(
  [...inputs, '-filter_complex', filters.join(';'), '-map', `[${last}]`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', mp4],
  'composing demo.mp4'
);
ffmpeg(
  ['-i', mp4, '-vf', 'fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', gif],
  'converting to demo.gif'
);

console.log(
  `demo: ${(tEnd - t0).toFixed(1)}s — ${shop.frames.length} page frames, ${popups.map((p) => p.frames.length).join('+')} popup frames`
);
console.log(mp4);
console.log(gif);
