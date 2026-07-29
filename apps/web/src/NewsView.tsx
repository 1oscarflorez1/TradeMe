interface Release {
  version: string;
  date: string;
  title: string;
  added?: string[];
  changed?: string[];
  fixed?: string[];
}

/** Novedades visibles para el equipo (resumen del CHANGELOG en lenguaje claro). */
const RELEASES: Release[] = [
  {
    version: '0.21.0',
    date: '2026-07',
    title: 'Centro de ayuda, Laboratorio y Estado del sistema',
    added: [
      'Nueva pestaña **Centro de ayuda**: manual paso a paso, base de conocimientos, preguntas frecuentes y glosario (de lo básico a lo técnico).',
      'Nueva pestaña **Laboratorio**: reúne calibración, optimización de pesos, dataset ML y piloto automático — todo lo de "afinar" en un sitio.',
      'Nueva pestaña **Estado del sistema**: comprueba en vivo API, base de datos, datos de mercado, servicio quant, push y webhook.',
      'Nueva pestaña **Novedades** (esta): historial de cambios en lenguaje claro.',
    ],
    changed: [
      'La barra de temporalidades muestra primero el rango que realmente usamos (15m–1d); el resto sigue accesible deslizando.',
      'La pestaña Backtest queda centrada en medir: métricas, curva de equity, informe y metodología.',
    ],
  },
  {
    version: '0.20.0',
    date: '2026-07',
    title: 'Meta-modelo con aprendizaje continuo y calibración automática',
    added: [
      'El **meta-modelo** aprende de tus registros evaluados a filtrar señales poco fiables; se reentrena solo cada 12 h.',
      'Botón **🧠 Entrenar ahora** con resultado (AUC, umbral, expectancy antes/después).',
      'Los snapshots guardan también el voto de Supertrend.',
    ],
    changed: [
      'El piloto **recalibra** siempre tras promocionar parámetros nuevos y por mantenimiento periódico.',
    ],
  },
  {
    version: '0.19.0',
    date: '2026-07',
    title: 'Piloto automático',
    added: [
      'El **🤖 piloto** mide cada pocas horas, evalúa registros, optimiza solo cuando toca y avisa por la campana.',
      'Política configurable desde la interfaz (frecuencias, cooldown, temporalidades).',
      'Confirmación al pulsar ▶ y ⚙, explicando cómo interfieren con el piloto.',
    ],
    fixed: ['Los mensajes de ⚙ ahora distinguen "promovido" de "no promovido".'],
  },
  {
    version: '0.18.0',
    date: '2026-07',
    title: 'Parámetros por temporalidad y Registros filtrables',
    added: [
      'Filtros por temporalidad, acción, dirección y estado en Registros, con orden por columnas.',
    ],
    fixed: [
      'Cada temporalidad guarda **su propia** configuración optimizada (antes se sobrescribían).',
      'El backtest mide con la misma configuración que opera en vivo.',
      'Los contadores de Registros ya no se quedaban congelados en 50.',
    ],
  },
  {
    version: '0.17.0',
    date: '2026-07',
    title: 'Dataset ML y despliegue',
    added: [
      'Tarjeta **Dataset ML** con el veredicto de preparación para entrenar.',
      'Guías de despliegue gratuito para el equipo.',
    ],
  },
  {
    version: '0.16.0',
    date: '2026-07',
    title: 'Acceso del equipo',
    added: ['Inicio de sesión con usuarios propios; la plataforma queda protegida.'],
  },
  {
    version: '0.15.0',
    date: '2026-07',
    title: 'Supertrend y ADX continuo',
    added: ['Indicador **Supertrend**: el ensemble queda equilibrado 3 tendencia vs 3 reversión.'],
    changed: [
      'El ADX deja de ser un interruptor y pasa a **modular de forma continua** el peso de cada familia de indicadores.',
    ],
  },
  {
    version: '0.12.0',
    date: '2026-07',
    title: 'App instalable y notificaciones',
    added: [
      'TradeMe se instala como app (PWA) y envía notificaciones aunque esté cerrada.',
      'Centro de alertas con historial.',
    ],
  },
];

function bold(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

export function NewsView() {
  return (
    <section className="panel registros">
      <div className="reg-head">
        <h2>Novedades</h2>
        <p className="reg-intro">
          Qué ha cambiado en TradeMe, de lo más reciente a lo más antiguo. Versión actual:{' '}
          <strong>{RELEASES[0]!.version}</strong>.
        </p>
      </div>

      <div className="news-list">
        {RELEASES.map((r) => (
          <article key={r.version} className="news-item">
            <div className="news-head">
              <span className="news-version">v{r.version}</span>
              <strong>{r.title}</strong>
              <span className="muted news-date">{r.date}</span>
            </div>
            {r.added && (
              <div className="news-group">
                <span className="news-tag tag-added">Nuevo</span>
                <ul>
                  {r.added.map((x) => (
                    <li key={x}>{bold(x)}</li>
                  ))}
                </ul>
              </div>
            )}
            {r.changed && (
              <div className="news-group">
                <span className="news-tag tag-changed">Mejorado</span>
                <ul>
                  {r.changed.map((x) => (
                    <li key={x}>{bold(x)}</li>
                  ))}
                </ul>
              </div>
            )}
            {r.fixed && (
              <div className="news-group">
                <span className="news-tag tag-fixed">Corregido</span>
                <ul>
                  {r.fixed.map((x) => (
                    <li key={x}>{bold(x)}</li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
