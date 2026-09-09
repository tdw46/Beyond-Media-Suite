import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function targetVideoBitrateKbps(targetKb, durationSeconds, hasAudio = false) {
  const targetBytes = Math.max(10_000, Math.floor(targetKb * 1_000));
  const reserve = Math.max(4_096, Math.floor(targetBytes * 0.02));
  const audioBytes = hasAudio ? (64_000 * durationSeconds) / 8 : 0;
  return Math.max(
    8,
    Math.floor(
      ((targetBytes - reserve - audioBytes) * 8) / durationSeconds / 1_000,
    ),
  );
}

function nextScale(width, targetBytes, measuredBytes) {
  const ratio = Math.min(0.92, Math.sqrt(targetBytes / measuredBytes) * 0.96);
  return Math.max(20, Math.floor(width * ratio));
}

function optimizedStem(name = "") {
  const stem = String(name);
  return stem.endsWith("_opt") ? stem : `${stem}_opt`;
}

function sourceRatioTargetKb(bytes, ratio) {
  return Math.max(10, Math.floor((bytes * ratio) / 100 / 1_000));
}

test("500 KB over 17.59 seconds leaves room for container overhead", () => {
  assert.equal(targetVideoBitrateKbps(500, 17.59), 222);
  assert.equal(targetVideoBitrateKbps(500, 17.59, true), 158);
});

test("oversize image scales down proportionally and never below 20 px", () => {
  assert.equal(nextScale(800, 500_000, 2_000_000), 384);
  assert.equal(nextScale(20, 1, 10_000_000), 20);
});

test("target-size video support covers every xPic output container", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-target-size.patch", import.meta.url),
      "utf8",
    ),
  );
  for (const format of [
    "mp4",
    "mkv",
    "avi",
    "mov",
    "webm",
    "flv",
    "ts",
    "wmv",
  ]) {
    assert.match(patch, new RegExp(`\\+?\\s*${format}: \\{`));
  }
  assert.match(patch, /encodeTargetVideo/);
});

test("Merge Frames exposes WebM with a per-format target size", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-target-size.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /\+\s*\{ label: "WebM", value: "webm" \},/);
  assert.match(patch, /targetSizeFor\(config, config\.ext \|\| "webp"\)/);
  assert.match(patch, /ext === "webm" \|\| targetKb > 0/);
  assert.match(patch, /inputPath: bridgePath/);
});

test("To Animation exposes target-sized WebM with FPS and scaling", async () => {
  const [patch, buildScript] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL("../patches/xpic-2.1.3-target-size.patch", import.meta.url),
        "utf8",
      ),
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../scripts/build-fork.mjs", import.meta.url), "utf8"),
    ),
  ]);
  assert.ok(
    patch.match(/\+\s*\{ label: "WebM", value: "webm" \},/g)?.length >= 2,
  );
  assert.match(patch, /filters\.push\(`fps=\$\{requestedFps\}`\)/);
  assert.match(
    patch,
    /filters\.push\(`scale=\$\{requestedScale\}:-2:flags=lanczos`\)/,
  );
  assert.match(buildScript, /index-fork-\$\{rendererHash\}\.js/);
});

test("large Merge Frames jobs avoid eager full-image buffers", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-target-size.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.doesNotMatch(patch, /^\+.*response\.clone\(\)\.arrayBuffer\(\)/m);
  assert.match(patch, /^-.*response\.clone\(\)\.arrayBuffer\(\)/m);
  assert.match(patch, /streamFileResponse/);
  assert.match(patch, /mapWithConcurrency\(list, 6/);
  assert.match(patch, /loading: "lazy"/);
  assert.match(patch, /mergeFramesIntermediate/);
  assert.match(patch, /"-c:v",\s*\n\+\s*"ffv1"/);
});

test("media batches are cancellable and clean up their process trees", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-cancellable-media.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /cancelMediaJob/);
  assert.match(patch, /process\.kill\(-child\.pid, signal\)/);
  assert.match(patch, /terminateMediaProcess\(child, "SIGKILL"\)/);
  assert.match(patch, /window\.x\("cancelMediaJob", `flow-\$\{runId\}`\)/);
  assert.match(patch, /finishMediaJob/);
  assert.match(patch, /execMedia/);
});

test("MOV to MP4 keeps two-pass timing stable and distinguishes crashes from cancellation", async () => {
  const [patch, build] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL(
          "../patches/xpic-2.1.3-mov-mp4-frame-rate.patch",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../scripts/build-fork.mjs", import.meta.url), "utf8"),
    ),
  ]);
  assert.ok((patch.match(/fpsMode: "vfr"/g) || []).length >= 5);
  assert.match(patch, /fpsMode: "cfr"/);
  assert.match(
    patch,
    /\.\.\.\(profile\.fpsMode \? \["-fps_mode", profile\.fpsMode\] : \[\]\)/,
  );
  assert.match(patch, /cancelledMediaProcesses\.add\(child\)/);
  assert.match(patch, /const cancelled = cancelledMediaProcesses\.has\(child\)/);
  assert.match(patch, /terminated unexpectedly \(\$\{signal\}\)/);
  assert.match(
    patch,
    /finishMediaJob:[\s\S]{0,220}mediaJobs\.get\(id2\)\?\.size[\s\S]{0,120}cleanupMediaTemps/,
  );
  assert.match(build, /xpic-2\.1\.3-mov-mp4-frame-rate\.patch/);
  assert.match(build, /movMp4FrameRatePatchPath/);
});

test("iPhone MOV inspection and conversion skip undecodable auxiliary audio streams", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../patches/xpic-2.1.3-beyond-media-suite.patch",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(patch, /const findUsableAudioStream = \(stderr\) =>/);
  assert.match(patch, /codec !== "none" && codec !== "unknown"/);
  assert.match(patch, /audioStream = findUsableAudioStream\(stderr\)/);
  assert.match(patch, /hasAudio: Boolean\(audioStream\)/);
  assert.match(patch, /"-frames:v",\s*\n\+\s*"1"/);
  assert.match(patch, /media\.audioStream/);
});

test("target-sized WebP starts at a frame-count-aware scale", async () => {
  const targetBytes = 750_000;
  const frames = 336;
  const aspect = 16 / 9;
  const width = Math.floor(Math.sqrt((targetBytes / frames / 0.004) * aspect));
  assert.equal(width, 996);

  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-cancellable-media.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /estimatedFrames/);
  assert.match(patch, /targetBytes \/ estimatedFrames \/ 0\.004/);
  assert.match(patch, /Math\.min\(maxScale, targetAwareWidth \|\| maxScale\)/);
});

test("Merge Frames previews use bounded thumbnails", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-cancellable-media.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /THUMBNAIL_DOMAIN/);
  assert.match(patch, /resize\(256, 256/);
  assert.match(patch, /thumbnailActive < 4/);
  assert.match(patch, /thumbnailCache\.size > 1024/);
  assert.match(patch, /src: f2\.poster \|\| f2\.thumb \|\| f2\.url/);
});

test("every creation panel exposes one aspect-preserving longest-edge control", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../patches/xpic-2.1.3-longest-edge-webm-speed.patch",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(patch, /"flow\.longestEdge": "Longest edge \(px\)"/);
  assert.match(patch, /value: longestEdgeFor\(config\)/);
  assert.match(patch, /fit: "inside", withoutEnlargement: false/);
  assert.match(patch, /longestEdge: longestEdgeFor\(config\)/);
  assert.match(patch, /const finalResize = longestEdgeResize\(config\)/);
  assert.doesNotMatch(patch, /^\+.*label: t2\("flow\.scale"\)/m);
});

test("Merge Frames prepares exact-count CFR alpha frames before VP9 encoding", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../patches/xpic-2.1.3-longest-edge-webm-speed.patch",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(patch, /pixelFormat: ext === "webm" \? "yuva420p" : "bgra"/);
  assert.match(patch, /"-frames:v"/);
  assert.match(patch, /String\(files\.length\)/);
  assert.match(patch, /pixelFormat === "yuva420p" \? "yuva420p" : "bgra"/);
  assert.match(patch, /preparedInput: true/);
});

test("WebM remains VP9-alpha and uses bounded parallel encoding", async () => {
  const patch = await import("node:fs/promises").then(
    async ({ readFile }) =>
      `${await readFile(
        new URL("../patches/xpic-2.1.3-target-size.patch", import.meta.url),
        "utf8",
      )}\n${await readFile(
        new URL(
          "../patches/xpic-2.1.3-longest-edge-webm-speed.patch",
          import.meta.url,
        ),
        "utf8",
      )}`,
  );
  assert.match(patch, /pixelFormat: "yuva420p"/);
  assert.match(patch, /"alpha_mode=1"/);
  assert.match(patch, /"-auto-alt-ref",\s*\n\+\s*"0"/);
  assert.match(patch, /os\.cpus\(\)\?\.length/);
  assert.match(patch, /"-tile-columns"/);
  assert.match(patch, /"-cluster_time_limit"/);
});

test("every creation tab exposes a working target-size control", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../patches/xpic-2.1.3-all-creation-target-size.patch",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(
    patch.match(/^\+\s*label: t2\("flow\.targetSize"\),$/gm)?.length,
    3,
  );
  assert.match(patch, /const sourceTargetSizeFor = \(config\)/);
  assert.match(patch, /Object\.hasOwn\(config\.targetFileSizes/);
  assert.match(patch, /outFormat: fmt,\s*\n\+\s*targetKb,/);
  assert.match(patch, /\{ toFormat: fmt, targetFileSizeKb: targetKb \}/);
  assert.match(patch, /targetKb > 0 && mode !== "filesize"/);
});

test("default outputs are source-adjacent and use a stable _opt suffix", async () => {
  assert.equal(optimizedStem("avatar"), "avatar_opt");
  assert.equal(optimizedStem("avatar_opt"), "avatar_opt");

  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../patches/xpic-2.1.3-source-adjacent-opt-output.patch",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(patch, /^\+\s*defaultOutputDir: "",$/m);
  assert.match(patch, /configured && configured !== "x_output"/);
  assert.match(patch, /const pureName = optimizedStem\(/);
  assert.match(patch, /optimizedStem\(fileStem\(files\[0\]\?\.name/);
  assert.match(patch, /defaultTaskOutputDir\(files, globalConfig\)/);
  assert.match(
    patch,
    /defaultTaskOutputDir\(\[\{ dir: baseDir \}\], globalConfig\)/,
  );
  assert.match(patch, /savedOutputDir === "x_output" \? "" : savedOutputDir/);
  assert.match(patch, /placeholder: t2\("flow\.outDirDefault"\)/);
});

test("workflow optimizes only its final output name", async () => {
  const patch = await import("node:fs/promises").then(
    async ({ readFile }) =>
      `${await readFile(
        new URL(
          "../patches/xpic-2.1.3-all-creation-target-size.patch",
          import.meta.url,
        ),
        "utf8",
      )}\n${await readFile(
        new URL(
          "../patches/xpic-2.1.3-source-adjacent-opt-output.patch",
          import.meta.url,
        ),
        "utf8",
      )}`,
  );
  assert.match(patch, /optimizeOutputName = false/g);
  assert.ok((patch.match(/^\+\s*isLastStep,$/gm) || []).length >= 4);
  assert.match(patch, /\? optimizedStem\(sourcePureName\)/);
});

test("source overwrite is explicit, same-format-only, and rollback-safe", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../patches/xpic-2.1.3-overwrite-source-webm-alpha.patch",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(patch, /"flow\.overwriteSource": "Overwrite source media"/);
  assert.match(patch, /config && mod2\.processFile/);
  assert.match(patch, /canOverwriteSourceItem/);
  assert.match(patch, /normalizedMediaFormat\(outputFormatFor/);
  assert.match(
    patch,
    /await window\.x\("replaceFile", r2\.outPath, f2\.path\)/,
  );
  assert.match(patch, /\.xpic-backup-/);
  assert.match(patch, /await fs\.promises\.rename\(backup, dest\)/);
});

test("Video Compress keeps WebM on the VP9 alpha path", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL(
        "../patches/xpic-2.1.3-overwrite-source-webm-alpha.patch",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.match(patch, /^\+\s*toFormat: fmt,$/m);
  assert.match(patch, /\["-c:v", "libvpx-vp9"\]/);
  assert.equal(patch.match(/^\+\s*\.\.\.inputDecodeArgs,$/gm)?.length, 2);
  assert.doesNotMatch(patch, /^\+.*targetKb > 0 \? \{ toFormat: fmt,/m);
});

test("Video navigation exposes a mixed-media Collage creation flow", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /"nav\.collage": "Collage"/);
  assert.match(
    patch,
    /\{ key: "collage", labelKey: "nav\.collage", Icon: Layers \}/,
  );
  assert.match(
    patch,
    /accept: \[\.\.\.new Set\(\[\.\.\.convertReadAccept, \.\.\.vReadAccept\]\)\]/,
  );
  assert.match(patch, /validation: \{ maxFiles: 4, minFiles: 2/);
  assert.match(patch, /const collageSlice = createConfigSlice/);
  assert.match(patch, /collage: collageSlice\.reducer/);
});

test("Collage packs every requested layout without distorting source aspect ratios", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  for (const layout of [
    "row",
    "column",
    "grid",
    "top-pair",
    "bottom-pair",
    "left-pair",
    "right-pair",
  ]) {
    assert.match(patch, new RegExp(`value: "${layout}"`));
  }
  assert.match(patch, /const collagePackedLayout = \(files, layout\)/);
  assert.match(patch, /const packRows = \(groups\)/);
  assert.match(patch, /const packColumns = \(groups\)/);
  assert.match(patch, /const rowHeight =\s*\n\+\s*1 \/ group\.reduce/);
  assert.match(patch, /const columnWidth =/);
  assert.match(patch, /const sourceWidth = Math\.max/);
  assert.match(patch, /const sourceHeight = Math\.max/);
  assert.match(
    patch,
    /baseWidth \/ croppedSourceWidth/,
  );
  assert.match(
    patch,
    /baseWidth \/ croppedSourceWidth/,
  );
  assert.match(patch, /croppedSourceWidth \* fitScale \* userScale/);
  assert.match(patch, /croppedSourceHeight \* fitScale \* userScale/);
  assert.match(patch, /objectFit: "fill"/);
});

test("Collage supports exact target dimensions with minimum-crop fill and opt-in letterboxing", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /targetWidth: 0/);
  assert.match(patch, /targetHeight: 0/);
  assert.match(patch, /fitMode: "fill"/);
  assert.match(patch, /"flow\.collageTargetWidth": "Target width \(px\)"/);
  assert.match(patch, /"flow\.collageTargetHeight": "Target height \(px\)"/);
  assert.match(patch, /value: config\.targetWidth \|\| 0/);
  assert.match(patch, /value: config\.targetHeight \|\| 0/);
  assert.match(patch, /requestedWidth \/ requestedHeight/);
  assert.match(patch, /requestedWidth \|\|/);
  assert.match(patch, /requestedHeight \|\|/);
  assert.match(patch, /value: "letterbox"/);
  assert.match(
    patch,
    /const fill = !config\.autoPadding && config\.fitMode !== "letterbox"/,
  );
  assert.match(patch, /fill \? 1 : 0\.25/);
  assert.match(patch, /value: "letterbox"/);
});

test("Collage preview starts paused and exposes synchronized playback and item transforms", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /useState\(false\)/);
  assert.match(patch, /video\.play\(\)\.catch/);
  assert.match(patch, /video\.pause\(\)/);
  assert.match(patch, /video\.currentTime = 0/);
  assert.match(patch, /purpose: "collage-preview"/);
  assert.match(patch, /maxEdge: 2560/);
  assert.match(patch, /highResolution \? "libwebp" : "mjpeg"/);
  assert.match(patch, /"-lossless", "1"/);
  assert.match(patch, /useVp9AlphaDecoder/);
  assert.match(patch, /decoder: meta\?\.format/);
  assert.match(patch, /preload: "auto"/);
  assert.match(patch, /layer: item\.layer/);
  assert.match(patch, /offsetX: value/);
  assert.match(patch, /offsetY: value/);
  assert.match(patch, /scale: value/);
  assert.doesNotMatch(patch, /^\+.*const clampFillShift =/m);
  assert.match(patch, /const shiftX = \(offsetX \/ 100\) \* width/);
  assert.match(patch, /const shiftY = \(offsetY \/ 100\) \* height/);
  assert.match(patch, /Math\.min\(125, Number\(item\.offsetX\)/);
  assert.match(patch, /Math\.min\(125, Number\(item\.offsetY\)/);
  assert.match(patch, /"flow\.collageOffsetX": "Canvas left \/ right offset"/);
  assert.match(patch, /"flow\.collageOffsetY": "Canvas up \/ down offset"/);
  assert.match(patch, /mediaX: centeredX \+ Math\.round\(shiftX\)/);
  assert.match(patch, /mediaY: centeredY \+ Math\.round\(shiftY\)/);
  assert.match(
    patch,
    /left: `\$\{\(rect\.mediaX \/ geometry\.width\) \* 100\}%`/,
  );
  assert.match(patch, /"flow\.collageScale": "Scale"/);
  assert.match(
    patch,
    /Math\.min\(3, \(Number\(item\.scale\) \|\| 100\) \/ 100\)/,
  );
  assert.match(patch, /sort\(/);
  assert.match(patch, /overlay=x=\$\{x\}:y=\$\{y\}/);
  assert.match(patch, /renderPanelTop/);
  assert.match(patch, /mod2\.renderPanelTop\(\{/);
  assert.match(patch, /children: t2\("flow\.collageLayers"\)/);
});

test("Collage layer ordering and populated-canvas media controls remain interactive", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /const backToFront = \[\.\.\.files\]\.sort/);
  assert.match(patch, /const setLayerPosition =/);
  assert.match(patch, /const moveLayer =/);
  assert.match(patch, /const frontToBack = \[\.\.\.backToFront\]\.reverse\(\)/);
  assert.match(patch, /"flow\.collageBringForward": "Bring forward"/);
  assert.match(patch, /"flow\.collageSendBackward": "Send backward"/);
  assert.match(patch, /onClick: \(\) => moveLayer\(item\.id, 1\)/);
  assert.match(patch, /onClick: \(\) => moveLayer\(item\.id, -1\)/);
  assert.match(patch, /onClick: \(\) => onPick\(true\)/);
  assert.match(patch, /onClick: \(\) => handlers2\.removeFile\(item\.id\)/);
  assert.match(
    patch,
    /renderPanelTop: \(\{ config, session, t: t2, handlers: handlers2, onPick \}\)/,
  );
  assert.match(patch, /onPick,\s*\n\+\s*\}\)/);
});

test("GIF target size is a hard ceiling with palette, frame-rate, and dimension search", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /const minScale = toFormat === "gif" \? 8 : 20/);
  assert.match(patch, /let currentFps = Math\.max/);
  assert.match(patch, /targetFilters\.push\(`fps=\$\{currentFps\}`\)/);
  assert.match(
    patch,
    /let low = toFormat === "gif" && allowGifColorReduction \? 3 : 1/,
  );
  assert.match(patch, /const balanced = Math\.cbrt\(ratio\) \* 0\.98/);
  assert.match(patch, /currentFps = nextFps/);
  assert.match(patch, /Smallest candidate was/);
  assert.doesNotMatch(patch, /^\+.*moveInto\(fallbackPath\)/m);
});

test("GIF color reduction is opt-in and measured buffers are written without re-encoding", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.ok((patch.match(/gifColorReduction: false/g) || []).length >= 7);
  assert.match(patch, /"flow\.gifColorReduction": "Reduce GIF colors"/);
  assert.match(patch, /const GifColorReductionSwitch =/);
  assert.ok((patch.match(/GifColorReductionSwitch/g) || []).length >= 7);
  assert.match(patch, /allowGifColorReduction = false/);
  assert.match(
    patch,
    /toFormat === "gif" && !allowGifColorReduction[\s\S]{0,120}\? 1/,
  );
  assert.match(
    patch,
    /toFormat === "gif" && !allowGifColorReduction[\s\S]{0,100}\? 256/,
  );
  assert.match(patch, /colors: allowGifColorReduction \? tuning : 256/);
  assert.match(patch, /writeBufferToFile: \(_, buffer, outPath\) =>/);
  assert.match(patch, /window\.x\("writeBufferToFile", buffer, destination\)/);
  assert.doesNotMatch(patch, /^\+.*return await writeBufferOut\(lastSmallest/m);
});

test("completed jobs can return to editing without discarding inputs or settings", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /resumeEditing: \(state\) =>/);
  assert.match(
    patch,
    /state\.stage = state\.files\.length \? "staging" : "empty"/,
  );
  assert.match(patch, /store\.dispatch\(resumeEditing\(\)\)/);
  assert.match(patch, /^\+\s+edit,\n\s+reset,/m);
  assert.match(patch, /"flow\.backToEdit": "Back to edit"/);
  assert.match(patch, /"flow\.backToEditPanel": "Back to edit and re-export"/);
  assert.match(patch, /onClick: handlers2\.edit/);
  assert.match(patch, /onClick: handlers2\.reset/);
  assert.match(patch, /state\.files = state\.files\.map/);
});

test("Collage outputs stills, animations, and every xPic video container with universal sizing", async () => {
  const [patch, build] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
        "utf8",
      ),
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../scripts/build-fork.mjs", import.meta.url), "utf8"),
    ),
  ]);
  for (const format of [
    "png",
    "jpeg",
    "webp-still",
    "avif",
    "tiff",
    "gif",
    "webp",
    "apng",
  ]) {
    assert.match(patch, new RegExp(`value: "${format}"`));
  }
  assert.match(patch, /\.\.\.vWriteOptions/);
  assert.match(patch, /targetSizeFor\(config, config\.toFormat\)/);
  assert.match(patch, /longestEdgeFor\(config\) \|\| sourceLongest/);
  assert.match(patch, /writeSharpToTarget/);
  assert.match(patch, /window\.x\("vConvert"/);
  assert.match(patch, /"-pix_fmt",\s*\n\+\s*"bgra"/);
  assert.match(build, /xpic-2\.1\.3-collage\.patch/);
  assert.match(build, /2\.1\.3-fork\.29/);
  assert.match(build, /2\.1\.3\.29/);
});

test("Beyond Media Suite exposes local millisecond-precise YouTube clip creation", async () => {
  const [patch, build] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL(
          "../patches/xpic-2.1.3-beyond-media-suite.patch",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../scripts/build-fork.mjs", import.meta.url), "utf8"),
    ),
  ]);
  assert.match(patch, /Beyond Media Suite/);
  assert.match(patch, /youtubeInspect/);
  assert.match(patch, /youtubeDownloadClip/);
  assert.match(patch, /youtubeFrameBuffer/);
  assert.match(patch, /parseYouTubeTime/);
  assert.match(patch, /startTime: "00:00:00\.000"/);
  assert.match(patch, /endTime: "00:00:05\.000"/);
  assert.match(patch, /type: "range"/);
  assert.match(patch, /youtube\.startBeginning/);
  assert.match(patch, /youtube\.endFull/);
  assert.match(patch, /youtube\.fullVideo/);
  assert.match(patch, /loadYouTubeIframeApi/);
  assert.match(patch, /new YT\.Player/);
  assert.match(patch, /disable-gpu-compositing/);
  assert.match(patch, /autoplay: 1/);
  assert.match(patch, /mute: 1/);
  assert.match(patch, /event\.target\.mute\(\)/);
  assert.match(patch, /event\.target\.playVideo\(\)/);
  assert.match(patch, /event\.target\.seekTo\(range\.startMs \/ 1e3, true\);/);
  assert.match(patch, /previewMuted/);
  assert.match(patch, /beginTimelineScrub/);
  assert.match(patch, /youtubePlayerRef\.current\?\.seekTo/);
  assert.match(patch, /player\.getPlayerState\?\.\(\) !== 1/);
  assert.match(patch, /player\.playVideo\(\)/);
  assert.match(patch, /onBeforeSendHeaders/);
  assert.match(patch, /requestHeaders\.Referer/);
  assert.match(patch, /github\.com\/tdw46\/Beyond-Media-Suite/);
  assert.match(patch, /widget_referrer/);
  assert.match(patch, /youtubeStartMsFromUrl/);
  assert.match(patch, /new URLSearchParams\(parsed\.hash/);
  assert.match(patch, /autoInspectUrlRef/);
  assert.match(patch, /void inspect\(url\)/);
  assert.match(patch, /startTime: formatYouTubeTime\(startMs\)/);
  assert.match(patch, /if \(startMs >= endMs\)/);
  assert.match(patch, /endMs = Math\.min\(videoDurationMs, startMs \+ pushLength\)/);
  assert.match(patch, /clipLengthMs: 5000/);
  assert.match(patch, /applyClipLength/);
  assert.match(patch, /Math\.round\(\(event\.clientX - drag\.originX\) \/ 2\)/);
  assert.match(patch, /targetSizeFor\(config, format\)/);
  assert.match(patch, /includeAudio: config\.includeAudio !== false/);
  assert.match(patch, /includeAudio && media\.hasAudio/);
  assert.match(patch, /youtube\.includeAudio/);
  assert.match(patch, /preparedInput: true/);
  assert.match(patch, /\.\.\.vWriteOptions/);
  assert.match(build, /yt-dlp\/releases\/download/);
  assert.match(build, /ytDlpSha256/);
  assert.match(build, /Beyond Media Suite\.app/);
});

test("Collage gradients and top-layer text render consistently with system fonts and shadows", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /backgroundMode: "transparent"/);
  assert.match(patch, /colors: \["#FE2C2B", "#FF9B60"\]/);
  assert.match(patch, /colors: \["#E50FC8", "#542AC6"\]/);
  assert.match(patch, /const COLLAGE_GRADIENT_PRESETS =/);
  assert.match(patch, /const ColorField =/);
  assert.match(patch, /const SystemFontField =/);
  assert.match(patch, /getSystemFontFamilies/);
  assert.match(patch, /SPFontsDataType/);
  assert.match(patch, /textMatchBackground: false/);
  assert.match(patch, /textFontFamily: "Helvetica Neue"/);
  assert.match(patch, /textScale: 100/);
  assert.match(patch, /textOffsetX: 0/);
  assert.match(patch, /textOffsetY: 0/);
  assert.match(patch, /textShadow: false/);
  assert.match(patch, /children: t2\("flow\.collageTextLayer"\)/);
  assert.match(patch, /const collageBackgroundSvg =/);
  assert.match(patch, /const collageTextSvg =/);
  assert.match(patch, /feGaussianBlur/);
  assert.match(patch, /backgroundPath,/);
  assert.match(patch, /textPath,/);
  assert.match(patch, /\[\$\{previous\}\]\[textoverlay\]overlay/);
  assert.match(patch, /overlayPreview\.text \|\|/);
  assert.match(patch, /window\.x\("sharpToBuffer"/);
});

test("Collage preview and export share SVG overlays and expose patterns", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /const collagePatternOptions =/);
  for (const pattern of ["dots", "hex", "stripes", "checker", "grid", "waves"]) {
    assert.match(patch, new RegExp(`value: "${pattern}"`));
  }
  assert.match(patch, /backgroundPattern: "none"/);
  assert.match(patch, /textPattern: "none"/);
  assert.match(patch, /fill="url\(#backgroundPattern\)"/);
  assert.match(patch, /clip-path="url\(#textClip\)"/);
  assert.match(patch, /overlayPreview\.text \|\|/);
  assert.match(patch, /overlayPreview\.background \|\|/);
  assert.match(patch, /new Blob\(\[buffer\], \{ type: "image\/png" \}\)/);
});

test("Collage edge crops and optional equal padding use one preview/export geometry", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  for (const edge of ["Left", "Right", "Top", "Bottom"]) {
    assert.match(patch, new RegExp(`crop${edge}: 0`));
    assert.match(patch, new RegExp(`flow\\.collageCrop${edge}`));
  }
  assert.match(patch, /const collageCropFractions =/);
  assert.match(patch, /crop=iw\*\$\{cropWidth\.toFixed\(6\)\}/);
  assert.match(patch, /left: `\$\{\(-rect\.crop\.left \/ cropWidth\) \* 100\}%`/);
  assert.match(patch, /autoPadding: false/);
  assert.match(patch, /tilePadding: 16/);
  assert.match(patch, /const requestedPadding = config\.autoPadding/);
  assert.match(patch, /label: t2\("flow\.collageAutoPadding"\)/);
  assert.match(patch, /label: t2\("flow\.collageTilePadding"\)/);
});

test("Add overlay creates independent layers without repacking collage tiles", async () => {
  const [patch, build] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL(
          "../patches/xpic-2.1.3-collage-overlay.patch",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../scripts/build-fork.mjs", import.meta.url), "utf8"),
    ),
  ]);
  assert.match(patch, /"flow\.collageAddOverlay": "Add overlay"/);
  assert.match(patch, /onPick\(\{ append: true, overlay: true \}\)/);
  assert.match(patch, /const pickOptionsRef =/);
  assert.match(patch, /overlay: !!options\.overlay/);
  assert.match(patch, /layoutRole: ctx\.overlay \? "overlay" : "tile"/);
  assert.match(patch, /scale: ctx\.overlay \? 50 : 100/);
  assert.match(
    patch,
    /const tileFiles = files\.filter\(\(item\) => item\.layoutRole !== "overlay"\)/,
  );
  assert.match(patch, /collagePackedLayout\(tileFiles, layout\)/);
  assert.match(patch, /\.\.\.tileFiles\.map\(\(item\) =>/);
  assert.match(
    patch,
    /isOverlay\s*\n\+\s*\? \{ x: 0, y: 0, width: 1, height: 1 \}/,
  );
  assert.match(patch, /validation: \{ maxFiles: 8, minFiles: 2/);
  assert.match(build, /xpic-2\.1\.3-collage-overlay\.patch/);
  assert.match(build, /collageOverlayPatchPath/);
});

test("All collage media and text layers scale down to one percent", async () => {
  const [patch, build] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) =>
      readFile(
        new URL(
          "../patches/xpic-2.1.3-collage-tiny-scale.patch",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
    import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("../scripts/build-fork.mjs", import.meta.url), "utf8"),
    ),
  ]);
  assert.match(patch, /const scale = Math\.max\(1,/);
  assert.match(patch, /const fontSize = Math\.max\(0\.5,/);
  assert.match(patch, /const userScale = Math\.max\([\s\S]{0,80}\+\s+0\.01,/);
  assert.match(patch, /Math\.max\(1, Number\(item\.scale\) \|\| 100\)/);
  assert.match(patch, /Math\.max\(1, Number\(config\.textScale\) \|\| 100\)/);
  assert.match(patch, /step = suffix === "%" \? 5 : 1/);
  assert.match(patch, /\(value\) => patchItem\(item\.id, \{ scale: value \}\),[\s\S]{0,80}"%",\s*\+\s*1/);
  assert.match(build, /xpic-2\.1\.3-collage-tiny-scale\.patch/);
  assert.match(build, /collageTinyScalePatchPath/);
});

test("Collage keeps all text and gradient settings with the layer tiles", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(
    patch,
    /"flow\.collageBackgroundLayer": "Background · bottom layer"/,
  );
  assert.match(patch, /"flow\.collageTextLayer": "Text · top layer"/);
  assert.match(
    patch,
    /const update = \(patch2\) => store\.dispatch\(updateCollageConfig\(patch2\)\)/,
  );
  assert.equal(
    (patch.match(/label: t2\("flow\.collageBackground"\)/g) || []).length,
    1,
  );
  assert.equal(
    (patch.match(/label: t2\("flow\.collageText"\)/g) || []).length,
    1,
  );
  assert.match(
    patch,
    /children: t2\("flow\.collageBackgroundLayer"\)[\s\S]{0,2400}COLLAGE_GRADIENT_PRESETS/,
  );
});

test("Text gradients expose the shared aesthetic presets and retain custom stops", async () => {
  const patch = await import("node:fs/promises").then(({ readFile }) =>
    readFile(
      new URL("../patches/xpic-2.1.3-collage.patch", import.meta.url),
      "utf8",
    ),
  );
  assert.match(patch, /textGradientPreset: "custom"/);
  assert.match(
    patch,
    /"flow\.collageTextGradientPreset": "Text gradient preset"/,
  );
  assert.match(
    patch,
    /value:\s*\n\+\s*config\.textGradientPreset \|\|\s*\n\+\s*"custom"/,
  );
  assert.match(patch, /textColorA:\s*\n\+\s*preset\.colors\[0\]/);
  assert.match(patch, /textColorB:\s*\n\+\s*preset\.colors\[1\]/);
  assert.ok((patch.match(/textGradientPreset: "custom"/g) || []).length >= 3);
});

test("Native Finder Quick Actions expose conversion and ratio-based compression", async () => {
  assert.equal(sourceRatioTargetKb(60_000_000, 25), 15_000);
  const [helper, build, convertInfo, convertWorkflow, compressInfo, compressWorkflow] =
    await Promise.all([
      readFile(
        new URL("../finder-helper/BeyondFinderMedia.swift", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../scripts/build-fork.mjs", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../finder-services/Convert with Beyond Media Suite.workflow/Contents/Info.plist",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../finder-services/Convert with Beyond Media Suite.workflow/Contents/Resources/document.wflow",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../finder-services/Compress with Beyond Media Suite.workflow/Contents/Info.plist",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../finder-services/Compress with Beyond Media Suite.workflow/Contents/Resources/document.wflow",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
  assert.match(helper, /NSSlider\(value: 25, minValue: 5, maxValue: 95/);
  assert.match(helper, /sourceBytes \* Int64\(ratio\) \/ 100/);
  assert.match(helper, /case "mp4", "mov":/);
  assert.match(helper, /formatPopup\.selectItem\(withTitle: "MP4"\)/);
  assert.match(helper, /mode == \.compress/);
  assert.match(helper, /\["-c:v", "libvpx-vp9"\]/);
  assert.match(helper, /NSVisualEffectView/);
  assert.match(helper, /width: 500, height: 292/);
  assert.match(helper, /ratioSlider\.numberOfTickMarks = 0/);
  assert.match(helper, /process\.standardInput = FileHandle\.nullDevice/);
  assert.match(helper, /activateFileViewerSelecting/);
  assert.match(helper, /resources\.lastPathComponent != "Resources"/);
  assert.match(build, /BeyondFinderMedia\.swift/);
  assert.match(build, /BeyondFinderMedia\.app/);
  assert.match(build, /"swiftc"/);
  assert.match(build, /"-parse-as-library"/);
  assert.match(build, /finder-services/);
  for (const info of [convertInfo, compressInfo]) {
    assert.match(info, /<string>public\.movie<\/string>/);
    assert.match(info, /com\.apple\.finder/);
  }
  assert.match(convertWorkflow, /BeyondFinderMedia/);
  assert.match(compressWorkflow, /BeyondFinderMedia/);
  assert.match(convertWorkflow, /"\$helper" convert "\$@"/);
  assert.match(compressWorkflow, /"\$helper" compress "\$@"/);
  assert.doesNotMatch(convertWorkflow, /Contents\/MacOS\/xPic/);
  assert.doesNotMatch(compressWorkflow, /Contents\/MacOS\/xPic/);
  assert.match(convertWorkflow, /<key>inputMethod<\/key><integer>1<\/integer>/);
  assert.match(compressWorkflow, /<key>inputMethod<\/key><integer>1<\/integer>/);
});
