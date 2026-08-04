import { useEffect, useRef, useState } from 'react';
import { fetchTimeframeUsage } from './api';
import type { Interval } from './types';
import type { TimeframeUsage } from './api';

/** Qué significa cada distintivo. Se explica una sola vez, en el propio panel desplegable. */
const MARCAS: Array<{ id: keyof Pick<TimeframeUsage, 'captura' | 'optimizado' | 'backtest'>; icono: string; nombre: string; que: string }> = [
  {
    id: 'captura',
    icono: '●',
    nombre: 'Captura automática',
    que: 'El motor guarda registros de esta temporalidad por su cuenta, aunque nadie tenga el portal abierto.',
  },
  {
    id: 'optimizado',
    icono: '◆',
    nombre: 'Pesos optimizados',
    que: 'Tiene una configuración propia hallada por Optuna, en vez de usar la base común.',
  },
  {
    id: 'backtest',
    icono: '▮',
    nombre: 'Backtest guardado',
    que: 'Hay una prueba histórica guardada para esta temporalidad.',
  },
];

/**
 * Barra de temporalidades.
 *
 * Antes era una tira deslizable: si tu pantalla no daba para todas, las de más a la izquierda
 * quedaban escondidas sin ninguna pista de que existían. Ahora se mueve con dos botones y cada
 * temporalidad muestra en qué procesos participa, de modo que se ve de un vistazo dónde está
 * trabajando de verdad el sistema.
 */
export function TimeframeBar({
  intervals,
  tf,
  setTf,
  symbol,
  alertaEn,
  tituloDe,
}: {
  intervals: Interval[];
  tf: Interval;
  setTf: (i: Interval) => void;
  symbol: string;
  alertaEn: (i: Interval) => boolean;
  tituloDe: (i: Interval) => string;
}) {
  const pistaRef = useRef<HTMLDivElement>(null);
  const [usage, setUsage] = useState<Record<string, TimeframeUsage>>({});
  const [leyenda, setLeyenda] = useState(false);
  const [puedeIzq, setPuedeIzq] = useState(false);
  const [puedeDer, setPuedeDer] = useState(false);

  useEffect(() => {
    if (!symbol) return;
    let cancelado = false;
    const cargar = () =>
      void fetchTimeframeUsage(symbol).then((u) => {
        if (!cancelado) setUsage(Object.fromEntries(u.map((x) => [x.interval, x])));
      });
    cargar();
    const id = setInterval(cargar, 60_000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [symbol]);

  const revisarBordes = () => {
    const el = pistaRef.current;
    if (!el) return;
    setPuedeIzq(el.scrollLeft > 2);
    setPuedeDer(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  };

  useEffect(() => {
    revisarBordes();
    const el = pistaRef.current;
    if (!el) return;
    const obs = new ResizeObserver(revisarBordes);
    obs.observe(el);
    return () => obs.disconnect();
  }, [intervals]);

  // Al cambiar de temporalidad, traer la seleccionada a la vista.
  useEffect(() => {
    const el = pistaRef.current;
    const btn = el?.querySelector<HTMLElement>(`[data-tf="${tf}"]`);
    if (el && btn) {
      const centro = btn.offsetLeft - el.offsetLeft - el.clientWidth / 2 + btn.clientWidth / 2;
      el.scrollTo({ left: Math.max(0, centro), behavior: 'smooth' });
    }
    revisarBordes();
  }, [tf, intervals]);

  /** Salta a la temporalidad anterior o siguiente de la lista. */
  const mover = (paso: -1 | 1) => {
    const i = intervals.indexOf(tf);
    const siguiente = intervals[Math.min(intervals.length - 1, Math.max(0, i + paso))];
    if (siguiente && siguiente !== tf) setTf(siguiente);
  };

  const i = intervals.indexOf(tf);
  const activas = intervals.filter((x) => usage[x]?.captura).length;

  return (
    <div className="tfbar">
      <button
        type="button"
        className="tfbar-nav"
        onClick={() => mover(-1)}
        disabled={i <= 0}
        aria-label="Temporalidad anterior"
        title="Temporalidad anterior"
      >
        ‹
      </button>

      <div
        className="tfbar-track"
        ref={pistaRef}
        role="group"
        aria-label="Temporalidad"
        onScroll={revisarBordes}
      >
        {puedeIzq && <span className="tfbar-fade tfbar-fade-l" aria-hidden />}
        {intervals.map((it) => {
          const u = usage[it];
          return (
            <button
              key={it}
              type="button"
              data-tf={it}
              className={`tf ${it === tf ? 'active' : ''} ${u?.captura ? 'tf-viva' : ''}`}
              onClick={() => setTf(it)}
              aria-current={it === tf ? 'true' : undefined}
              title={
                `${tituloDe(it)}\n` +
                (u
                  ? `${u.registros} registros · ` +
                    MARCAS.filter((m) => u[m.id]).map((m) => m.nombre.toLowerCase()).join(' · ')
                  : '')
              }
            >
              <span className="tf-label">{it}</span>
              {u && (
                <span className="tf-marcas" aria-hidden>
                  {MARCAS.map((m) => (
                    <span key={m.id} className={`tf-marca ${u[m.id] ? 'on' : ''}`}>
                      {m.icono}
                    </span>
                  ))}
                </span>
              )}
              <span
                className={`tf-dot ${alertaEn(it) ? 'on' : ''}`}
                aria-label={alertaEn(it) ? 'alerta activa' : undefined}
              />
            </button>
          );
        })}
        {puedeDer && <span className="tfbar-fade tfbar-fade-r" aria-hidden />}
      </div>

      <button
        type="button"
        className="tfbar-nav"
        onClick={() => mover(1)}
        disabled={i >= intervals.length - 1}
        aria-label="Temporalidad siguiente"
        title="Temporalidad siguiente"
      >
        ›
      </button>

      <button
        type="button"
        className={`tfbar-info ${leyenda ? 'on' : ''}`}
        onClick={() => setLeyenda((v) => !v)}
        aria-expanded={leyenda}
        title="Qué significan las marcas de cada temporalidad"
      >
        ?
      </button>

      {leyenda && (
        <div className="tfbar-pop" role="dialog" aria-label="Leyenda de temporalidades">
          <div className="gear-head">Qué hace el sistema en cada temporalidad</div>
          {MARCAS.map((m) => (
            <div key={m.id} className="tfbar-leg">
              <span className="tf-marca on">{m.icono}</span>
              <div>
                <strong>{m.nombre}</strong>
                <p className="muted">{m.que}</p>
                <p className="tfbar-leg-tf">
                  {intervals.filter((x) => usage[x]?.[m.id]).join(' · ') || 'ninguna por ahora'}
                </p>
              </div>
            </div>
          ))}
          <p className="muted tfbar-foot">
            El punto de la derecha de cada botón se enciende cuando esa temporalidad supera su umbral
            de alerta. Hoy el motor captura solo en <strong>{activas}</strong>{' '}
            {activas === 1 ? 'temporalidad' : 'temporalidades'}.
          </p>
        </div>
      )}
    </div>
  );
}
