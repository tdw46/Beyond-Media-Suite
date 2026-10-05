// Inserted into EvnetHandler by build-fork.mjs; shares its job and temp cleanup.
const editorCancelledJobs = new Set();
const editorTempoFilters = (speed) => {
  let remaining = Math.max(1 / 16, Math.min(16, Number(speed) || 1));
  const filters = [];
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(8)}`);
  return filters;
};
const editorPrepareSource = async (source, jobId) => {
  if (path.extname(source).toLowerCase() !== ".webp") {
    return { path: source, cleanup: () => {} };
  }
  const metadata = await sharp(source).metadata();
  if (!(metadata.pages > 1)) return { path: source, cleanup: () => {} };
  const directory = fs.mkdtempSync(
    path.join(app2.getPath("temp"), "bms-animation-"),
  );
  trackMediaTemp(jobId, directory);
  const cleanup = () => fs.rmSync(directory, { recursive: true, force: true });
  try {
    const lines = [];
    for (let index = 0; index < metadata.pages; index++) {
      if (jobId && editorCancelledJobs.has(jobId))
        throw new Error("Media job cancelled.");
      const frame = path.join(
        directory,
        `${String(index).padStart(6, "0")}.png`,
      );
      await sharp(source, { page: index, pages: 1 }).png().toFile(frame);
      lines.push(`file '${frame.replaceAll("'", "'\\''")}'`);
      lines.push(
        `duration ${(Math.max(10, Number(metadata.delay?.[index]) || 100) / 1000).toFixed(6)}`,
      );
    }
    lines.push(
      `file '${path.join(directory, `${String(metadata.pages - 1).padStart(6, "0")}.png`)}'`,
    );
    const list = path.join(directory, "frames.txt");
    fs.writeFileSync(list, `${lines.join("\n")}\n`);
    const bridge = path.join(directory, "animation.mkv");
    const ffmpeg = path.join(binDir(), `ffmpeg${isWin2 ? ".exe" : ""}`);
    await ensureExecPerm(binDir());
    await runMediaProcess(
      ffmpeg,
      [
        "-hide_banner",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        "-fps_mode",
        "vfr",
        "-c:v",
        "ffv1",
        "-level",
        "3",
        "-pix_fmt",
        "bgra",
        "-an",
        "-t",
        String(
          Array.from({ length: metadata.pages }).reduce(
            (sum, _, index) =>
              sum + Math.max(10, Number(metadata.delay?.[index]) || 100),
            0,
          ) / 1000,
        ),
        bridge,
      ],
      { jobId },
    );
    return { path: bridge, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
};
const editorSequenceIntermediate = async (opt) => {
  const { clips, outPath, jobId } = opt || {};
  if (!Array.isArray(clips) || !clips.length)
    throw new Error("Add a clip to the timeline first.");
  const directory = fs.mkdtempSync(
    path.join(app2.getPath("temp"), "bms-sequence-"),
  );
  trackMediaTemp(jobId, directory);
  const ffmpeg = path.join(binDir(), `ffmpeg${isWin2 ? ".exe" : ""}`);
  let width = Math.max(2, Math.round(Number(opt.width) || 0));
  let height = Math.max(2, Math.round(Number(opt.height) || 0));
  let fps = Math.max(1, Math.min(120, Number(opt.fps) || 30));
  await ensureExecPerm(binDir());
  const list = [];
  try {
    for (let index = 0; index < clips.length; index++) {
      if (jobId && editorCancelledJobs.has(jobId))
        throw new Error("Media job cancelled.");
      const clip = clips[index];
      const prepared = await editorPrepareSource(clip.path, jobId);
      try {
        const media = clip.still
          ? {
              duration: Math.max(0.001, Number(clip.durationMs) / 1000 || 5),
              width: clip.width,
              height: clip.height,
              fps,
              hasAudio: false,
            }
          : await probeMediaInfo(ffmpeg, prepared.path, jobId);
        if (index === 0) {
          if (!(Number(opt.width) > 0)) width = Number(media.width) || 1280;
          if (!(Number(opt.height) > 0)) height = Number(media.height) || 720;
          width = Math.max(2, Math.ceil(width / 2) * 2);
          height = Math.max(2, Math.ceil(height / 2) * 2);
          if (!(Number(opt.fps) > 0))
            fps = Math.max(1, Math.min(120, Number(media.fps) || 30));
        }
        const start = Math.max(0, Number(clip.startMs) || 0) / 1000;
        const end = Math.min(
          media.duration,
          Number(clip.endMs) > 0 ? Number(clip.endMs) / 1000 : media.duration,
        );
        if (end <= start)
          throw new Error(`Clip ${index + 1} has an empty selected range.`);
        const duration = end - start;
        const speed = Math.max(1 / 16, Math.min(16, Number(clip.speed) || 1));
        const destination = path.join(
          directory,
          `${String(index).padStart(6, "0")}.mkv`,
        );
        const args = ["-hide_banner", "-y"];
        if (clip.still) args.push("-loop", "1", "-framerate", String(fps));
        if (path.extname(prepared.path).toLowerCase() === ".webm")
          args.push("-c:v", "libvpx-vp9");
        args.push(
          "-ss",
          start.toFixed(3),
          "-t",
          duration.toFixed(3),
          "-i",
          prepared.path,
        );
        if (!media.hasAudio)
          args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
        const videoFilter = `setpts=(PTS-STARTPTS)/${speed.toFixed(8)},fps=${fps},format=rgba,scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x00000000,setsar=1`;
        const audioFilter = `asetpts=PTS-STARTPTS,${editorTempoFilters(speed).join(",")},aresample=48000,aformat=channel_layouts=stereo,apad`;
        args.push(
          "-map",
          "0:v:0",
          "-map",
          media.hasAudio ? media.audioStream : "1:a:0",
          "-vf",
          videoFilter,
          "-af",
          audioFilter,
          "-t",
          (duration / speed).toFixed(6),
          "-c:v",
          "ffv1",
          "-level",
          "3",
          "-pix_fmt",
          "bgra",
          "-c:a",
          "pcm_s16le",
          destination,
        );
        await runMediaProcess(ffmpeg, args, { jobId });
        list.push(`file '${destination.replaceAll("'", "'\\''")}'`);
      } finally {
        prepared.cleanup();
      }
    }
    const listPath = path.join(directory, "clips.txt");
    fs.writeFileSync(listPath, `${list.join("\n")}\n`);
    trackMediaTemp(jobId, outPath);
    await runMediaProcess(
      ffmpeg,
      [
        "-hide_banner",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-c",
        "copy",
        outPath,
      ],
      { jobId },
    );
    return {
      path: outPath,
      size: fs.statSync(outPath).size,
      width,
      height,
      fps,
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
};
