import assert from "node:assert/strict";
import test from "node:test";

function targetVideoBitrateKbps(
  targetKb,
  durationSeconds,
  hasAudio = false,
) {
  const targetBytes = Math.max(10_000, Math.floor(targetKb * 1_000));
  const reserve = Math.max(4_096, Math.floor(targetBytes * 0.02));
  const audioBytes = hasAudio ? (64_000 * durationSeconds) / 8 : 0;
  return Math.max(
    8,
    Math.floor(
      ((targetBytes - reserve - audioBytes) * 8) /
        durationSeconds /
        1_000,
    ),
  );
}

function nextScale(width, targetBytes, measuredBytes) {
  const ratio = Math.min(
    0.92,
    Math.sqrt(targetBytes / measuredBytes) * 0.96,
  );
  return Math.max(20, Math.floor(width * ratio));
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
