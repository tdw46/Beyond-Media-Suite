import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL("../editor/timeline-renderer.js", import.meta.url),
  "utf8",
);
const context = vm.createContext({
  reactExports: { memo: (component) => component },
  outputTextPreviewIsVideo: (item) =>
    /\.(mov|mp4|webm)$/i.test(item?.path || ""),
});
vm.runInContext(
  `${source}\nglobalThis.helpers = { clipDurationMs, clipBounds, timelinePartName, timelineTime, editorIsAnimated, timelineReorder };`,
  context,
);
const {
  clipDurationMs,
  clipBounds,
  timelinePartName,
  timelineTime,
  editorIsAnimated,
  timelineReorder,
} = context.helpers;

test("Clip reorder preserves each range and does not mutate the source list", () => {
  const files = [
    { id: "a", timelineStartMs: 10 },
    { id: "b", timelineStartMs: 50 },
    { id: "c", timelineStartMs: 90 },
  ];
  const next = timelineReorder(files, 2, 0);
  assert.equal(next.map((item) => item.id).join(","), "c,a,b");
  assert.equal(next[0].timelineStartMs, 90);
  assert.equal(files.map((item) => item.id).join(","), "a,b,c");
});

test("Timeline distinguishes still WebP from animated image inputs in video tabs", () => {
  assert.equal(
    editorIsAnimated({ path: "still.webp", meta: { pages: 1 } }),
    false,
  );
  assert.equal(
    editorIsAnimated({
      path: "animated.webp",
      meta: { pages: 40, delay: [40, 80] },
    }),
    true,
  );
  assert.equal(
    editorIsAnimated({ ext: ".gif", meta: { duration: "00:00:04.00" } }),
    true,
  );
  assert.equal(editorIsAnimated({ path: "source.mp4" }), true);
});

test("Video timeline parses the inspector's HH:MM:SS duration without truncating long clips", () => {
  assert.equal(clipDurationMs({ meta: { duration: "01:02:03.456" } }), 3723456);
  assert.equal(clipDurationMs({ meta: { duration: 3723.456 } }), 3723456);
  assert.equal(timelineTime(3723456), "62:03.456");
});
test("Animation timeline preserves variable frame delays and uses a useful hold for stills", () => {
  assert.equal(
    clipDurationMs({ meta: { delay: [20, 80, 200, 40], pages: 4 } }),
    340,
  );
  assert.equal(clipDurationMs({ meta: { width: 3840, height: 2160 } }), 5000);
});
test("Timeline trim bounds cannot produce an empty or out-of-source range", () => {
  const item = {
    meta: { duration: "00:00:04.00" },
    timelineStartMs: 1000,
    timelineEndMs: 3000,
  };
  const bounds = clipBounds(item);
  assert.equal(bounds.start, 1000);
  assert.equal(bounds.end, 3000);
  assert.equal(bounds.duration, 4000);
  const inverted = clipBounds({
    ...item,
    timelineStartMs: 9000,
    timelineEndMs: 200,
  });
  assert.equal(inverted.start, 3999);
  assert.equal(inverted.end, 4000);
  const reset = clipBounds({ ...item, timelineStartMs: 0, timelineEndMs: 0 });
  assert.equal(reset.start, 0);
  assert.equal(reset.end, 4000);
});
test("Split segments have distinct output stems without changing the original extension", () => {
  assert.equal(timelinePartName("My.video.mov", 1), "My.video_part1.mov");
  assert.equal(timelinePartName("My.video.mov", 2), "My.video_part2.mov");
});
