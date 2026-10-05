// CSS display geometry only. Never feed viewport measurements into output settings,
// SVG dimensions, decoded frame sizes, or export requests.
const fitCanvasPreview = (
  canvasWidth,
  canvasHeight,
  viewportWidth,
  viewportHeight,
  padding = 24,
) => {
  const dimensions = [
    canvasWidth,
    canvasHeight,
    viewportWidth,
    viewportHeight,
  ].map(Number);
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0))
    return { width: 0, height: 0, scale: 0 };
  const [width, height, availableWidth, availableHeight] = dimensions;
  const inset = Math.max(
    0,
    Math.min(Number(padding) || 0, availableWidth / 10, availableHeight / 10),
  );
  const scale = Math.min(
    (availableWidth - inset * 2) / width,
    (availableHeight - inset * 2) / height,
  );
  return { width: width * scale, height: height * scale, scale };
};
const useCanvasPreviewFit = (width, height, padding = 24) => {
  const viewportRef = reactExports.useRef(null);
  const [viewport, setViewport] = reactExports.useState({
    width: 0,
    height: 0,
  });
  reactExports.useLayoutEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setViewport((previous) =>
        previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    // Initial layout is measured before painting; later resizes coalesce per frame.
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, []);
  return [
    viewportRef,
    fitCanvasPreview(width, height, viewport.width, viewport.height, padding),
  ];
};
