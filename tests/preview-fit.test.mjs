import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(
  new URL("../editor/preview-fit.js", import.meta.url),
  "utf8",
);
const context = vm.createContext({});
vm.runInContext(`${source}\nglobalThis.fit = fitCanvasPreview;`, context);
const fit = context.fit;
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.00001, `${a} != ${b}`);

test("Tall canvases fit the available height instead of clipping below the timeline", () => {
  const fitted = fit(1966, 1854, 1478, 760);
  close(fitted.height, 712);
  close(fitted.width / fitted.height, 1966 / 1854);
  assert.ok(fitted.width <= 1478 - 48);
});

test("Portrait, landscape, square and extreme ratios fit both axes at every window size", () => {
  for (const [width, height] of [
    [3840, 2160],
    [1080, 1920],
    [4096, 4096],
    [8192, 128],
    [128, 8192],
  ]) {
    for (const [viewportWidth, viewportHeight] of [
      [1478, 760],
      [640, 320],
      [320, 480],
      [80, 50],
    ]) {
      const fitted = fit(width, height, viewportWidth, viewportHeight);
      assert.ok(fitted.width > 0 && fitted.width <= viewportWidth);
      assert.ok(fitted.height > 0 && fitted.height <= viewportHeight);
      close(fitted.width / fitted.height, width / height);
    }
  }
});

test("Window and sidebar resize change CSS display scale only, never output pixels or settings", () => {
  const settings = Object.freeze({
    width: 1966,
    height: 1854,
    maxEdge: 0,
    cropEnabled: false,
    outputTextFontSize: 10.92,
  });
  const before = JSON.stringify(settings);
  const large = fit(settings.width, settings.height, 1400, 760);
  const small = fit(settings.width, settings.height, 800, 450);
  assert.ok(small.scale < large.scale);
  close(small.width / small.scale, settings.width);
  close(small.height / small.scale, settings.height);
  assert.equal(JSON.stringify(settings), before);
  assert.doesNotMatch(
    source,
    /dispatch|updateConfig|\.x\(|drawImage|\.width\s*=(?!=)/,
  );
});

test("Hidden or unmeasured viewports do not generate invalid display dimensions", () => {
  for (const args of [
    [0, 1080, 800, 600],
    [1920, 1080, 800, 0],
    [NaN, 1080, 800, 600],
    [1920, Infinity, 800, 600],
  ]) {
    const fitted = fit(...args);
    assert.equal(fitted.width, 0);
    assert.equal(fitted.height, 0);
  }
});

test("Resize observation is display-only, coalesces rapid resizes, and cleans up", () => {
  const element = { clientWidth: 1478, clientHeight: 760 };
  const ref = { current: element };
  let state = { width: 0, height: 0 };
  let effect,
    resize,
    cleanup,
    disconnected = false;
  let measures = 0;
  const frames = new Map();
  let id = 0;
  const runtime = vm.createContext({
    reactExports: {
      useRef: () => ref,
      useState: () => [
        state,
        (update) => {
          measures++;
          state = update(state);
        },
      ],
      useLayoutEffect: (callback) => {
        effect = callback;
      },
    },
    ResizeObserver: class {
      constructor(callback) {
        resize = callback;
      }
      observe(node) {
        assert.equal(node, element);
      }
      disconnect() {
        disconnected = true;
      }
    },
    window: {
      requestAnimationFrame(callback) {
        frames.set(++id, callback);
        return id;
      },
      cancelAnimationFrame(key) {
        frames.delete(key);
      },
    },
  });
  vm.runInContext(
    `${source}\nglobalThis.useFit = useCanvasPreviewFit;`,
    runtime,
  );
  runtime.useFit(1966, 1854);
  cleanup = effect();
  close(runtime.useFit(1966, 1854)[1].height, 712);
  element.clientHeight = 450;
  resize();
  resize();
  resize();
  assert.equal(frames.size, 1);
  const [key, callback] = [...frames.entries()][0];
  frames.delete(key);
  callback();
  close(runtime.useFit(1966, 1854)[1].height, 402);
  assert.equal(measures, 2);
  // New output geometry is fitted without resetting the observer or pixel settings.
  close(
    runtime.useFit(1920, 1080)[1].width / runtime.useFit(1920, 1080)[1].height,
    1920 / 1080,
  );
  resize();
  cleanup();
  assert.equal(disconnected, true);
  assert.equal(frames.size, 0);
});

test("Shared canvas and collage use measured fit dimensions instead of width-only or max-height distortion", async () => {
  const patch = await readFile(
    new URL("../patches/xpic-2.1.3-canvas-preview-fit.patch", import.meta.url),
    "utf8",
  );
  assert.match(
    patch.replace(/^\+/gm, ""),
    /useCanvasPreviewFit\(\s*canvas\.width,\s*canvas\.height/,
  );
  assert.match(
    patch.replace(/^\+/gm, ""),
    /useCanvasPreviewFit\(\s*geometry\.width,\s*geometry\.height/,
  );
  assert.match(patch, /\+\s*height: previewDisplay.height/);
  assert.match(patch, /\+\s*height: collageDisplay.height/);
  assert.match(source, /new ResizeObserver/);
  assert.match(source, /observer\.disconnect\(\)/);
});
