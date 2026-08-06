<p align="center">
  <img src="./assets/icon.png" width="100" alt="xPic" />
</p>

<h1 align="center">xPic</h1>

<p align="center">A simple, powerful desktop toolbox for images — convert, compress, crop and more.<br/>For macOS (Apple Silicon &amp; Intel) and Windows.</p>

<p align="center">
  <a href="https://github.com/Xheldon/xPic/releases/latest"><b>⬇️ Download</b></a>
  ·
  <a href="https://xpic.xheldon.com">Website</a>
  ·
  <a href="https://xpic.xheldon.com/changelog">Changelog</a>
  ·
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./assets/screenshot-dark-en.png" />
    <img src="./assets/screenshot-light-en.png" width="760" alt="xPic screenshot" />
  </picture>
</p>

## Features

- **Convert** — JPG / PNG / WebP / AVIF / HEIC / GIF / TIFF and more, including animated images, in batches.
- **Compress** — batch compression with adjustable quality; animated webp / gif supported.
- **Crop & resize** — by ratio, freeform, fixed dimensions, or down to a target file size (quality is found automatically).
- **Merge frames** — stitch a sequence of images into an animated WebP / APNG with custom loop & frame delay.
- **SVGA preview** — play SVGA animation files right inside the app.
- **Video tools** — convert or compress videos, or turn them into GIF / WebP / APNG animations.
- **Workflow** — chain convert / compress / crop / merge into one pipeline and run it with a single click.
- **Local & private** — everything is processed on your machine; nothing is ever uploaded.

Light & dark themes, multiple accent colors, English & Chinese interface. Updates are checked automatically inside the app.

## Tyler's target-size fork

This fork adds a **Target output size (KB)** control to image conversion,
video-to-animation, and every video output format exposed by xPic:

- every creation tab exposes a target-size control, including Image Compress,
  Crop, and Video Compress when preserving the source format;
- target values are remembered independently for each output format;
- every creation tab has a **Longest edge (px)** control; `0` keeps the
  original dimensions, while any other value resizes landscape, portrait, or
  square output proportionally;
- still and animated images use a quality-first binary search, then reduce
  dimensions proportionally only when quality alone cannot meet the ceiling;
- MP4, MKV, MOV, FLV, and TS use measured two-pass H.264; WebM uses measured
  two-pass VP9 with alpha support; AVI and WMV use iterative native encoders;
- video bitrate is recalibrated against the actual encoded byte size until the
  result fits the requested ceiling, with a small audio and container budget;
- Merge Frames can create WebP, GIF, or alpha-capable WebM and remembers a
  separate target size for each of those formats;
- large frame sets use lazy, streamed previews, six-at-a-time metadata reads,
  and a disk-backed lossless intermediate instead of full-image buffers;
- alpha WebM merges prepare a compact YUVA intermediate once, keep the exact
  source frame count, and use VP9 row/tile parallelism for substantially faster
  4K sequences;
- Video → To Animation can output GIF, WebP, APNG, or WebM, including its own
  remembered target size, FPS, and longest-edge size;
- video input accepts GIF, animated WebP, and APNG, and WebM is available as an
  output format;
- fork builds use a content-hashed renderer filename so an older Chromium cache
  cannot hide newly installed controls;
- outputs default to the source folder with an `_opt` suffix before the
  extension; multi-input single-output tools use the first input's name, while
  explicitly chosen folders and custom merge names still take precedence;
- one-to-one creation tabs offer an opt-in **Overwrite source media** switch;
  it is limited to same-format output and replaces the source only after a
  successful encode, with rollback protection;
- Video Compress always routes WebM through VP9 and explicitly uses the libvpx
  decoder so existing alpha is retained with or without a target file size;
- Video → Collage accepts any supported mix of images, animated images, and
  videos; it provides row, column, four-grid, and mirrored three-item layouts,
  plus per-item layer order, scale, and horizontal/vertical offsets in a
  dedicated sidebar section above the creation settings;
- automatic collage layouts proportionally size each cell from its source
  aspect ratio—equal heights within rows and equal widths within columns—so
  full media frames meet edge-to-edge without distortion or letterbox gaps;
- exact collage target width and height can override the automatic canvas;
  media defaults to aspect-preserving Fill with the minimum centered crop,
  while complete-frame letterboxing is available as an opt-in placement mode;
- each auto-layout tile is only the starting position: media and text offsets
  operate in whole-canvas coordinates from `-125%` to `125%`, allowing layers
  to cross other tiles or move partially and fully beyond the canvas boundary;
  preview and export use the same unrestricted coordinates and explicit
  front/back layer order;
- a distinct **Add overlay** action adds up to four extra image/video layers
  centered over the canvas without changing the existing 2–4 tile layout,
  canvas dimensions, or aligned tile positions. Overlay layers retain the same
  scale, crop, canvas offset, playback, and layer-order controls; every tile,
  overlay, and text layer can scale from 1% to 300% in 1% increments;
- the populated Layers panel keeps Add, Remove, bring-forward, and
  send-backward controls available until the four-item limit is reached;
- Collage previews are live and paused by default, with synchronized playback;
  paused moving media uses a lossless high-resolution poster instead of the
  small list thumbnail, preserving alpha and source detail up to 2560px,
  and can export still PNG/JPEG/WebP/AVIF/TIFF, animated GIF/WebP/APNG, or every
  video container exposed by xPic. The same per-format target-size,
  longest-edge, source-adjacent `_opt` naming, aspect, FPS, duration, and loop
  controls apply;
- Collage can add a transparent or two-color gradient canvas background using
  editable color stops, angle, and aesthetic presets including Sunset and
  Electric Violet. Optional top-layer gradient text has the same preset
  library, can match the background or use independent colors, any installed
  macOS system font, media-style
  scale and position controls, and a configurable drop shadow; preview and
  export share the same full-resolution composition. All text and background
  controls live in the Layers panel alongside the media tiles, ordered as
  Text (top), media, and Background (bottom);
- collage preview and export now use the same Sharp-rasterized full-canvas SVG
  background and text layers, so GIF and other outputs match the preview
  boundary exactly, including large, offset text and drop shadows near the
  canvas edges;
- optional repeating comic dots, hexagons, diagonal stripes, checkerboard,
  grid, and wave patterns can blend over the gradient background or inside
  gradient text, with independent color, strength, and scale controls;
- each media tile has independent left, right, top, and bottom crop controls;
  its cropped aspect is used when packing rows and columns, and the same crop
  is applied before scaling in preview and export;
- **Auto-pad media** evenly insets every packed tile by a chosen pixel amount,
  fits each complete cropped frame into the remaining space without automatic
  cropping, and keeps the selected canvas width and height unchanged;
- target-sized GIF creation now searches palette, dimensions, and frame rate
  against a hard byte ceiling and never silently accepts an oversized result;
- GIF output preserves the full 256-color palette by default. **Reduce GIF
  colors** is an explicit opt-in available anywhere GIF media is created or
  compressed;
- image-based target searches write the exact measured encoded bytes, avoiding
  a second encode that could push the saved file above its requested limit;
- every completed creation flow offers **Back to edit**, restoring the same
  inputs and settings for another export while keeping **New batch** separate;
- fork builds do not download upstream app updates over the patch.

The upstream repository publishes the website and releases, but not the
unbundled Electron application source. To keep this change reviewable and
repeatable, the fork stores a narrow patch against the formatted xPic 2.1.3
application bundle plus a build script.

```sh
npm install
npm test
npm run build:fork -- ./official-xPic-2.1.3.app ./dist/xPic.app
```

The first argument must be an unmodified xPic 2.1.3 application bundle. The
build is ad-hoc signed for local macOS use.

## Download

Grab the installer for your platform from the [latest release](https://github.com/Xheldon/xPic/releases/latest), or from the [website](https://xpic.xheldon.com) — it always points to the newest version.

## Feedback

Questions, bugs and ideas are welcome in [Issues](https://github.com/Xheldon/xPic/issues).
