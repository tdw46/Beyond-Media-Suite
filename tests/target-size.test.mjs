import assert from "node:assert/strict";
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
