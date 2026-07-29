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

- target values are remembered independently for each output format;
- still and animated images use a quality-first binary search, then reduce
  dimensions proportionally only when quality alone cannot meet the ceiling;
- MP4, MKV, MOV, FLV, and TS use measured two-pass H.264; WebM uses measured
  two-pass VP9 with alpha support; AVI and WMV use iterative native encoders;
- video bitrate is recalibrated against the actual encoded byte size until the
  result fits the requested ceiling, with a small audio and container budget;
- Merge Frames can create WebP, GIF, or alpha-capable WebM and remembers a
  separate target size for each of those formats;
- Video → To Animation can output GIF, WebP, APNG, or WebM, including its own
  remembered target size, FPS, and output width;
- video input accepts GIF, animated WebP, and APNG, and WebM is available as an
  output format;
- fork builds use a content-hashed renderer filename so an older Chromium cache
  cannot hide newly installed controls;
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
