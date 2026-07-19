import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const COLORS = ['#4da3ff', '#2ecc71', '#ff5c5c', '#f1c40f', '#ffffff'];
const SIZES = [2, 4, 7];

/**
 * Envuelve cualquier contenido (un gráfico) y superpone un lienzo para dibujar a mano
 * con lápiz (colores y grosores). Reutilizable para el gráfico en vivo y la pizarra del snapshot.
 */
export function DrawingLayer({ children }: { children: ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [active, setActive] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);

  // Ajusta el lienzo al tamaño del contenedor.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const fit = () => {
      canvas.width = wrap.clientWidth;
      canvas.height = wrap.clientHeight;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const down = (e: React.PointerEvent) => {
    if (!active) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    drawing.current = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };
  const move = (e: React.PointerEvent) => {
    if (!active || !drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const up = () => {
    drawing.current = false;
  };
  const clear = () => {
    const c = canvasRef.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
  };

  return (
    <div className={`draw-wrap ${active ? 'drawing' : ''}`} ref={wrapRef}>
      {children}
      <canvas
        ref={canvasRef}
        className="draw-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      <div className="draw-tools">
        <button
          type="button"
          className={`draw-btn ${active ? 'on' : ''}`}
          title={active ? 'Desactivar lápiz' : 'Dibujar sobre el gráfico'}
          onClick={() => setActive((v) => !v)}
        >
          ✏️
        </button>
        {active && (
          <>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`draw-color ${c === color ? 'sel' : ''}`}
                style={{ background: c }}
                aria-label={`color ${c}`}
                onClick={() => setColor(c)}
              />
            ))}
            {SIZES.map((sz) => (
              <button
                key={sz}
                type="button"
                className={`draw-size ${sz === size ? 'sel' : ''}`}
                aria-label={`grosor ${sz}`}
                onClick={() => setSize(sz)}
              >
                <span style={{ width: sz + 2, height: sz + 2 }} />
              </button>
            ))}
            <button type="button" className="draw-btn" title="Borrar todo" onClick={clear}>
              🗑
            </button>
          </>
        )}
      </div>
    </div>
  );
}
