import { useEffect, useRef, useState } from 'react';
import {
  askAssistant,
  fetchAssistantInfo,
  fetchSignal,
  fetchSnapshots,
  fetchSustento,
  fetchSystemStatus,
  fetchTimeframeUsage,
} from './api';
import type { AssistantInfo, Sustento, SystemStatus, TimeframeUsage } from './api';
import type { Interval, Signal, SnapshotStats } from './types';

/** Lo que el asistente sabe del sistema en este instante. Se refresca al abrirlo. */
interface Contexto {
  symbol: string;
  interval: Interval;
  signal: Signal | null;
  stats: SnapshotStats | null;
  sustento: Sustento | null;
  estado: SystemStatus | null;
  usage: TimeframeUsage[];
}

interface Mensaje {
  de: 'yo' | 'bot';
  texto: string;
  /** De dónde salió la respuesta: el modelo o la base local. */
  fuente?: 'modelo' | 'local';
  /** Qué consultó el modelo para responder. Se muestra: nada de caja negra. */
  consultas?: string[];
}

const pct = (n: number | null | undefined, d = 0) =>
  n === null || n === undefined ? '—' : `${(n * 100).toFixed(d)}%`;

/**
 * Base de conocimiento del asistente.
 *
 * Cada entrada declara las palabras que la activan y compone su respuesta con el estado real de la
 * plataforma. Esa es la diferencia con un buscador: no cita documentación genérica, mira lo que el
 * motor está haciendo ahora mismo y responde con tus números.
 */
const TEMAS: Array<{
  claves: string[];
  responder: (c: Contexto) => string;
}> = [
  {
    claves: ['por que', 'porque', 'decision', 'decide', 'hold', 'mantener', 'ahora', 'senal', 'señal'],
    responder: (c) => {
      if (!c.signal) return 'Todavía no tengo la decisión en vivo cargada. Prueba en unos segundos.';
      const s = c.signal;
      const acc = s.action === 'BUY' ? 'COMPRAR' : s.action === 'SELL' ? 'VENDER' : 'MANTENER';
      const fuertes = [...s.votes]
        .filter((v) => Math.abs(v.value) > 0.2)
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 3)
        .map((v) => `${v.label} ${v.value >= 0 ? '+' : ''}${v.value.toFixed(2)}`);
      const banda = c.sustento?.holdBand ?? 0.06;
      const base =
        `En ${c.symbol} · ${c.interval} la decisión es ${acc} con ${pct(s.confidence)} de confianza. ` +
        `La inclinación combinada (net) es ${s.net.toFixed(3)} y el régimen detectado es ${s.regime.label} ` +
        `(ADX ${s.regime.adx.toFixed(1)}).`;
      const porque =
        s.action === 'HOLD'
          ? ` Sale MANTENER porque la inclinación no supera la banda neutra de ±${banda}: hay votos en ambos sentidos y ninguno domina lo suficiente. No es un fallo, es el sistema absteniéndose.`
          : ` Los indicadores que más empujan: ${fuertes.join(', ') || 'ninguno destaca'}.`;
      return base + porque + ' En la pestaña Sustento tienes el desglose completo.';
    },
  },
  {
    claves: ['sl', 'stop', 'perdida', 'pierde', 'mas sl', 'malo', 'ratio', 'acierto', 'win rate'],
    responder: (c) => {
      const s = c.stats;
      if (!s || s.tp + s.sl < 10) {
        return 'Aún no hay operaciones cerradas suficientes para juzgarlo. Con menos de una decena, cualquier conclusión sería ruido.';
      }
      const wr = s.winRate ?? 0;
      const veredicto = (s.expectancy ?? 0) > 0 ? 'tiene ventaja' : 'no tiene ventaja todavía';
      return (
        `Ver más stops que objetivos es lo esperado y no es malo por sí solo. TradeMe pone el objetivo al doble ` +
        `de distancia que el stop, así que basta con acertar más del 33,3 % para salir a cuenta.\n\n` +
        `En ${c.symbol} llevas ${s.tp} operaciones en objetivo y ${s.sl} en stop: ${pct(wr, 1)} de acierto, ` +
        `con una ganancia media de ${(s.expectancy ?? 0).toFixed(3)} R por operación. El sistema ${veredicto}.\n\n` +
        `Estas cifras no descuentan comisiones ni deslizamiento: medirlos es el objetivo de la futura cuenta de papel.`
      );
    },
  },
  {
    claves: ['expectancy', 'esperanza', 'r', 'metrica', 'metricas', 'profit factor', 'drawdown', 'sharpe'],
    responder: () =>
      'Las métricas, en el orden en que conviene mirarlas:\n\n' +
      '• **Expectancy** — ganancia media por operación en múltiplos de R. Una R es lo que arriesgas en cada entrada. Si es negativa, lo demás da igual.\n' +
      '• **Trades** — con menos de 30 no saques conclusiones, por buena que sea la expectancy.\n' +
      '• **Fuera de muestra** — la misma cifra sobre el 30 % final de los datos, que no influyó en el ajuste. Es la prueba de honestidad: si se desploma, el sistema memorizó el pasado.\n' +
      '• **Profit factor** — ganancias brutas entre pérdidas brutas. Por encima de 1 es rentable.\n' +
      '• **Max drawdown** — la peor racha acumulada. No mide si ganas, mide si podrías aguantarlo.',
  },
  {
    claves: ['calibracion', 'calibrar', 'probabilidad', 'confianza', 'isotonica', 'platt'],
    responder: () =>
      'La calibración responde a: cuando el sistema dice «70 % de confianza», ¿acierta de verdad el 70 % de las veces?\n\n' +
      'Se comparan las confianzas anunciadas con los resultados reales y se ajusta la escala, por régimen, con dos métodos (isotónica y Platt) eligiendo el que menor error de Brier tenga.\n\n' +
      'Importante: la calibración **no cambia la dirección** de la decisión, solo el número de confianza. Y si el sistema acierta poco, la confianza calibrada **bajará** — subirla sería mentir.',
  },
  {
    claves: ['optuna', 'optimizacion', 'optimizar', 'pesos', 'peso'],
    responder: (c) => {
      const opt = c.sustento?.optimizado;
      const base =
        'Optuna busca los pesos de cada indicador, los multiplicadores de régimen, la banda neutra y la temperatura, probando miles de combinaciones.\n\n' +
        'La regla que evita el autoengaño: una configuración candidata **solo se promociona si además gana en el tramo que la optimización no vio**. Sin eso, optimizar es memorizar el pasado.';
      return (
        base +
        `\n\nAhora mismo, ${c.symbol} · ${c.interval} usa ${opt ? 'una configuración **optimizada** propia de esta temporalidad' : 'la **configuración base** común'} (${c.sustento?.version ?? '—'}).`
      );
    },
  },
  {
    claves: ['meta', 'metamodelo', 'meta-modelo', 'ml', 'machine learning', 'aprendizaje', 'modelo'],
    responder: () =>
      'Hay **tres capas que aprenden**, no una:\n\n' +
      '1. **Optuna** aprende los pesos de los indicadores. Es la que de verdad ajusta el criterio.\n' +
      '2. **La calibración** aprende a traducir la inclinación en probabilidad real.\n' +
      '3. **El meta-modelo** aprende *cuándo no fiarse* de la decisión. Es un bosque aleatorio entrenado sobre las decisiones ya evaluadas; no decide la dirección, solo estima si la decisión acabará bien.\n\n' +
      'El meta-modelo asciende solo de modo: observa → modula → puede vetar, y retrocede si empeora. La variable de entorno actúa como techo: la automatización nunca supera el permiso humano.',
  },
  {
    claves: ['piloto', 'automatico', 'automático', 'solo', 'scheduler'],
    responder: (c) => {
      const q = c.estado?.components.find((x: { key: string }) => x.key.includes('quant'));
      return (
        'El piloto automático vive en el servicio quant. Mide cada pocas horas, optimiza por mantenimiento o si detecta degradación (dos mediciones seguidas en negativo con muestra suficiente), recalibra tras cada promoción y reentrena el meta-modelo.\n\n' +
        'Tiene un periodo de espera entre optimizaciones para no perseguir ruido.' +
        (q ? `\n\nEstado ahora: ${q.detail}` : '')
      );
    },
  },
  {
    claves: ['regimen', 'régimen', 'adx', 'tendencia', 'rango'],
    responder: (c) => {
      const s = c.signal;
      return (
        'El ADX mide la fuerza de la tendencia y decide cómo se reparten los pesos: en tendencia suben los indicadores de tendencia y momentum; en rango, los de reversión.\n\n' +
        'La transición es **continua**, no un salto: entre los umbrales bajo y alto los multiplicadores se interpolan. Antes, un ADX de 24,9 y otro de 25,1 producían decisiones muy distintas pese a ser casi el mismo mercado.' +
        (s ? `\n\nAhora: ADX ${s.regime.adx.toFixed(1)} → régimen ${s.regime.label}.` : '')
      );
    },
  },
  {
    claves: ['arquitectura', 'backend', 'node', 'python', 'como funciona', 'stack', 'servicios'],
    responder: () =>
      'TradeMe son tres piezas y un contrato:\n\n' +
      '• **apps/api** (Node 20 + Fastify) — aquí **nace la decisión**. Recibe las velas, calcula los indicadores, combina el ensemble, aplica calibración y meta-modelo, y emite la señal por WebSocket.\n' +
      '• **apps/quant** (Python 3.11 + FastAPI) — el **laboratorio**. Backtest, Optuna, calibración, meta-modelo y piloto automático. Publica artefactos que la api recarga en caliente.\n' +
      '• **apps/web** (React + Vite, PWA) — el portal.\n' +
      '• **packages/core-signals** — el contrato y los **vectores de paridad** que garantizan que Node y Python calculan exactamente lo mismo. Sin eso, cualquier backtest sería ficción.\n\n' +
      'Datos en TimescaleDB y Redis; todo en Docker Compose, publicado por Tailscale Funnel.',
  },
  {
    claves: ['proveedor', 'proveedores', 'binance', 'twelve', 'datos', 'velas', 'ibkr', 'interactive'],
    responder: (c) => {
      const p = c.estado?.components ?? [];
      const mercado = p.find((x: { key: string; label: string }) => x.key.includes('market') || x.label.toLowerCase().includes('mercado'));
      return (
        '**Binance** entrega cripto en tiempo real por WebSocket, gratis y sin clave. **Twelve Data** añade acciones, divisas e índices, pero su plan gratuito no tiene streaming: TradeMe consulta cada pocos minutos, así que en esos activos conviene usar 15m en adelante.\n\n' +
        '**Interactive Brokers** está planificado como tercer proveedor (Fase A) y, más adelante, como cuenta de papel para medir el deslizamiento real.\n\n' +
        '**TradingView no es un proveedor de datos**: dibuja el gráfico y envía las alertas Reditum, pero no publica API de velas para terceros.' +
        (mercado ? `\n\nAhora: ${mercado.detail}` : '')
      );
    },
  },
  {
    claves: ['reditum', 'webhook', 'tradingview', 'alerta', 'externa', 'pine'],
    responder: () =>
      'Los algoritmos Reditum viven en TradingView (Pine Script) y entran a TradeMe por `POST /tv-hook` con un token secreto. Cada alerta se traduce a un **voto más** del ensemble, con más peso por ser fuente principal de alfa, y caduca a los cinco minutos.\n\n' +
      'Ningún código propietario vive en el repositorio: solo se mapean las salidas mediante configuración.\n\n' +
      'Una limitación honesta: las alertas solo existen hacia delante, así que el backtest **nunca las ha visto** y Optuna optimiza como si Reditum no existiera.',
  },
  {
    claves: ['snapshot', 'registro', 'registros', 'captura'],
    responder: (c) => {
      const s = c.stats;
      return (
        'Un registro es una decisión congelada en el momento real, con sus niveles. TradeMe la sigue hacia adelante y comprueba si acertó: es el test hacia adelante y el material con el que se entrena el meta-modelo.\n\n' +
        'La captura es automática y se ancla **a la vela**: una decisión por vela y por temporalidad.' +
        (s
          ? `\n\nEn ${c.symbol}: ${s.total} registros, ${s.tp} en objetivo, ${s.sl} en stop, ${s.timeout} cerrados por tiempo y ${s.abiertos} aún abiertos.`
          : '')
      );
    },
  },
  {
    claves: ['estado', 'salud', 'caido', 'funciona', 'version', 'versión'],
    responder: (c) => {
      const e = c.estado;
      if (!e) return 'No puedo leer el estado del sistema ahora mismo.';
      const malos = e.components.filter((x: { status: string }) => x.status !== 'ok' && x.status !== 'na');
      return (
        `Versión ${e.version}. Estado general: ${e.overall}.\n\n` +
        (malos.length === 0
          ? 'Todos los componentes responden con normalidad.'
          : `Con incidencias: ${malos.map((m: { label: string; detail: string }) => `${m.label} (${m.detail})`).join('; ')}.`)
      );
    },
  },
  {
    claves: ['opera', 'operar', 'real', 'dinero', 'ejecuta', 'orden', 'ordenes'],
    responder: () =>
      '**No. TradeMe no ejecuta órdenes**, ni con dinero real ni simulado. Es una herramienta de apoyo a la decisión, no asesoría financiera ni un robot de trading.\n\n' +
      'La ejecución real está detrás de un interruptor apagado por defecto (`ENABLE_LIVE_TRADING=false`) y su arquitectura está diseñada y documentada, pero no implementada. Cualquier orden la teclea una persona.',
  },
  {
    claves: ['temporalidad', 'temporalidades', 'marca', 'marcas', 'punto', 'barra', 'flechas'],
    responder: (c) => {
      const activas = c.usage.filter((u) => u.captura).map((u) => u.interval);
      const opt = c.usage.filter((u) => u.optimizado).map((u) => u.interval);
      return (
        'En la barra superior, las **flechas recorren la tira** de temporalidades; para analizar otra, se pulsa sobre ella.\n\n' +
        'El **punto pequeño** dentro de cada botón se enciende cuando el motor trabaja en esa temporalidad: la analiza y guarda registros por su cuenta. El botón «?» de la derecha abre la leyenda completa.\n\n' +
        `Ahora mismo el motor captura en: ${activas.join(', ') || 'ninguna'}.` +
        (opt.length > 0 ? ` Con pesos optimizados propios: ${opt.join(', ')}.` : '')
      );
    },
  },
  {
    claves: ['backtest', 'prueba', 'historico', 'histórico', 'look-ahead'],
    responder: () =>
      'El backtest recorre el histórico decidiendo vela a vela, con dos reglas incómodas y deliberadas:\n\n' +
      '• **Sin look-ahead**: nunca se usa información que no existía en ese momento.\n' +
      '• **Peor caso**: si una vela pudo tocar tanto el stop como el objetivo, se supone que tocó el stop.\n\n' +
      'Además se reserva el 30 % final de los datos sin tocar, para comprobar sobre él. Los resultados salen más feos y más ciertos.',
  },
];

const SUGERENCIAS = [
  '¿Por qué la decisión de ahora?',
  '¿Es malo que haya más SL que TP?',
  '¿Qué es la expectancy?',
  '¿Cómo aprende el sistema?',
  '¿De dónde salen las velas?',
  'Compara 15m con 30m y dime cuál va mejor',
  '¿Qué está moviendo el mercado hoy?',
  '¿TradeMe opera por mí?',
];

const normaliza = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Elige el tema con más palabras clave coincidentes. Sin coincidencias, lo reconoce. */
function responder(pregunta: string, c: Contexto): string {
  const q = normaliza(pregunta);
  let mejor: (typeof TEMAS)[number] | null = null;
  let mejorPuntos = 0;
  for (const t of TEMAS) {
    const puntos = t.claves.reduce((a, k) => (q.includes(normaliza(k)) ? a + k.length : a), 0);
    if (puntos > mejorPuntos) {
      mejorPuntos = puntos;
      mejor = t;
    }
  }
  if (!mejor) {
    return (
      'No he sabido encontrar eso. Sé responder sobre la decisión actual y por qué es esa, los indicadores y sus pesos, ' +
      'las métricas del backtest, la calibración, el meta-modelo, el piloto automático, los proveedores de datos, ' +
      'Reditum, los registros, la arquitectura y el estado del sistema.\n\n' +
      'Si buscas algo más largo o con ejemplos, el **Centro de ayuda** lo tiene desarrollado.'
    );
  }
  return mejor.responder(c);
}

/** Convierte **negrita** y saltos de línea en JSX. */
function Formato({ texto }: { texto: string }) {
  return (
    <>
      {texto.split('\n').map((linea, i) => (
        <p key={i} className={linea.trim() === '' ? 'bot-sep' : undefined}>
          {linea.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, j) =>
            p.startsWith('**') && p.endsWith('**') ? (
              <strong key={j}>{p.slice(2, -2)}</strong>
            ) : p.startsWith('`') && p.endsWith('`') ? (
              <code key={j}>{p.slice(1, -1)}</code>
            ) : (
              <span key={j}>{p}</span>
            ),
          )}
        </p>
      ))}
    </>
  );
}

/**
 * Asistente de la plataforma.
 *
 * Responde con el estado real del sistema, no con documentación genérica: lee la decisión en vivo,
 * las estadísticas de registros, la configuración activa y el estado de cada componente. Todo se
 * resuelve en el navegador, sin enviar nada fuera y sin coste por consulta.
 */
export function Asistente({ symbol, interval }: { symbol: string; interval: Interval }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');
  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [info, setInfo] = useState<AssistantInfo>({ enabled: false, model: '', host: '' });
  const [pensando, setPensando] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      de: 'bot',
      texto:
        '¡Hola! Puedo explicarte cualquier cosa de TradeMe: **por qué decide lo que decide** ahora mismo, qué significan las métricas, cómo aprende, de dónde salen los datos o cómo está montado por dentro.\n\nPregunta con tus palabras, o toca una de las sugerencias.',
    },
  ]);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto || !symbol) return;
    let cancelado = false;
    void fetchAssistantInfo().then((i) => {
      if (!cancelado) setInfo(i);
    });
    void Promise.all([
      fetchSignal(symbol, interval),
      fetchSnapshots(symbol),
      fetchSustento(symbol, interval),
      fetchSystemStatus(),
      fetchTimeframeUsage(symbol),
    ]).then(([signal, snaps, sustento, estado, usage]) => {
      if (cancelado) return;
      setCtx({ symbol, interval, signal, stats: snaps?.stats ?? null, sustento, estado, usage });
    });
    return () => {
      cancelado = true;
    };
  }, [abierto, symbol, interval]);

  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'nearest' });
  }, [mensajes, abierto]);

  /**
   * Con modelo configurado se le pregunta a él, que entiende cualquier formulación. Si no lo hay,
   * o si falla —red caída, cupo agotado, proveedor con problemas—, responde la base local. El
   * asistente nunca se queda mudo.
   */
  const preguntar = async (q: string) => {
    const pregunta = q.trim();
    if (!pregunta || pensando) return;
    const c: Contexto = ctx ?? { symbol, interval, signal: null, stats: null, sustento: null, estado: null, usage: [] };
    setMensajes((m) => [...m, { de: 'yo', texto: pregunta }]);
    setTexto('');

    if (!info.enabled) {
      setMensajes((m) => [...m, { de: 'bot', texto: responder(pregunta, c), fuente: 'local' }]);
      return;
    }

    setPensando(true);
    const historial = mensajes
      .slice(-6)
      .map((m) => ({ role: (m.de === 'yo' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.texto }));
    const r = await askAssistant(pregunta, historial, symbol, interval);
    setPensando(false);
    if ('texto' in r) {
      setMensajes((m) => [...m, { de: 'bot', texto: r.texto, fuente: 'modelo', consultas: r.consultas }]);
    } else {
      setMensajes((m) => [
        ...m,
        {
          de: 'bot',
          texto: `${responder(pregunta, c)}\n\n_(El modelo no está disponible ahora mismo: ${r.error}. Esta respuesta viene de la base local.)_`,
          fuente: 'local',
        },
      ]);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`bot-fab ${abierto ? 'on' : ''}`}
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-label={abierto ? 'Cerrar el asistente' : 'Abrir el asistente de TradeMe'}
        title="Asistente de TradeMe"
      >
        {abierto ? '✕' : '🤖'}
      </button>

      {abierto && (
        <aside className="bot-panel" role="dialog" aria-label="Asistente de TradeMe">
          <div className="bot-head">
            <strong>Asistente de TradeMe</strong>
            <span className="muted">
              {symbol} · {interval} ·{' '}
              {info.enabled ? `modelo ${info.model}` : 'base de conocimiento local'}
              {info.busqueda?.enabled ? ' · con internet' : ''}
              {ctx ? ' · con datos en vivo' : ' · cargando estado…'}
            </span>
          </div>

          <div className="bot-hilo">
            {mensajes.map((m, i) => (
              <div key={i} className={`bot-msg ${m.de}`}>
                <Formato texto={m.texto} />
                {m.consultas && m.consultas.length > 0 && (
                  <p className="bot-consultas" title="Datos que el asistente consultó para responder">
                    consultó: {[...new Set(m.consultas)].map((c) => c.replace(/_/g, ' ')).join(' · ')}
                  </p>
                )}
              </div>
            ))}
            {pensando && (
              <div className="bot-msg bot bot-pensando">
                <p>Consultando la plataforma…</p>
              </div>
            )}
            <div ref={finRef} />
          </div>

          {mensajes.length <= 1 && (
            <div className="bot-sugerencias">
              {SUGERENCIAS.map((s) => (
                <button key={s} type="button" onClick={() => void preguntar(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="bot-entrada"
            onSubmit={(e) => {
              e.preventDefault();
              void preguntar(texto);
            }}
          >
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Pregunta lo que quieras…"
              aria-label="Escribe tu pregunta"
            />
            <button type="submit" disabled={!texto.trim() || pensando}>
              {pensando ? '…' : 'Enviar'}
            </button>
          </form>

          <p className="bot-pie muted">
            {info.enabled
              ? `Responde un modelo alojado en ${info.host}, al que se le envía el estado del sistema (cifras, no credenciales)${info.busqueda?.enabled ? ' y que puede buscar en internet' : ''}. Si falla, contesta la base local.`
              : 'Responde la base de conocimiento local con el estado en vivo. No sale nada de tu red.'}{' '}
            No es asesoría financiera.
          </p>
        </aside>
      )}
    </>
  );
}
