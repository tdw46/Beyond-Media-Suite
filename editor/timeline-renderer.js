// Shared transport. Clock updates are events, so they don't persist config or rerender the app.
const TIMELINE_MODULE_KEYS = new Set([
  "convert",
  "compress",
  "crop",
  "merge",
  "vconvert",
  "vcompress",
  "v2image",
  "collage",
]);
const TIMELINE_SEQUENCE_KEYS = new Set([
  "vconvert",
  "vcompress",
  "v2image",
  "convert",
  "compress",
]);
const hasTimelineEdits = (config) =>
  Number(config.timelineStartMs) > 0 ||
  Number(config.timelineEndMs) > 0 ||
  Math.abs(normalizedPlaybackSpeed(config.speed) - 1) > 0.000001;
const editorSeconds = (value) => {
  const parts = String(value || "").split(":");
  return parts.length === 3
    ? Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2])
    : Math.max(0, Number(value) || 0);
};
const clipDurationMs = (item) => {
  const delays = item?.meta?.delay;
  if (Array.isArray(delays) && delays.length)
    return delays.reduce(
      (sum, delay) => sum + Math.max(10, Number(delay) || 100),
      0,
    );
  const seconds = editorSeconds(item?.meta?.duration);
  if (seconds > 0) return Math.round(seconds * 1000);
  const pages = Number(item?.meta?.pages) || 0;
  if (pages > 1)
    return Math.round((pages * 1000) / (Number(item.meta.fps) || 10));
  return 5000;
};
const clipBounds = (item) => {
  const duration = clipDurationMs(item);
  const start = Math.max(
    0,
    Math.min(duration - 1, Number(item?.timelineStartMs) || 0),
  );
  const end = Math.max(
    start + 1,
    Math.min(duration, Number(item?.timelineEndMs) || duration),
  );
  return { start, end, duration };
};
const timelineTime = (ms) => {
  const value = Math.max(0, Math.round(Number(ms) || 0));
  return `${String(Math.floor(value / 60000)).padStart(2, "0")}:${String(Math.floor((value % 60000) / 1000)).padStart(2, "0")}.${String(value % 1000).padStart(3, "0")}`;
};
const timelinePartName = (name, part) => {
  const dot = String(name).lastIndexOf(".");
  return dot > 0
    ? `${name.slice(0, dot)}_part${part}${name.slice(dot)}`
    : `${name}_part${part}`;
};
const timelineReorder = (files, from, to) => {
  const next = [...files];
  if (from < 0 || to < 0 || from >= files.length || to >= files.length)
    return next;
  const [clip] = next.splice(from, 1);
  next.splice(to, 0, clip);
  return next;
};
const editorIsAnimated = (item) =>
  outputTextPreviewIsVideo(item) ||
  Number(item?.meta?.pages) > 1 ||
  (!Number(item?.meta?.pages) &&
    editorSeconds(item?.meta?.duration) > 0 &&
    /\.(gif|webp|apng)$/i.test(
      String(item?.ext || item?.name || item?.path || ""),
    )) ||
  (Array.isArray(item?.meta?.delay) && item.meta.delay.length > 1);
const editorPreviewState = {
  itemId: null,
  sourceMs: 0,
  playing: false,
  muted: true,
  speed: 1,
};
const emitEditorPreview = (state) => {
  Object.assign(editorPreviewState, state);
  window.dispatchEvent(
    new CustomEvent("bms-timeline-preview", {
      detail: { ...editorPreviewState },
    }),
  );
};
const editorSettingsGroups = (mod, config, update, t, session) => {
  const flatten = (node) => {
    if (!node) return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (node.type === jsxRuntimeExports.Fragment)
      return flatten(node.props.children);
    return [node];
  };
  const nodes = flatten(
    mod.renderParams({
      config: { ...config, __sectionRender: true },
      update,
      t,
      session,
    }),
  );
  const canvas = [];
  const exports = [];
  const outputIndex = nodes.findIndex(
    (node) => node.props?.label === t("flow.outFormat"),
  );
  for (const [index, node] of nodes.entries()) {
    if (
      node.type === OutputTextEffectsControls ||
      node.type === MotionEffectsControls
    )
      continue;
    if (
      node.type === SpeedSlider &&
      session.files.length &&
      TIMELINE_MODULE_KEYS.has(mod.key)
    )
      continue;
    if (
      node.type === AspectCropControls ||
      mod.key === "crop" ||
      (mod.key === "collage" && index < outputIndex)
    )
      canvas.push(node);
    else exports.push(node);
  }
  return { canvas, exports };
};
const EditorMediaPreview = reactExports.memo(({ item, style }) => {
  const mediaRef = reactExports.useRef(null);
  const decoderRef = reactExports.useRef(null);
  const framesRef = reactExports.useRef([]);
  const busyRef = reactExports.useRef(false);
  const pendingRef = reactExports.useRef(0);
  const [error, setError] = reactExports.useState("");
  const video = outputTextPreviewIsVideo(item);
  const animated = !video && editorIsAnimated(item);
  reactExports.useEffect(() => {
    if (!animated || !item?.url) return;
    let alive = true;
    const abort = new AbortController();
    const load = async () => {
      try {
        if (!window.ImageDecoder)
          throw new Error("Frame preview isn't available in this runtime.");
        const bytes = await (
          await fetch(item.url, { signal: abort.signal })
        ).arrayBuffer();
        const format = String(
          item.ext || item.meta?.format || item.name,
        ).toLowerCase();
        const type = /gif/.test(format)
          ? "image/gif"
          : /webp/.test(format)
            ? "image/webp"
            : "image/png";
        const decoder = new ImageDecoder({
          data: bytes,
          type,
          preferAnimation: true,
        });
        await decoder.tracks.ready;
        if (!alive) {
          decoder.close();
          return;
        }
        decoderRef.current = decoder;
        const delays = item.meta?.delay || [];
        let position = 0;
        framesRef.current = Array.from(
          { length: decoder.tracks.selectedTrack.frameCount },
          (_, index) => {
            const start = position;
            position += Math.max(
              10,
              Number(delays[index]) || 1000 / (Number(item.meta?.fps) || 10),
            );
            return start;
          },
        );
        await paint(
          editorPreviewState.itemId === item.id
            ? editorPreviewState.sourceMs
            : clipBounds(item).start,
        );
      } catch (cause) {
        if (alive && cause.name !== "AbortError")
          setError(cause.message || String(cause));
      }
    };
    const paint = async (ms) => {
      pendingRef.current = ms;
      if (busyRef.current || !decoderRef.current) return;
      busyRef.current = true;
      try {
        let last = -1;
        while (alive && last !== pendingRef.current) {
          last = pendingRef.current;
          const times = framesRef.current;
          let index = times.findIndex((time) => time > last) - 1;
          if (index < -1) index = times.length - 1;
          if (index === -1) index = 0;
          const decoded = await decoderRef.current.decode({
            frameIndex: Math.max(0, index),
          });
          const canvas = mediaRef.current;
          if (alive && canvas) {
            if (
              canvas.width !== decoded.image.displayWidth ||
              canvas.height !== decoded.image.displayHeight
            ) {
              canvas.width = decoded.image.displayWidth;
              canvas.height = decoded.image.displayHeight;
            }
            const context = canvas.getContext("2d");
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.drawImage(decoded.image, 0, 0);
          }
          decoded.image.close();
        }
      } finally {
        busyRef.current = false;
      }
    };
    const listener = (event) => {
      if (event.detail.itemId === item.id || event.detail.allLayers)
        void paint(event.detail.sourceMs);
    };
    window.addEventListener("bms-timeline-preview", listener);
    setError("");
    void load();
    return () => {
      alive = false;
      abort.abort();
      window.removeEventListener("bms-timeline-preview", listener);
      decoderRef.current?.close();
      decoderRef.current = null;
    };
  }, [item?.path, item?.id, animated]);
  reactExports.useEffect(() => {
    if (!video) return;
    const sync = (state) => {
      const media = mediaRef.current;
      if (!media || (state.itemId !== item.id && !state.allLayers)) return;
      const target = Math.max(0, state.sourceMs / 1000);
      media.muted = state.muted !== false;
      media.playbackRate = Math.max(0.0625, Math.min(16, state.speed || 1));
      if (!state.playing || Math.abs(media.currentTime - target) > 0.25)
        media.currentTime = target;
      if (state.playing) void media.play().catch(() => {});
      else media.pause();
    };
    const listener = (event) => sync(event.detail);
    window.addEventListener("bms-timeline-preview", listener);
    sync(editorPreviewState);
    return () => window.removeEventListener("bms-timeline-preview", listener);
  }, [video, item?.id]);
  const element = video
    ? jsxRuntimeExports.jsx("video", {
        ref: mediaRef,
        src: item.url,
        poster: item.poster || undefined,
        muted: true,
        playsInline: true,
        preload: "auto",
        style,
        onLoadedMetadata: () => emitEditorPreview(editorPreviewState),
      })
    : animated
      ? jsxRuntimeExports.jsx("canvas", {
          ref: mediaRef,
          style,
          "aria-label": "Full resolution animation frame",
        })
      : jsxRuntimeExports.jsx("img", {
          src: item.url || item.thumb,
          draggable: false,
          style,
          alt: "",
        });
  return jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, {
    children: [
      element,
      error
        ? jsxRuntimeExports.jsx("span", {
            className: "x-timeline-preview-error",
            children: error,
          })
        : null,
    ],
  });
});
const TimelineCanvas = reactExports.memo(
  ({ config, files, t: t2, onRemove, onUpdate }) => {
    const [selectedId, setSelectedId] = reactExports.useState(null);
    reactExports.useEffect(() => {
      const listener = (event) => setSelectedId(event.detail.itemId);
      window.addEventListener("bms-timeline-preview", listener);
      return () => window.removeEventListener("bms-timeline-preview", listener);
    }, []);
    const item = files.find((file) => file.id === selectedId) || files[0];
    return jsxRuntimeExports.jsx(OutputTextCanvasPreview, {
      config,
      effect: outputTextEffectFor(config),
      previewItem: item,
      previewText:
        String(config.outputText || "").trim() || "Beyond Media Suite",
      t: t2,
      workspace: true,
      files,
      onRemove,
      onUpdate,
      timelinePreview: true,
    });
  },
);
const TimelineEditor = reactExports.memo(({ mod: mod2, files, onPick }) => {
  const config = useSelector((state) => state[mod2.configKey]?.config) || {};
  const [selectedId, setSelectedId] = reactExports.useState(null);
  const [playhead, setPlayhead] = reactExports.useState(0);
  const [playing, setPlaying] = reactExports.useState(false);
  const [muted, setMuted] = reactExports.useState(true);
  const [dragId, setDragId] = reactExports.useState(null);
  const [undoStack, setUndoStack] = reactExports.useState([]);
  const selected = files.find((item) => item.id === selectedId) || files[0];
  const composite = mod2.key === "merge" || mod2.key === "collage";
  const frameSequence = mod2.key === "merge";
  const frameDuration = 1000 / Math.max(1, Number(config.zl) || 10);
  const compositeDuration = frameSequence
    ? files.length * frameDuration
    : Math.max(
        1000,
        Number(config.duration) * 1000 ||
          Math.max(0, ...files.filter(editorIsAnimated).map(clipDurationMs)) ||
          3000,
      );
  const bounds = composite
    ? clipBounds({
        meta: { duration: compositeDuration / 1000 },
        timelineStartMs: config.timelineStartMs,
        timelineEndMs: config.timelineEndMs,
      })
    : clipBounds(selected);
  const speed = normalizedPlaybackSpeed(
    composite ? config.speed : (selected?.timelineSpeed ?? config.speed),
  );
  const enabled =
    TIMELINE_MODULE_KEYS.has(mod2.key) &&
    files.length > 0 &&
    (composite ||
      mod2.mediaType === "video" ||
      files.some(editorIsAnimated) ||
      config.motionEnabled);
  const latestRef = reactExports.useRef({});
  latestRef.current = {
    files,
    selected,
    bounds,
    speed,
    muted,
    frameDuration,
    composite,
    frameSequence,
    sequence: config.timelineMode === "sequence",
  };
  const update = (patch) => store.dispatch(mod2.updateConfig(patch));
  const publish = (sourceMs, play = playing) => {
    const state = latestRef.current;
    const item = state.frameSequence
      ? state.files[
          Math.min(
            state.files.length - 1,
            Math.floor(sourceMs / state.frameDuration),
          )
        ]
      : state.selected;
    emitEditorPreview({
      itemId: item?.id,
      sourceMs: state.frameSequence ? 0 : sourceMs,
      playing: play,
      muted: state.muted,
      speed: state.speed,
      allLayers: state.composite && !state.frameSequence,
    });
  };
  reactExports.useEffect(() => {
    setPlayhead(bounds.start);
    publish(bounds.start, playing);
  }, [selected?.id, mod2.key]);
  reactExports.useEffect(() => {
    publish(playhead, playing);
  }, [playhead, playing, muted, speed]);
  reactExports.useEffect(() => {
    const listener = (event) => {
      if (event.detail.toggle) setPlaying((value) => !value);
    };
    window.addEventListener("bms-timeline-control", listener);
    return () => window.removeEventListener("bms-timeline-control", listener);
  }, []);
  reactExports.useEffect(() => {
    if (!enabled || !playing) return;
    let handle;
    let previous = performance.now();
    let displayed = previous;
    let clock = playhead;
    const tick = (now) => {
      const state = latestRef.current;
      clock += (now - previous) * state.speed;
      previous = now;
      if (clock >= state.bounds.end) {
        if (state.sequence && !state.composite && state.files.length > 1) {
          const index = state.files.findIndex(
            (item) => item.id === state.selected.id,
          );
          const next = state.files[(index + 1) % state.files.length];
          clock = clipBounds(next).start;
          setSelectedId(next.id);
        } else clock = state.bounds.start;
      }
      if (now - displayed >= 33) {
        publish(clock, true);
        setPlayhead(clock);
        displayed = now;
      }
      handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [playing, enabled]);
  reactExports.useEffect(() => () => emitEditorPreview({ playing: false }), []);
  if (!enabled) return null;
  const remember = () =>
    setUndoStack((stack) => [
      ...stack.slice(-19),
      {
        files,
        config: {
          timelineStartMs: config.timelineStartMs || 0,
          timelineEndMs: config.timelineEndMs || 0,
          speed: config.speed || 1,
        },
      },
    ]);
  const replaceFiles = (next) => store.dispatch(setSessionFiles(next));
  const moveSelected = (direction) => {
    const index = files.findIndex((item) => item.id === selected.id);
    const destination = index + direction;
    if (destination < 0 || destination >= files.length) return;
    remember();
    replaceFiles(timelineReorder(files, index, destination));
  };
  const editClip = (patch) => {
    setPlaying(false);
    if (composite) update(patch);
    else store.dispatch(updateSessionFile({ id: selected.id, ...patch }));
  };
  const seek = (time) => {
    setPlaying(false);
    setPlayhead(time);
    publish(time, false);
  };
  const trim = (edge, value, save = false) => {
    if (save) remember();
    const patch =
      edge === "start"
        ? {
            timelineStartMs: Math.max(
              0,
              Math.min(bounds.end - 1, Math.round(value)),
            ),
          }
        : {
            timelineEndMs: Math.max(
              bounds.start + 1,
              Math.min(bounds.duration, Math.round(value)),
            ),
          };
    editClip(patch);
    seek(edge === "start" ? patch.timelineStartMs : patch.timelineEndMs - 1);
  };
  const beginTrim = (event, edge) => {
    event.stopPropagation();
    event.preventDefault();
    remember();
    setPlaying(false);
    const target = event.currentTarget;
    const box = target.parentElement.getBoundingClientRect();
    const initial = edge === "start" ? bounds.start : bounds.end;
    const initialX = event.clientX;
    target.setPointerCapture(event.pointerId);
    const move = (next) => {
      const value = next.shiftKey
        ? initial + (next.clientX - initialX)
        : ((next.clientX - box.left) / box.width) * bounds.duration;
      trim(edge, value);
    };
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
    move(event);
  };
  const split = () => {
    if (composite || playhead <= bounds.start + 1 || playhead >= bounds.end - 1)
      return;
    remember();
    setPlaying(false);
    const index = files.findIndex((item) => item.id === selected.id);
    const first = {
      ...selected,
      id: uuid(),
      name: timelinePartName(selected.name, 1),
      timelineStartMs: bounds.start,
      timelineEndMs: Math.round(playhead),
      timelineSegmentSource: selected.timelineSegmentSource || selected.id,
    };
    const second = {
      ...selected,
      id: uuid(),
      name: timelinePartName(selected.name, 2),
      timelineStartMs: Math.round(playhead),
      timelineEndMs: bounds.end,
      timelineSegmentSource: selected.timelineSegmentSource || selected.id,
    };
    const next = [...files];
    next.splice(index, 1, first, second);
    replaceFiles(next);
    setSelectedId(second.id);
  };
  const beginReorder = (event, item) => {
    if (event.button !== 0) return;
    const target = event.currentTarget;
    const initialX = event.clientX;
    let moved = false;
    target.setPointerCapture(event.pointerId);
    const move = (next) => {
      if (Math.abs(next.clientX - initialX) > 5) {
        moved = true;
        setDragId(item.id);
      }
    };
    const end = (next) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      if (moved && next.type !== "pointercancel") {
        const destination = document
          .elementFromPoint(next.clientX, next.clientY)
          ?.closest("[data-clip-id]")?.dataset.clipId;
        const current = latestRef.current.files;
        const from = current.findIndex((file) => file.id === item.id);
        const to = current.findIndex((file) => file.id === destination);
        if (from >= 0 && to >= 0 && from !== to) {
          remember();
          replaceFiles(timelineReorder(current, from, to));
        }
      }
      setDragId(null);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };
  const button = (label, onClick, disabled = false, extra = {}) =>
    jsxRuntimeExports.jsx("button", {
      type: "button",
      onClick,
      disabled,
      ...extra,
      children: label,
    });
  const field = (label, value, onChange, min, max) =>
    jsxRuntimeExports.jsxs("label", {
      children: [
        label,
        jsxRuntimeExports.jsx("input", {
          type: "number",
          step: 1,
          min,
          max,
          value: Math.round(value),
          onFocus: remember,
          onChange: (event) => onChange(Number(event.target.value)),
        }),
      ],
    });
  const sequenceFormat =
    config.toFormat || String(files[0]?.ext || "").replace(/^\./, "");
  const sequenceAllowed =
    TIMELINE_SEQUENCE_KEYS.has(mod2.key) &&
    [
      ...vWriteOptions.map((option) => option.value),
      "gif",
      "webp",
      "apng",
    ].includes(sequenceFormat) &&
    files.every(
      (file) =>
        editorIsAnimated(file) ||
        !/\.(pdf|svg|heic)$/i.test(file.ext || file.path),
    );
  return jsxRuntimeExports.jsxs("section", {
    className: "x-media-timeline",
    "aria-label": "Media timeline",
    children: [
      jsxRuntimeExports.jsxs("div", {
        className: "x-media-timeline-head",
        children: [
          jsxRuntimeExports.jsxs("div", {
            children: [
              jsxRuntimeExports.jsx("strong", { children: "Timeline" }),
              jsxRuntimeExports.jsx("span", {
                children: composite
                  ? frameSequence
                    ? "Frame sequence"
                    : "Composition · all layers"
                  : "Select a clip · drag to reorder",
              }),
            ],
          }),
          jsxRuntimeExports.jsxs("div", {
            className: "x-media-timeline-actions",
            children: [
              button(playing ? "❚❚ Pause" : "▶ Play", () => {
                if (playhead >= bounds.end - 1) seek(bounds.start);
                setPlaying(!playing);
              }),
              button(
                muted ? "Muted" : "Sound on",
                () => setMuted(!muted),
                false,
                {
                  title:
                    "Preview audio only. Export includes audio by default.",
                },
              ),
              button(
                "Split",
                split,
                composite ||
                  playhead <= bounds.start + 1 ||
                  playhead >= bounds.end - 1,
                {
                  title: composite
                    ? "Split source clips in Convert or To Animation"
                    : "Split this source into editable segments",
                },
              ),
              button(
                "Undo",
                () => {
                  const previous = undoStack[undoStack.length - 1];
                  if (previous) {
                    replaceFiles(previous.files);
                    update(previous.config);
                    setUndoStack(undoStack.slice(0, -1));
                  }
                },
                !undoStack.length,
              ),
              button("+ Media", () => onPick({ append: true }), false, {
                className: "is-primary",
              }),
            ],
          }),
        ],
      }),
      jsxRuntimeExports.jsxs("div", {
        className: "x-timeline-ruler",
        children: Array.from({ length: 6 }, (_, index) =>
          jsxRuntimeExports.jsx(
            "span",
            { children: timelineTime((bounds.duration * index) / 5) },
            index,
          ),
        ),
      }),
      jsxRuntimeExports.jsxs("div", {
        className: "x-timeline-range",
        onPointerDown: (event) => {
          if (event.target !== event.currentTarget) return;
          const box = event.currentTarget.getBoundingClientRect();
          seek(
            Math.max(
              bounds.start,
              Math.min(
                bounds.end - 1,
                ((event.clientX - box.left) / box.width) * bounds.duration,
              ),
            ),
          );
        },
        children: [
          jsxRuntimeExports.jsx("div", {
            className: "x-timeline-range-fill",
            style: {
              left: `${(bounds.start / bounds.duration) * 100}%`,
              width: `${((bounds.end - bounds.start) / bounds.duration) * 100}%`,
            },
          }),
          jsxRuntimeExports.jsx("button", {
            type: "button",
            className: "x-timeline-trim-handle",
            "aria-label": "Trim clip start",
            title: "Drag to trim start · Shift = 1 ms per pixel",
            style: { left: `${(bounds.start / bounds.duration) * 100}%` },
            onPointerDown: (event) => beginTrim(event, "start"),
            children: "[",
          }),
          jsxRuntimeExports.jsx("button", {
            type: "button",
            className: "x-timeline-trim-handle",
            "aria-label": "Trim clip end",
            title: "Drag to trim end · Shift = 1 ms per pixel",
            style: { left: `${(bounds.end / bounds.duration) * 100}%` },
            onPointerDown: (event) => beginTrim(event, "end"),
            children: "]",
          }),
          jsxRuntimeExports.jsx("div", {
            className: "x-timeline-playhead",
            style: { left: `${(playhead / bounds.duration) * 100}%` },
          }),
        ],
      }),
      jsxRuntimeExports.jsx("div", {
        className: "x-media-timeline-lane",
        children: files.map((item, index) =>
          jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              draggable: false,
              "data-clip-id": item.id,
              onPointerDown: (event) => beginReorder(event, item),
              onKeyDown: (event) => {
                if (
                  event.altKey &&
                  ["ArrowLeft", "ArrowRight"].includes(event.key)
                ) {
                  event.preventDefault();
                  const index = files.findIndex((clip) => clip.id === item.id);
                  const destination =
                    index + (event.key === "ArrowLeft" ? -1 : 1);
                  if (destination >= 0 && destination < files.length) {
                    remember();
                    replaceFiles(timelineReorder(files, index, destination));
                  }
                }
              },
              className: `x-media-timeline-clip${selected?.id === item.id ? " is-selected" : ""}`,
              onClick: () => {
                setSelectedId(item.id);
                if (frameSequence) seek(index * frameDuration);
                else if (!composite) seek(clipBounds(item).start);
              },
              onDragStart: (event) => {
                setDragId(item.id);
                event.dataTransfer.setData("application/x-bms-clip", item.id);
                event.dataTransfer.effectAllowed = "move";
              },
              onDragOver: (event) => {
                if (
                  !event.dataTransfer.types.includes("application/x-bms-clip")
                )
                  return;
                event.preventDefault();
                event.stopPropagation();
              },
              onDrop: (event) => {
                if (!dragId) return;
                event.preventDefault();
                event.stopPropagation();
                const next = [...files];
                const from = next.findIndex((file) => file.id === dragId);
                const to = next.findIndex((file) => file.id === item.id);
                if (from < 0 || to < 0) return;
                remember();
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                replaceFiles(next);
                setDragId(null);
              },
              title: item.name,
              children: [
                jsxRuntimeExports.jsx("span", {
                  className: "x-media-timeline-clip-index",
                  children: index + 1,
                }),
                jsxRuntimeExports.jsx("span", {
                  className: "x-media-timeline-clip-name",
                  children: item.name,
                }),
                jsxRuntimeExports.jsx("span", {
                  className: "x-media-timeline-clip-duration",
                  children: composite
                    ? frameSequence
                      ? timelineTime(frameDuration)
                      : "Layer"
                    : timelineTime(
                        (clipBounds(item).end - clipBounds(item).start) /
                          normalizedPlaybackSpeed(
                            item.timelineSpeed ?? config.speed,
                          ),
                      ),
                }),
              ],
            },
            item.id,
          ),
        ),
      }),
      jsxRuntimeExports.jsxs("div", {
        className: "x-media-timeline-editor",
        children: [
          jsxRuntimeExports.jsxs("label", {
            className: "x-media-timeline-scrub",
            children: [
              jsxRuntimeExports.jsx("span", {
                children: timelineTime(playhead),
              }),
              jsxRuntimeExports.jsx("input", {
                type: "range",
                "aria-label": "Timeline playhead",
                min: 0,
                max: bounds.duration,
                step: 1,
                value: Math.round(playhead),
                onChange: (event) =>
                  seek(
                    Math.max(
                      bounds.start,
                      Math.min(bounds.end - 1, Number(event.target.value)),
                    ),
                  ),
              }),
            ],
          }),
          jsxRuntimeExports.jsxs("div", {
            className: "x-media-timeline-fields",
            children: [
              field(
                "In · ms",
                bounds.start,
                (value) => trim("start", value),
                0,
                bounds.end - 1,
              ),
              field(
                "Out · ms",
                bounds.end,
                (value) => trim("end", value),
                bounds.start + 1,
                bounds.duration,
              ),
              jsxRuntimeExports.jsxs("label", {
                className: "x-media-timeline-speed",
                children: [
                  jsxRuntimeExports.jsx("span", {
                    children: `Speed · ${playbackSpeedLabel(speed)}`,
                  }),
                  jsxRuntimeExports.jsx("input", {
                    type: "range",
                    "aria-label": "Clip playback speed",
                    min: -4,
                    max: 4,
                    step: 0.125,
                    value: Math.log2(speed),
                    onPointerDown: remember,
                    onChange: (event) =>
                      editClip(
                        composite
                          ? { speed: 2 ** Number(event.target.value) }
                          : { timelineSpeed: 2 ** Number(event.target.value) },
                      ),
                  }),
                ],
              }),
              button("Reset", () => {
                remember();
                editClip({
                  timelineStartMs: 0,
                  timelineEndMs: 0,
                  ...(composite ? { speed: 1 } : { timelineSpeed: 1 }),
                });
                seek(0);
              }),
              button(
                "←",
                () => moveSelected(-1),
                files[0]?.id === selected?.id,
                {
                  title: "Move clip earlier · Option + Left",
                  "aria-label": "Move clip earlier",
                },
              ),
              button(
                "→",
                () => moveSelected(1),
                files[files.length - 1]?.id === selected?.id,
                {
                  title: "Move clip later · Option + Right",
                  "aria-label": "Move clip later",
                },
              ),
              !composite
                ? button(
                    "Remove",
                    () => {
                      remember();
                      replaceFiles(
                        files.filter((item) => item.id !== selected.id),
                      );
                    },
                    files.length < 2,
                  )
                : null,
            ],
          }),
        ],
      }),
      sequenceAllowed
        ? jsxRuntimeExports.jsxs("div", {
            className: "x-timeline-output-mode",
            children: [
              jsxRuntimeExports.jsx("span", { children: "Export:" }),
              button(
                "Separate files",
                () => update({ timelineMode: "batch" }),
                false,
                {
                  className:
                    config.timelineMode !== "sequence" ? "is-selected" : "",
                },
              ),
              button(
                "One sequence",
                () => update({ timelineMode: "sequence" }),
                false,
                {
                  className:
                    config.timelineMode === "sequence" ? "is-selected" : "",
                },
              ),
              jsxRuntimeExports.jsx("span", {
                children:
                  config.timelineMode === "sequence"
                    ? "Clips join in timeline order; source aspect ratios stay intact."
                    : "Each clip keeps its own trim and speed. Text applies to every output.",
              }),
            ],
          })
        : null,
    ],
  });
});
const renderEditorSequence = async ({
  mod,
  files,
  config,
  globalConfig,
  outputDir,
  jobId,
  setProgress,
}) => {
  const format =
    config.toFormat || String(files[0].ext || ".mp4").replace(/^\./, "");
  if (
    ![
      ...vWriteOptions.map((option) => option.value),
      "gif",
      "webp",
      "apng",
    ].includes(format)
  )
    throw new Error(
      "Choose an animated or video output format to export a sequence.",
    );
  const name = optimizedStem(fileStem(files[0].name || "sequence"));
  const outPath = window.pj(outputDir, `${name}.${format}`);
  const cache = await window.x("getCachePath");
  const bridge = window.pj(cache, `bms_sequence_${Date.now()}_${uuid()}.mkv`);
  await window.x("createDirIfNotExist", outputDir);
  setProgress(10);
  try {
    const prepared = await window.x("editorSequenceIntermediate", {
      clips: files.map((item) => {
        const bounds = clipBounds(item);
        return {
          path: item.path,
          startMs: bounds.start,
          endMs: bounds.end,
          durationMs: bounds.duration,
          speed: normalizedPlaybackSpeed(item.timelineSpeed ?? config.speed),
          still: !editorIsAnimated(item),
          width: item.meta?.width,
          height: item.meta?.pageHeight || item.meta?.height,
        };
      }),
      fps: config.matchFps === false ? config.fps : 0,
      outPath: bridge,
      jobId,
    });
    setProgress(55);
    await window.x("vConvert", {
      inputPath: bridge,
      outPath,
      toFormat: format,
      quality:
        Number(config.quality) > 2
          ? Number(config.quality) >= 85
            ? 2
            : 1
          : config.quality,
      fps: prepared.fps,
      matchFps: true,
      speed: 1,
      loop: config.loop || 0,
      loseless: config.loseless,
      longestEdge: longestEdgeFor(config),
      targetFileSizeKb:
        targetSizeFor(config, format) || sourceTargetSizeFor(config),
      ...aspectCropRequest(config),
      outputTextEffect: outputTextEffectFor(config),
      motionEffect: motionEffectFor(config),
      allowGifColorReduction: config.gifColorReduction,
      includeAudio: config.includeAudio !== false,
      jobId,
    });
    const info = await window.x("getFileInfo", outPath);
    const totalFrom = files.reduce((sum, item) => sum + (item.size || 0), 0);
    setProgress(100);
    return {
      count: files.length,
      totalFrom,
      totalTo: info.size,
      saved: totalFrom - info.size,
      savedPct: totalFrom ? Math.round((1 - info.size / totalFrom) * 100) : 0,
      outDir: outputDir,
      output: {
        path: outPath,
        name: `${name}.${format}`,
        size: info.size,
        url: files[0].poster || files[0].thumb || files[0].url,
        dim: `${prepared.width}×${prepared.height}`,
      },
    };
  } finally {
    await window.x("removeFile", bridge).catch(() => {});
    await window.x("finishMediaJob", jobId);
  }
};
