import { useMemo, useState } from 'react';

interface Release {
  version: string;
  /** Fecha y hora exacta del commit que cerró la versión. */
  fecha: string;
  hito?: string;
  title: string;
  /** Una línea: es lo que permite decidir si merece la pena desplegar. */
  resumen: string;
  added?: string[];
  changed?: string[];
  fixed?: string[];
  /** Segundo nivel: el porqué, para quien quiera entender la decisión de fondo. */
  detalle?: string[];
}

/**
 * Historial completo, del primer commit a hoy.
 *
 * Tres niveles de lectura: la fila da la versión, la fecha exacta y una frase; el primer
 * despliegue muestra los cambios; el segundo, el porqué de las decisiones. Nadie tiene que leer
 * más de lo que le interesa.
 */
const RELEASES: Release[] = [
  {
    version: '0.28.0',
    fecha: '2026-08-04T00:30',
    title: 'Los números dicen la verdad y las pestañas se leen',
    resumen: 'Se corrige un recuento que inflaba los resultados y se rehacen Ayuda, Novedades, Backtest y Laboratorio.',
    added: [
      '**Veredicto en Registros**: la app te dice ahora si el sistema tiene ventaja, comparando tu acierto real con el mínimo que necesitas (33,3 % con objetivo al doble del stop).',
      '**Evolución entre backtests**: se ve si cada corrida mantiene o pierde la ventaja, no solo la última cifra.',
      '**Barra de temporalidades con botones**: cada temporalidad muestra si el motor la captura sola, si tiene pesos propios y si hay backtest guardado.',
      'Centro de ayuda rediseñado: entrada por tarea, búsqueda que atraviesa todas las secciones y artículos con resumen y tiempo de lectura.',
    ],
    fixed: [
      '**El resumen de Registros contaba mal.** El mismo registro podía sumar a la vez en «En curso» y en «SL», y los totales no cuadraban.',
      'Las cifras se calculaban sobre las 500 filas cargadas, no sobre todos los registros. Ahora se calculan en la base de datos.',
      'Espacios irregulares dentro de las secciones del Laboratorio.',
    ],
    changed: [
      'Backtest y Laboratorio ocupan todo el ancho: la guía lateral se mudó al Centro de ayuda.',
      'La columna «Estado» muestra el resultado real evaluado; el seguimiento en vivo queda solo para las operaciones abiertas.',
    ],
    detalle: [
      'El fallo del recuento era conceptual, no un descuido de programación: mezclábamos **dónde está el precio ahora** con **cómo acabó la operación**. Lo primero lo calcula la API comparando el precio actual con los niveles; lo segundo lo calcula el evaluador de quant recorriendo las velas posteriores con la regla del primer toque.',
      'La consecuencia era que una operación que tocó su objetivo hace tres días volvía a aparecer como «en curso» si el precio regresaba al medio. La historia se borraba en cada refresco.',
      'Importante: **el aprendizaje nunca estuvo afectado.** El dataset del meta-modelo y el entrenamiento siempre usaron el resultado evaluado, no el seguimiento en vivo. Lo que estaba mal era la pantalla.',
      'Ahora el estado lo decide el servidor con una regla única y los tres estados cerrados (objetivo, stop, por tiempo) son excluyentes entre sí, con pruebas que lo garantizan.',
    ],
  },
  {
    version: '0.27.0',
    fecha: '2026-07-31T16:11',
    title: 'Más allá del cripto: acciones, divisas e índices',
    resumen: 'Una capa de proveedores donde Binance deja de ser un supuesto y pasa a ser uno más.',
    added: [
      '**Nuevos mercados**: acciones, divisas, índices y ETF, con filtro por clase de activo en el gestor.',
      '**Insignias de fuente**: ⚡ tiempo real (streaming) frente a ⏱ consulta periódica.',
      'Panel de proveedores en Estado del sistema.',
      'El gráfico de TradingView abre el mercado correcto de cada activo, no solo pares de cripto.',
    ],
    changed: [
      'Para acciones y divisas hace falta una clave gratuita de Twelve Data. Sin ella no se rompe nada: el proveedor aparece como «sin configurar».',
    ],
    detalle: [
      'La pieza central es `PollingProvider`: las fuentes de acciones no ofrecen streaming gratuito, así que TradeMe consulta con una cadencia derivada de la temporalidad (aproximadamente un cuarto de vela), con presupuesto de peticiones por minuto y por día para no agotar el plan gratuito.',
      'El resto del motor no nota la diferencia porque todos los proveedores entregan exactamente el mismo objeto de vela, validado por el mismo esquema. Por eso la suite de paridad siguió en verde sin tocar una línea de la matemática.',
      'Se documentó también por qué TradingView no puede ser proveedor de datos: no publica API de velas para terceros y sus feeds internos son privados.',
    ],
  },
  {
    version: '0.26.0',
    fecha: '2026-07-31T12:34',
    title: 'Multi-activo y visualizaciones del motor',
    resumen: 'Cualquier activo, no solo Bitcoin, y medidores que hacen visible lo que hace el sistema.',
    added: [
      '**Buscar y añadir activos** desde la barra superior. El motor se suscribe al instante.',
      'Pausar o quitar activos sin perder su historial.',
      '**Gráficos y medidores** en el Laboratorio: progreso del dataset, comparativa de la optimización, estado de calibración y frescura del piloto.',
    ],
    detalle: [
      'La suscripción es «en caliente»: al añadir un activo, el motor siembra su histórico, abre el flujo de velas y el piloto lo incluye en su siguiente ciclo, sin reiniciar nada.',
      'Cada activo entrena su propia estrategia por temporalidad, así que añadir muchos multiplica el trabajo del piloto. Conviene empezar por dos o tres líquidos.',
    ],
  },
  {
    version: '0.25.0',
    fecha: '2026-07-31T11:16',
    hito: 'M10',
    title: 'El sistema captura decisiones por su cuenta',
    resumen: 'Los registros dejan de depender de que alguien tenga el portal abierto.',
    added: [
      '**Captura automática en el servidor**: se registran las decisiones operables aunque nadie mire.',
      '**Registro de accesos** persistente, con los intentos fallidos.',
      'Freno general de peticiones por IP.',
      'Foco visible al navegar con teclado y respeto por «reducir movimiento».',
    ],
    detalle: [
      'Hasta esta versión los registros solo nacían en el navegador. Si nadie abría el portal, el dataset del meta-modelo no crecía — que es exactamente lo que había pasado: se quedó congelado en 289 registros durante días.',
    ],
  },
  {
    version: '0.24.0',
    fecha: '2026-07-31T09:24',
    hito: 'M10',
    title: 'Seguridad del acceso e interfaz móvil',
    resumen: 'Protección contra fuerza bruta en el login y la app usable desde el teléfono.',
    added: [
      '**Protección contra fuerza bruta**: cinco intentos por ventana y bloqueo creciente.',
      'Cabeceras de seguridad en todas las respuestas.',
      'Diseño adaptado a móvil en todas las pestañas.',
    ],
  },
  {
    version: '0.23.0',
    fecha: '2026-07-29T18:24',
    hito: 'Módulo 2',
    title: 'El filtro de aprendizaje asciende solo',
    resumen: 'El meta-modelo gana o pierde autoridad según su rendimiento real, sin intervención.',
    added: [
      'Ascenso automático de modo: observa → modula → puede vetar, y retrocede si empeora.',
      'Política guardada como artefacto, con su historial de decisiones.',
    ],
    detalle: [
      'Los umbrales son deliberadamente conservadores: para pasar de observar a modular hacen falta al menos 40 decisiones evaluadas, una mejora demostrada y capacidad de discriminación por encima del azar. Para llegar a vetar, más de 100.',
      'La variable de entorno actúa como techo: si dice «modular», el sistema nunca llegará a vetar aunque los datos lo justifiquen. La automatización nunca puede superar el permiso humano.',
    ],
  },
  {
    version: '0.22.0',
    fecha: '2026-07-28T20:33',
    hito: 'Módulo 2',
    title: 'El meta-modelo funciona en vivo sin dependencias nativas',
    resumen: 'El bosque entrenado en Python se evalúa directamente en Node, en milisegundos.',
    added: ['Bosque exportado como JSON plano y evaluado en el motor en vivo.'],
    detalle: [
      'La alternativa habitual era ejecutar el modelo con una biblioteca nativa dentro de Node, que es frágil de instalar y de mantener. Exportar el bosque como estructura de datos plana y recorrerlo a mano resultó ser más simple, más rápido y verificable con vectores de paridad.',
    ],
  },
  {
    version: '0.21.0',
    fecha: '2026-07-28T14:13',
    title: 'Centro de ayuda, Laboratorio, Novedades y Estado',
    resumen: 'La información teórica sale del código y se organiza en pestañas propias.',
    added: [
      'Centro de ayuda con manual, base de conocimientos, preguntas frecuentes y glosario.',
      'Laboratorio: todo lo que afina el modelo, en un sitio.',
      'Novedades y Estado del sistema.',
    ],
  },
  {
    version: '0.20.0',
    fecha: '2026-07-27T15:18',
    hito: 'Módulo 2',
    title: 'Meta-modelo con reentrenamiento continuo',
    resumen: 'Un segundo modelo aprende cuándo NO fiarse de la decisión principal.',
    added: [
      'Entrenamiento periódico sobre las decisiones ya evaluadas.',
      'Calibración automatizada tras cada promoción.',
    ],
    detalle: [
      'Es meta-etiquetado: el modelo no decide la dirección, solo estima la probabilidad de que la decisión del ensemble acabe bien. Separar «qué hacer» de «cuánto fiarse» permite mejorar lo segundo sin desestabilizar lo primero.',
    ],
  },
  {
    version: '0.19.0',
    fecha: '2026-07-27T08:38',
    title: 'Piloto automático',
    resumen: 'El sistema mide, optimiza y recalibra solo, y avisa cuando algo cambia.',
    added: [
      'Ciclos automáticos de medición, optimización y calibración.',
      'Alertas cuando el piloto promociona una configuración o detecta degradación.',
    ],
    detalle: [
      'La regla no es «optimizar cada X días» sino «optimizar cuando haga falta»: por mantenimiento programado o porque dos mediciones seguidas con muestra suficiente salieron negativas. Con un periodo de espera entre optimizaciones para no perseguir ruido.',
    ],
  },
  {
    version: '0.18.0',
    fecha: '2026-07-24T20:15',
    hito: 'Módulo 1',
    title: 'Supertrend y equilibrio de indicadores',
    resumen: 'Se añade Supertrend para equilibrar tres indicadores de tendencia contra tres de reversión.',
    added: ['Indicador Supertrend(10,3).'],
    changed: ['El ensemble pasa a estar equilibrado: 3 de tendencia frente a 3 de reversión.'],
    detalle: [
      'Antes había más indicadores de reversión que de tendencia, lo que sesgaba el sistema a buscar giros en mercados que en realidad estaban en tendencia. Equilibrar las familias fue más eficaz que retocar pesos.',
    ],
  },
  {
    version: '0.17.0',
    fecha: '2026-07-24T17:05',
    hito: 'Módulo 1',
    title: 'ADX continuo',
    resumen: 'El régimen deja de ser una etiqueta con saltos y pasa a ser una escala suave.',
    changed: [
      'El paso de «rango» a «tendencia» se interpola en vez de saltar de golpe.',
      'Estructura preparada para el sesgo macro por temporalidad, desactivada por bandera.',
    ],
    detalle: [
      'Con umbrales duros, un ADX de 24,9 y otro de 25,1 producían decisiones muy distintas pese a ser casi el mismo mercado. La interpolación continua elimina ese salto artificial.',
    ],
  },
  {
    version: '0.16.0',
    fecha: '2026-07-22T18:54',
    title: 'Modo solo-técnico y afinado',
    resumen: 'Se apaga el sesgo macro para que backtest y vivo midan exactamente lo mismo.',
    changed: [
      'El sesgo macro queda desactivado a propósito, a la espera del análisis fundamental completo.',
    ],
    detalle: [
      'Mientras el macro solo estuviera disponible en vivo y no en el histórico, backtest y tiempo real medían cosas distintas. Apagarlo hizo comparables las dos mitades del sistema.',
    ],
  },
  {
    version: '0.12.0',
    fecha: '2026-07-19T19:08',
    hito: 'M9',
    title: 'App instalable y avisos en segundo plano',
    resumen: 'TradeMe se instala como aplicación y avisa aunque esté cerrada.',
    added: ['Instalable en móvil y escritorio.', 'Notificaciones push reales con la app cerrada.'],
  },
  {
    version: '0.11.0',
    fecha: '2026-07-19T18:18',
    hito: 'M8',
    title: 'Centro de alertas',
    resumen: 'Avisos con historial y reglas configurables, sin vigilar la pantalla.',
    added: ['Campana con historial persistente.', 'Reglas y tiempo de espera configurables.'],
  },
  {
    version: '0.10.0',
    fecha: '2026-07-19T14:15',
    title: 'Fase presentación',
    resumen: 'El Panel cabe en una pantalla y el gráfico se puede anotar a mano.',
    added: [
      'Temporalidad mensual y barra deslizable.',
      'Capa de dibujo sobre el gráfico.',
      'Gráfico reconstruido del momento de cada registro.',
    ],
  },
  {
    version: '0.9.0',
    fecha: '2026-07-18T20:33',
    hito: 'M7',
    title: 'Optimización con Optuna',
    resumen: 'Los pesos dejan de elegirse a mano: se buscan y solo se aceptan si ganan fuera de muestra.',
    added: ['Búsqueda de pesos, régimen y umbrales.', 'Validación walk-forward.'],
    detalle: [
      'La promoción exige ganar en un tramo que la optimización no vio. Sin esa regla, optimizar es memorizar el pasado.',
    ],
  },
  {
    version: '0.8.0',
    fecha: '2026-07-18T16:26',
    hito: 'M7',
    title: 'Calibración de probabilidades',
    resumen: 'Que un 70 % de confianza signifique de verdad acertar siete de cada diez veces.',
    added: ['Calibración isotónica y de Platt, elegida por régimen.'],
  },
  {
    version: '0.7.0',
    fecha: '2026-07-17T09:20',
    hito: 'M6',
    title: 'Backtesting honesto',
    resumen: 'Prueba histórica sin mirar al futuro y suponiendo siempre el peor caso.',
    added: ['Motor de backtest con métricas y curva de equity.', 'Reserva del 30 % final sin tocar.'],
    detalle: [
      'Dos decisiones incómodas y deliberadas: no usar información que no existía en ese momento, y suponer que si una vela pudo tocar tanto el stop como el objetivo, tocó el stop. Los resultados salen más feos y más ciertos.',
    ],
  },
  {
    version: '0.6.0',
    fecha: '2026-07-16T22:26',
    hito: 'M5.6',
    title: 'Registros y validez del plan',
    resumen: 'Cada decisión guardada se sigue hacia adelante y caduca si no se opera a tiempo.',
    added: ['Pestaña Registros.', 'Validez temporal del plan de entrada.'],
  },
  {
    version: '0.5.5',
    fecha: '2026-07-14T21:41',
    hito: 'M5.5',
    title: 'Dirección, sesgo macro y snapshots',
    resumen: 'La decisión gana dirección (al alza, a la baja o fuera) y empieza a guardarse para aprender.',
    added: ['Sesgo macro.', 'Tabla de snapshots: el dataset con el que se entrena.'],
  },
  {
    version: '0.5.0',
    fecha: '2026-07-10T17:41',
    hito: 'M5',
    title: 'TradingView y las señales Reditum',
    resumen: 'Los algoritmos privados entran como un voto más a través de un webhook.',
    added: ['Webhook de alertas.', 'Widget de gráfico de TradingView.'],
    changed: ['Se retira por completo la integración anterior con NinjaTrader.'],
    detalle: [
      'Ningún código propietario vive en el repositorio: solo se mapean las salidas de las alertas a un voto, mediante configuración.',
    ],
  },
  {
    version: '0.4.0',
    fecha: '2026-07-08T13:59',
    hito: 'M4',
    title: 'Plan de acción',
    resumen: 'La decisión se traduce a números concretos: entrada, stop, objetivo y tamaño.',
    added: ['Niveles calculados con ATR y tamaño por porcentaje de riesgo.'],
  },
  {
    version: '0.3.0',
    fecha: '2026-07-07T13:45',
    hito: 'M3',
    title: 'La primera decisión',
    resumen: 'Los votos de los indicadores se combinan en COMPRAR, MANTENER o VENDER con su confianza.',
    added: ['Ensemble ponderado por régimen.', 'Panel con anillo de confianza.', 'Siete temporalidades.'],
  },
  {
    version: '0.2.0',
    fecha: '2026-07-06T21:15',
    hito: 'M2',
    title: 'Indicadores y la suite de paridad',
    resumen: 'Ocho indicadores votando, y la garantía de que Node y Python calculan lo mismo.',
    added: ['Motor de indicadores.', 'Vectores de paridad y tercer trabajo de integración continua.'],
    detalle: [
      'La suite de paridad es la pieza que sostiene todo lo demás: si el motor en vivo y el laboratorio no calcularan idéntico, cualquier backtest sería una ficción. Se comprueba en cada cambio, automáticamente.',
    ],
  },
  {
    version: '0.1.0',
    fecha: '2026-07-02T08:04',
    hito: 'M1',
    title: 'Velas en vivo',
    resumen: 'Datos de mercado reales entrando en tiempo real, con reconexión y sin huecos.',
    added: ['Conexión a Binance con reconexión automática.', 'Gráfico de velas en vivo.'],
  },
  {
    version: '0.0.1',
    fecha: '2026-06-29T23:36',
    hito: 'M0',
    title: 'El primer día',
    resumen: 'El esqueleto: monorepo, los tres servicios, base de datos e integración continua.',
    added: [
      'Monorepo con api (Node), quant (Python) y web (React).',
      'TimescaleDB, Redis y Docker Compose.',
      'Integración continua con trabajos separados de Node y Python.',
    ],
  },
];

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function formatea(iso: string): { dia: string; hora: string; largo: string } {
  const d = new Date(iso);
  return {
    dia: `${d.getDate()} ${MESES[d.getMonth()]}`,
    hora: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
    largo: d.toLocaleString('es', { dateStyle: 'full', timeStyle: 'short' }),
  };
}

/** Convierte **negrita** en <strong> sin meter una librería de markdown por tan poco. */
function Texto({ children }: { children: string }) {
  const partes = children.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith('**') && p.endsWith('**') ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function Bloque({ titulo, items, clase }: { titulo: string; items?: string[]; clase: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`nv-bloque ${clase}`}>
      <span className="nv-bloque-h">{titulo}</span>
      <ul>
        {items.map((x, i) => (
          <li key={i}>
            <Texto>{x}</Texto>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function NewsView() {
  const [abierta, setAbierta] = useState<string | null>(RELEASES[0]!.version);
  const [detalle, setDetalle] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [soloConDetalle, setSoloConDetalle] = useState(false);

  const lista = useMemo(() => {
    const busca = q.trim().toLowerCase();
    return RELEASES.filter((r) => {
      if (soloConDetalle && !r.detalle) return false;
      if (!busca) return true;
      const texto = [r.version, r.title, r.resumen, r.hito ?? '', ...(r.added ?? []), ...(r.changed ?? []), ...(r.fixed ?? [])]
        .join(' ')
        .toLowerCase();
      return texto.includes(busca);
    });
  }, [q, soloConDetalle]);

  const primera = formatea(RELEASES[RELEASES.length - 1]!.fecha);
  const ultima = formatea(RELEASES[0]!.fecha);

  return (
    <section className="panel registros">
      <div className="reg-head">
        <h2>Novedades</h2>
        <p className="reg-intro">
          Todo lo que ha cambiado, de lo más reciente a lo más antiguo. Cada versión se despliega dos
          veces: la primera muestra <strong>qué</strong> cambió; la segunda, <strong>por qué</strong>{' '}
          se hizo así.
        </p>
      </div>

      <div className="reg-summary">
        <span className="reg-chip">
          Versiones <strong>{RELEASES.length}</strong>
        </span>
        <span className="reg-chip" title={`Primera versión: ${primera.largo}`}>
          Desde <strong>{primera.dia}</strong>
        </span>
        <span className="reg-chip" title={`Última versión: ${ultima.largo}`}>
          Última <strong>{ultima.dia} · {ultima.hora}</strong>
        </span>
        <button
          type="button"
          className={`reg-chip nv-filtro ${soloConDetalle ? 'on' : ''}`}
          onClick={() => setSoloConDetalle((v) => !v)}
          title="Solo las versiones que traen una explicación de fondo"
        >
          {soloConDetalle ? '✓ ' : ''}Con explicación
        </button>
      </div>

      <input
        className="help-search help-search-big"
        placeholder="Buscar en el historial: calibración, snapshots, seguridad, proveedores…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {lista.length === 0 ? (
        <p className="muted">Nada coincide con «{q}».</p>
      ) : (
        <ol className="nv-linea">
          {lista.map((r) => {
            const f = formatea(r.fecha);
            const ab = abierta === r.version;
            const det = detalle === r.version;
            return (
              <li key={r.version} className={`nv-item ${ab ? 'open' : ''}`}>
                <span className="nv-punto" aria-hidden />
                <button
                  type="button"
                  className="nv-head"
                  aria-expanded={ab}
                  onClick={() => {
                    setAbierta(ab ? null : r.version);
                    if (ab) setDetalle(null);
                  }}
                >
                  <span className="nv-ver">
                    v{r.version}
                    {r.hito && <span className="nv-hito">{r.hito}</span>}
                  </span>
                  <span className="nv-txt">
                    <strong>{r.title}</strong>
                    <span className="nv-res">{r.resumen}</span>
                  </span>
                  <span className="nv-fecha" title={f.largo}>
                    <span>{f.dia}</span>
                    <span className="muted">{f.hora}</span>
                  </span>
                  <span className="nv-chev" aria-hidden>
                    {ab ? '▴' : '▾'}
                  </span>
                </button>

                {ab && (
                  <div className="nv-cuerpo">
                    <Bloque titulo="Novedades" items={r.added} clase="nv-add" />
                    <Bloque titulo="Cambios" items={r.changed} clase="nv-chg" />
                    <Bloque titulo="Correcciones" items={r.fixed} clase="nv-fix" />

                    {r.detalle && (
                      <>
                        <button
                          type="button"
                          className="nv-mas"
                          aria-expanded={det}
                          onClick={() => setDetalle(det ? null : r.version)}
                        >
                          {det ? '▴ Ocultar el porqué' : '▾ ¿Por qué se hizo así?'}
                        </button>
                        {det && (
                          <div className="nv-detalle">
                            {r.detalle.map((x, i) => (
                              <p key={i}>
                                <Texto>{x}</Texto>
                              </p>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <p className="muted calib-legend">
        Las fechas y horas son las del cambio real en el repositorio, no aproximaciones. Si algo de lo
        que ves aquí no coincide con lo que hace la app, es que falta desplegar la última versión.
      </p>
    </section>
  );
}
