import { useEffect, useState } from 'react';
import { fetchExposicion, type Exposicion } from './api';

/**
 * Aviso de exposición correlacionada.
 *
 * Cuando el sistema enseña COMPRAR en ETH, SOL y BNB a la vez, parecen tres oportunidades. Medido,
 * esos activos correlacionan entre 0,69 y 0,81: son **una y media**. Ese es el dato que hace falta
 * para decidir cuánto arriesgar, y hasta ahora no estaba en ninguna pantalla.
 *
 * Es un aviso, no un veto: la plataforma no ejecuta órdenes y las señales se muestran igual.
 */
export function ExposicionPanel({ interval }: { interval: string }) {
  const [exp, setExp] = useState<Exposicion | null>(null);

  useEffect(() => {
    let vivo = true;
    const cargar = () => {
      void fetchExposicion(interval).then((e) => {
        if (vivo) setExp(e);
      });
    };
    cargar();
    // Cadencia holgada: recorre todos los activos, y el dato cambia despacio.
    const t = setInterval(cargar, 60_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [interval]);

  if (!exp || exp.direccion === null) return null;

  const n = exp.simbolos.length;
  // Con una sola señal no hay nada que avisar: una apuesta es una apuesta.
  if (n < 2) return null;

  const efectivas = exp.apuestasEfectivas;
  const verbo = exp.direccion === 'LONG' ? 'compra' : 'venta';

  // Sin medición se dice que no se sabe, en vez de enseñar un descuento inventado.
  if (!exp.medido) {
    return (
      <div className="exposicion exp-neutra">
        <strong>
          {n} señales de {verbo} a la vez
        </strong>
        <p>
          Todavía no hay medición de correlación entre estos activos, así que no se puede decir
          cuántas apuestas distintas son.
        </p>
      </div>
    );
  }

  const ahorro = 1 - efectivas / n;
  const nivel = ahorro >= 0.5 ? 'exp-alta' : ahorro >= 0.25 ? 'exp-media' : 'exp-baja';

  return (
    <div className={`exposicion ${nivel}`}>
      <div className="exp-cabecera">
        <strong>
          {n} señales de {verbo} · ≈ {efectivas.toFixed(1)} apuestas
        </strong>
        <span className="exp-simbolos">{exp.simbolos.join(' · ')}</span>
      </div>

      <div className="exp-barra" aria-hidden>
        <div className="exp-barra-fondo">
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="exp-hueco" />
          ))}
        </div>
        <div className="exp-barra-real" style={{ width: `${(efectivas / n) * 100}%` }} />
      </div>

      <p className="exp-explica">
        {ahorro >= 0.25 ? (
          <>
            Estas {n} señales <strong>no son {n} oportunidades independientes</strong>: estos activos
            se mueven juntos, así que arriesgar en todas equivale a{' '}
            <strong>una apuesta de tamaño {efectivas.toFixed(1)}</strong>, no de tamaño {n}.
            {exp.parMasRedundante ? (
              <>
                {' '}
                Los más parecidos son <strong>{exp.parMasRedundante.a}</strong> y{' '}
                <strong>{exp.parMasRedundante.b}</strong> (correlación{' '}
                {exp.parMasRedundante.correlacion.toFixed(2)}).
              </>
            ) : null}
          </>
        ) : (
          <>
            Estos activos se mueven bastante por su cuenta, así que las {n} señales sí aportan
            diversificación real.
          </>
        )}
      </p>

      <div className="exp-nota">
        Es un aviso, no un veto: las señales siguen siendo las mismas. Decidir cuánto arriesgar sigue
        siendo cosa tuya — esto solo pone el número que faltaba.
      </div>
    </div>
  );
}
