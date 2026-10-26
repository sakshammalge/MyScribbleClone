import { useRef } from 'react';

/** Placeholder doodle surface proving the canvas works; real tools and sync arrive in M3. */
export function Sketchpad() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * e.currentTarget.width,
      y: ((e.clientY - rect.top) / rect.height) * e.currentTarget.height,
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    ctx.strokeStyle = getComputedStyle(e.currentTarget).getPropertyValue('--color-accent');
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const { x, y } = point(e);
    ctx.moveTo(x, y);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = point(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const onUp = () => {
    drawing.current = false;
  };

  return (
    <canvas
      ref={canvasRef}
      className="sketch"
      width={800}
      height={600}
      aria-label="Doodle area"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
}
