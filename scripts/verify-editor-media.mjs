import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import childProcess from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import * as asar from "@electron/asar";

const appPath = path.resolve(process.argv[2] || "dist/Beyond Media Suite.app");
const resources = path.join(appPath, "Contents", "Resources");
const archive = path.join(resources, "app.asar");
const source = asar.extractFile(archive, "out/main/index.js").toString();
const handlerCode = source.slice(
  source.indexOf("const EvnetHandler ="),
  source.indexOf("const icon$1 ="),
);
const require = createRequire(import.meta.url);
const sharp = require(
  path.join(resources, "app.asar.unpacked/node_modules/sharp"),
);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bms-editor-test-"));
const ffmpeg = path.join(resources, "mac-apple", "ffmpeg");
const exec = promisify(childProcess.execFile);
const context = vm.createContext({
  fs,
  os,
  path,
  Buffer,
  console,
  setTimeout,
  clearTimeout,
  TextDecoder,
  sharp,
  node_child_process: childProcess,
  process: Object.assign(Object.create(process), { resourcesPath: resources }),
  getPlatformInfo: () => ({
    sysArch: "mac-apple",
    isWindows: false,
    supported: true,
  }),
  electron: {},
  reqObj: {},
  updater: () => ({}),
});
vm.runInContext(
  `${handlerCode}\nglobalThis.makeHandlers = EvnetHandler;`,
  context,
);
const handlers = context.makeHandlers({
  app: { isPackaged: true, getPath: () => directory },
  store: {},
  menu: {},
});
const run = (args) =>
  exec(ffmpeg, ["-hide_banner", "-y", ...args], { maxBuffer: 1024 * 1024 * 8 });
const probe = async (file) => {
  const { stderr } = await run([
    "-i",
    file,
    "-map",
    "0:v:0",
    "-frames:v",
    "1",
    "-f",
    "null",
    "-",
  ]);
  const match = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);
  assert.ok(match, stderr);
  return {
    duration:
      Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]),
    audio: /Audio:/.test(stderr),
    stderr,
  };
};
try {
  const video = path.join(directory, "source.mkv");
  await run([
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=160x90:r=20:d=4",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4",
    "-c:v",
    "ffv1",
    "-c:a",
    "pcm_s16le",
    video,
  ]);
  const trimmed = path.join(directory, "trimmed.mp4");
  await handlers.vConvert(null, {
    inputPath: video,
    outPath: trimmed,
    toFormat: "mp4",
    trimStartMs: 1000,
    trimEndMs: 3000,
    speed: 2,
    matchFps: true,
    targetFileSizeKb: 100,
    jobId: "trim",
  });
  const trimInfo = await probe(trimmed);
  assert.ok(
    Math.abs(trimInfo.duration - 1) < 0.12,
    `Trim/speed duration was ${trimInfo.duration}`,
  );
  assert.ok(trimInfo.audio, "Trimmed video lost audio");
  assert.ok(
    fs.statSync(trimmed).size <= 100000,
    "Trimmed target exceeded size ceiling",
  );

  const sequence = path.join(directory, "sequence.mkv");
  await handlers.editorSequenceIntermediate(null, {
    clips: [
      { path: video, startMs: 500, endMs: 1500, speed: 1 },
      { path: video, startMs: 2000, endMs: 3000, speed: 2 },
    ],
    outPath: sequence,
    fps: 20,
    jobId: "sequence",
  });
  const sequenceInfo = await probe(sequence);
  assert.ok(
    Math.abs(sequenceInfo.duration - 1.5) < 0.13,
    `Sequence duration was ${sequenceInfo.duration}`,
  );
  assert.ok(sequenceInfo.audio, "Sequence lost audio");

  const gif = path.join(directory, "source.gif");
  await run([
    "-i",
    video,
    "-t",
    "2",
    "-an",
    "-vf",
    "fps=10,split[a][b];[a]palettegen[p];[b][p]paletteuse",
    gif,
  ]);
  const webp = path.join(directory, "edited.webp");
  await handlers.vConvert(null, {
    inputPath: gif,
    outPath: webp,
    toFormat: "webp",
    quality: 1,
    trimStartMs: 500,
    trimEndMs: 1500,
    speed: 0.5,
    matchFps: true,
    jobId: "animation",
  });
  const webpInfo = await sharp(webp).metadata();
  assert.ok(webpInfo.pages > 1, "GIF-to-WebP became a still image");
  const webpDuration = webpInfo.delay.reduce((sum, delay) => sum + delay, 0);
  assert.ok(
    Math.abs(webpDuration - 2000) < 250,
    `WebP timing was ${webpDuration}ms`,
  );
  const webpBack = path.join(directory, "webp-back.webm");
  await handlers.vConvert(null, {
    inputPath: webp,
    outPath: webpBack,
    toFormat: "webm",
    quality: 1,
    trimStartMs: 500,
    trimEndMs: 1500,
    matchFps: true,
    jobId: "webp-back",
  });
  const backInfo = await probe(webpBack);
  assert.ok(
    Math.abs(backInfo.duration - 1) < 0.2,
    `Animated WebP input timing was ${backInfo.duration}`,
  );

  const alphaPng = path.join(directory, "alpha.png");
  await sharp({
    create: {
      width: 80,
      height: 90,
      channels: 4,
      background: { r: 255, g: 50, b: 30, alpha: 0.25 },
    },
  })
    .png()
    .toFile(alphaPng);
  const alphaBridge = path.join(directory, "alpha-sequence.mkv");
  await handlers.editorSequenceIntermediate(null, {
    clips: [
      { path: alphaPng, still: true, durationMs: 500, width: 80, height: 90 },
    ],
    width: 160,
    height: 90,
    fps: 10,
    outPath: alphaBridge,
    jobId: "alpha-sequence",
  });
  const alphaOutput = path.join(directory, "alpha-output.webm");
  await handlers.vConvert(null, {
    inputPath: alphaBridge,
    outPath: alphaOutput,
    toFormat: "webm",
    quality: 1,
    includeAudio: false,
    matchFps: true,
    jobId: "alpha-output",
  });
  const frame = path.join(directory, "decoded-alpha.png");
  await run(["-c:v", "libvpx-vp9", "-i", alphaOutput, "-frames:v", "1", frame]);
  const pixel = await sharp(frame).ensureAlpha().raw().toBuffer();
  assert.equal(pixel[3], 0, "Sequence padding lost transparency");
  assert.ok(
    pixel[(45 * 160 + 80) * 4 + 3] < 150,
    "Sequence source alpha lost transparency",
  );
  console.log(
    JSON.stringify({
      passed: true,
      trimDuration: trimInfo.duration,
      trimBytes: fs.statSync(trimmed).size,
      sequenceDuration: sequenceInfo.duration,
      webpDurationMs: webpDuration,
      webpInputDuration: backInfo.duration,
      alphaPreserved: true,
    }),
  );
} finally {
  for (const jobId of [
    "trim",
    "sequence",
    "animation",
    "webp-back",
    "alpha-sequence",
    "alpha-output",
  ])
    await handlers.finishMediaJob(null, jobId);
  fs.rmSync(directory, { recursive: true, force: true });
}
