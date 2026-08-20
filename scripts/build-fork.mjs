import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as asar from "@electron/asar";
import prettier from "prettier";

const repoRoot = path.resolve(import.meta.dirname, "..");
const baseApp = path.resolve(process.argv[2] || "/Applications/xPic.app");
const outputApp = path.resolve(
  process.argv[3] || path.join(repoRoot, "dist", "Beyond Media Suite.app"),
);
const ytDlpVersion = "2026.08.19";
const ytDlpUrl = `https://github.com/yt-dlp/yt-dlp/releases/download/${ytDlpVersion}/yt-dlp_macos`;
const ytDlpSha256 =
  "0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202";
const ytDlpCache = path.join(repoRoot, ".cache", "yt-dlp", "yt-dlp_macos");
const sourceAsar = path.join(baseApp, "Contents", "Resources", "app.asar");
const patchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-target-size.patch",
);
const cancellationPatchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-cancellable-media.patch",
);
const longestEdgePatchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-longest-edge-webm-speed.patch",
);
const allCreationTargetSizePatchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-all-creation-target-size.patch",
);
const sourceAdjacentOutputPatchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-source-adjacent-opt-output.patch",
);
const overwriteSourceWebmAlphaPatchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-overwrite-source-webm-alpha.patch",
);
const collagePatchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-collage.patch",
);
const collageOverlayPatchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-collage-overlay.patch",
);
const collageTinyScalePatchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-collage-tiny-scale.patch",
);
const movMp4FrameRatePatchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-mov-mp4-frame-rate.patch",
);
const beyondMediaSuitePatchPath = path.join(
  repoRoot,
  "patches",
  "xpic-2.1.3-beyond-media-suite.patch",
);
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xpic-fork-build-"));
const extracted = path.join(tempRoot, "app");
const packedAsar = path.join(tempRoot, "app.asar");

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

async function formatBundle(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  const formatted = await prettier.format(source, {
    parser: "babel",
    trailingComma: "all",
  });
  await fs.writeFile(filePath, formatted);
}

async function ensureYtDlp() {
  await fs.mkdir(path.dirname(ytDlpCache), { recursive: true });
  try {
    const bytes = await fs.readFile(ytDlpCache);
    if (createHash("sha256").update(bytes).digest("hex") === ytDlpSha256) {
      return ytDlpCache;
    }
  } catch {}
  const response = await fetch(ytDlpUrl);
  if (!response.ok) {
    throw new Error(
      `Unable to download yt-dlp ${ytDlpVersion}: ${response.status}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== ytDlpSha256) {
    throw new Error(`yt-dlp checksum mismatch: ${hash}`);
  }
  await fs.writeFile(ytDlpCache, bytes, { mode: 0o755 });
  return ytDlpCache;
}

try {
  const info = await fs.stat(sourceAsar);
  if (!info.isFile())
    throw new Error(`Missing base app archive: ${sourceAsar}`);

  asar.extractAll(sourceAsar, extracted);
  const packagedJsonPath = path.join(extracted, "package.json");
  const packagedJson = JSON.parse(await fs.readFile(packagedJsonPath, "utf8"));
  if (packagedJson.version !== "2.1.3") {
    throw new Error(
      `Patch expects xPic 2.1.3, received ${packagedJson.version || "unknown"}.`,
    );
  }

  const mainBundle = path.join(extracted, "out", "main", "index.js");
  const rendererAssets = path.join(extracted, "out", "renderer", "assets");
  const rendererBundle = (await fs.readdir(rendererAssets))
    .filter((name) => /^index-.*\.js$/.test(name))
    .map((name) => path.join(rendererAssets, name))[0];
  if (!rendererBundle) throw new Error("Renderer bundle was not found.");

  await Promise.all([
    formatBundle(mainBundle),
    formatBundle(rendererBundle),
    formatBundle(path.join(extracted, "out", "preload", "index.js")),
  ]);
  run("patch", ["-p1", "-d", extracted, "-i", patchPath]);
  await Promise.all([formatBundle(mainBundle), formatBundle(rendererBundle)]);
  run("patch", ["-p1", "-d", extracted, "-i", cancellationPatchPath]);
  await Promise.all([formatBundle(mainBundle), formatBundle(rendererBundle)]);
  run("patch", ["-p1", "-d", extracted, "-i", longestEdgePatchPath]);
  run("patch", ["-p1", "-d", extracted, "-i", allCreationTargetSizePatchPath]);
  run("patch", ["-p1", "-d", extracted, "-i", sourceAdjacentOutputPatchPath]);
  await Promise.all([formatBundle(mainBundle), formatBundle(rendererBundle)]);
  run("patch", [
    "-p1",
    "-d",
    extracted,
    "-i",
    overwriteSourceWebmAlphaPatchPath,
  ]);
  run("patch", ["-p1", "-d", extracted, "-i", collagePatchPath]);
  run("patch", ["-p1", "-d", extracted, "-i", collageOverlayPatchPath]);
  run("patch", ["-p1", "-d", extracted, "-i", collageTinyScalePatchPath]);
  run("patch", ["-p1", "-d", extracted, "-i", movMp4FrameRatePatchPath]);
  run("patch", ["-p1", "-d", extracted, "-i", beyondMediaSuitePatchPath]);

  const rendererHtml = path.join(extracted, "out", "renderer", "index.html");
  const rendererName = path.basename(rendererBundle);
  const rendererSource = await fs.readFile(rendererBundle);
  const rendererHash = createHash("sha256")
    .update(rendererSource)
    .digest("hex")
    .slice(0, 12);
  const cacheBustedName = `index-fork-${rendererHash}.js`;
  const cacheBustedBundle = path.join(rendererAssets, cacheBustedName);
  const html = (await fs.readFile(rendererHtml, "utf8")).replace(
    /<title>.*?<\/title>/,
    "<title>Beyond Media Suite</title>",
  );
  const rendererReference = `./assets/${rendererName}`;
  if (!html.includes(rendererReference)) {
    throw new Error(`Renderer reference was not found: ${rendererReference}`);
  }
  await fs.rename(rendererBundle, cacheBustedBundle);
  await fs.writeFile(
    rendererHtml,
    html.replaceAll(rendererReference, `./assets/${cacheBustedName}`),
  );

  packagedJson.productName = "Beyond Media Suite";
  packagedJson.version = "2.1.3-fork.25";
  await fs.writeFile(
    packagedJsonPath,
    `${JSON.stringify(packagedJson, null, 2)}\n`,
  );

  await asar.createPackageWithOptions(extracted, packedAsar, {
    unpackDir:
      "node_modules/{color,color-convert,color-name,color-string,detect-libc,libheif-js,semver,sharp,simple-swizzle}",
  });
  await fs.mkdir(path.dirname(outputApp), { recursive: true });
  await fs.rm(outputApp, { recursive: true, force: true });
  run("ditto", [baseApp, outputApp]);
  const outputAsar = path.join(outputApp, "Contents", "Resources", "app.asar");
  await fs.copyFile(packedAsar, outputAsar);
  const outputUnpacked = `${outputAsar}.unpacked`;
  await fs.rm(outputUnpacked, { recursive: true, force: true });
  run("ditto", [`${packedAsar}.unpacked`, outputUnpacked]);
  const toolsDir = path.join(outputApp, "Contents", "Resources", "tools");
  await fs.mkdir(toolsDir, { recursive: true });
  await fs.copyFile(await ensureYtDlp(), path.join(toolsDir, "yt-dlp"));
  await fs.chmod(path.join(toolsDir, "yt-dlp"), 0o755);
  await fs.writeFile(
    path.join(outputApp, "Contents", "Resources", "xpic-fork.json"),
    `${JSON.stringify(
      {
        product: "Beyond Media Suite",
        fork: "tdw46/Beyond-Media-Suite",
        baseVersion: "2.1.3",
        ytDlpVersion,
        feature:
          "all-creation-target-output-size, universal-longest-edge, faster-vp9-alpha, source-adjacent-opt-output, safe-source-overwrite, webm-compress-alpha, mixed-media-collage, aspect-packed-collage-layers, high-resolution-collage-preview, exact-collage-dimensions-minimum-crop, full-source-collage-transforms, interactive-collage-layer-stack, persistent-collage-media-controls, hard-cap-gif-target-search, resume-completed-editing, exact-gif-buffer-write, opt-in-gif-color-reduction, collage-gradient-background-text-overlay-system-fonts-drop-shadow, unified-collage-layer-controls, text-gradient-presets, exact-collage-preview-export-svg, collage-background-text-patterns, per-media-edge-crop, auto-padded-no-crop-layout, unrestricted-canvas-space-layer-offsets, non-displacing-media-overlay-layers, one-percent-collage-layer-scaling, stable-two-pass-frame-timing, accurate-media-cancellation-errors, youtube-millisecond-clips-local-frame-buffer-exact-dimensions-target-size",
        rendererAsset: cacheBustedName,
      },
      null,
      2,
    )}\n`,
  );

  const plist = path.join(outputApp, "Contents", "Info.plist");
  const asarHash = createHash("sha256")
    .update(asar.getRawHeader(outputAsar).headerString)
    .digest("hex");
  run("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :ElectronAsarIntegrity:Resources/app.asar:hash ${asarHash}`,
    plist,
  ]);
  run("plutil", [
    "-replace",
    "CFBundleDisplayName",
    "-string",
    "Beyond Media Suite",
    plist,
  ]);
  run("plutil", [
    "-replace",
    "CFBundleIdentifier",
    "-string",
    "com.tdw46.beyond-media-suite",
    plist,
  ]);
  run("plutil", ["-replace", "CFBundleVersion", "-string", "2.1.3.25", plist]);

  run("xattr", ["-dr", "com.apple.quarantine", outputApp]);
  run("codesign", ["--force", "--deep", "--sign", "-", outputApp]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", outputApp]);
  console.log(`Built ${outputApp}`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
