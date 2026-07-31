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
  process.argv[3] || path.join(repoRoot, "dist", "xPic.app"),
);
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

  const rendererHtml = path.join(extracted, "out", "renderer", "index.html");
  const rendererName = path.basename(rendererBundle);
  const rendererSource = await fs.readFile(rendererBundle);
  const rendererHash = createHash("sha256")
    .update(rendererSource)
    .digest("hex")
    .slice(0, 12);
  const cacheBustedName = `index-fork-${rendererHash}.js`;
  const cacheBustedBundle = path.join(rendererAssets, cacheBustedName);
  const html = await fs.readFile(rendererHtml, "utf8");
  const rendererReference = `./assets/${rendererName}`;
  if (!html.includes(rendererReference)) {
    throw new Error(`Renderer reference was not found: ${rendererReference}`);
  }
  await fs.rename(rendererBundle, cacheBustedBundle);
  await fs.writeFile(
    rendererHtml,
    html.replaceAll(rendererReference, `./assets/${cacheBustedName}`),
  );

  packagedJson.productName = "xPic Fork";
  packagedJson.version = "2.1.3-fork.8";
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
  await fs.writeFile(
    path.join(outputApp, "Contents", "Resources", "xpic-fork.json"),
    `${JSON.stringify(
      {
        fork: "tdw46/xPic",
        baseVersion: "2.1.3",
        feature:
          "all-creation-target-output-size, universal-longest-edge, faster-vp9-alpha, source-adjacent-opt-output, safe-source-overwrite, webm-compress-alpha",
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
    "xPic Fork",
    plist,
  ]);
  run("plutil", [
    "-replace",
    "CFBundleIdentifier",
    "-string",
    "com.tdw46.xpic.fork",
    plist,
  ]);
  run("plutil", ["-replace", "CFBundleVersion", "-string", "2.1.3.8", plist]);

  run("xattr", ["-dr", "com.apple.quarantine", outputApp]);
  run("codesign", ["--force", "--deep", "--sign", "-", outputApp]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", outputApp]);
  console.log(`Built ${outputApp}`);
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
