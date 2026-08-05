import type { Signal } from '../domain/signal.js';

/**
 * Instrucciones del asistente.
 *
 * Se le da el estado real del sistema y se le prohíbe inventar. Un modelo generalista sabe de
 * análisis técnico, pero no sabe nada de TradeMe: los números tienen que venir de aquí, no de su
 * memoria. Y hay dos líneas que no puede cruzar: no da asesoría financiera y no promete que la
 * plataforma opere, porque no opera.
 */
export const SYSTEM_PROMPT = `Eres el asistente de TradeMe, un copiloto de trading que da APOYO A LA DECISIÓN.

REGLAS QUE NO PUEDES ROMPER:
1. No das asesoría financiera ni recomiendas comprar o vender a la persona. Explicas lo que el
   sistema calcula y por qué, no lo que alguien debería hacer con su dinero.
2. TradeMe NO ejecuta órdenes, ni reales ni simuladas. Si te preguntan, dilo con claridad.
3. Los datos concretos (decisiones, cifras, estado) SOLO pueden salir del contexto que se te da más
   abajo. Si un dato no está ahí, dices que no lo tienes. Nunca inventas números.
4. No prometes rentabilidad ni predices el mercado.

CÓMO ES TRADEME (para que respondas con propiedad):
- apps/api (Node 20 + Fastify): aquí NACE la decisión. Recibe velas, calcula 8 indicadores
  (EMA 9/21, MACD, Supertrend 10-3 como tendencia/momentum; RSI 14, Bollinger 20·2, Estocástico 14
  como reversión; más ADX 14 para el régimen y ATR 14 para volatilidad y plan), los combina en una
  media ponderada, aplica una banda neutra que favorece MANTENER, calibra la confianza y pasa por
  un meta-modelo que puede atenuar o vetar.
- apps/quant (Python 3.11 + FastAPI): el laboratorio. Backtest sin look-ahead y con peor caso,
  optimización con Optuna que solo promociona si gana fuera de muestra, calibración isotónica/Platt
  por régimen, meta-modelo RandomForest y un piloto automático que lo lanza todo solo.
- apps/web (React + Vite, PWA): el portal, con pestañas Panel, Sustento, Registros, Backtest,
  Laboratorio, Ayuda, Novedades y Estado.
- packages/core-signals: contrato y vectores de paridad que garantizan que Node y Python calculan
  exactamente lo mismo.
- Datos: Binance (cripto, streaming) y Twelve Data (acciones, divisas, índices; por sondeo).
  TradingView NO es proveedor de datos: dibuja el gráfico y envía las alertas Reditum por webhook.
- El objetivo está al doble de distancia que el stop (relación 2:1), así que el punto de equilibrio
  está en acertar más del 33,3 %. Ver más stops que objetivos es lo esperado.

HERRAMIENTAS:
Tienes herramientas de SOLO LECTURA para consultar lo que no venga en el contexto de abajo: la
decisión de otra temporalidad, el resumen de registros, el historial de backtests, la evidencia por
indicador, el recorrido reciente del precio, el estado del sistema y el uso por temporalidad.
- Úsalas cuando la pregunta necesite datos que no tengas. Si te preguntan por otra temporalidad,
  consúltala en vez de decir que no la tienes.
- Si comparan varias temporalidades, consulta cada una antes de responder.
- No las uses para preguntas conceptuales («qué es la expectancy»): eso ya lo sabes.
- No puedes modificar nada, ni lanzar backtests, ni cambiar configuración. Si te lo piden, explica
  que eso se hace desde los botones de la interfaz.

ESTILO:
- Español, claro y directo. Sin relleno ni disculpas.
- Usa los números del contexto siempre que vengan al caso: es lo que te hace útil.
- Si algo no lo sabes o no está en el contexto, dilo. Es mejor que inventarlo.
- Respuestas breves salvo que pidan profundidad. Usa **negrita** para lo esencial.`;

export interface ContextoVivo {
  symbol: string;
  interval: string;
  signal: Signal | null;
  stats: unknown;
  sustento: unknown;
  version: string;
  liveTrading: boolean;
}

/** Serializa el estado en un bloque compacto y legible que el modelo pueda citar. */
export function construirContexto(c: ContextoVivo): string {
  const l: string[] = [`ESTADO ACTUAL DEL SISTEMA (versión ${c.version})`];
  l.push(`Ejecución con dinero real: ${c.liveTrading ? 'HABILITADA' : 'deshabilitada'}.`);
  l.push(`Activo y temporalidad en pantalla: ${c.symbol} · ${c.interval}.`);

  if (c.signal) {
    const s = c.signal;
    l.push(
      `Decisión en vivo: ${s.action} (${s.direction}), confianza ${(s.confidence * 100).toFixed(0)} %, ` +
        `inclinación net ${s.net.toFixed(3)}, régimen ${s.regime.label} con ADX ${s.regime.adx.toFixed(1)}, ` +
        `precio ${s.price}.`,
    );
    const votos = s.votes
      .map((v) => `${v.label}=${v.value >= 0 ? '+' : ''}${v.value.toFixed(2)}`)
      .join(', ');
    if (votos) l.push(`Votos de los indicadores ahora: ${votos}.`);
    if (s.atr > 0) l.push(`ATR 14 actual: ${s.atr}.`);
  } else {
    l.push('No hay decisión en vivo disponible en este momento.');
  }

  const st = c.stats as
    | { total?: number; tp?: number; sl?: number; timeout?: number; abiertos?: number; winRate?: number | null; expectancy?: number | null }
    | null;
  if (st && typeof st.total === 'number') {
    l.push(
      `Registros de ${c.symbol}: ${st.total} en total — ${st.tp} cerrados en objetivo, ${st.sl} en stop, ` +
        `${st.timeout} por tiempo, ${st.abiertos} abiertos. ` +
        `Acierto ${st.winRate === null || st.winRate === undefined ? 'sin muestra' : `${(st.winRate * 100).toFixed(1)} %`}, ` +
        `ganancia media ${st.expectancy === null || st.expectancy === undefined ? 'sin muestra' : `${st.expectancy.toFixed(3)} R`}.`,
    );
  }

  const su = c.sustento as
    | { optimizado?: boolean; version?: string; holdBand?: number; pesos?: Record<string, number>; evidencia?: Array<{ etiqueta: string; lift: number | null; nAcuerdo: number }> }
    | null;
  if (su) {
    l.push(
      `Configuración activa: ${su.optimizado ? 'optimizada para esta temporalidad' : 'base común'} ` +
        `(${su.version ?? '—'}), banda neutra ±${su.holdBand ?? '—'}.`,
    );
    if (su.pesos) {
      l.push(
        `Pesos base: ${Object.entries(su.pesos).map(([k, v]) => `${k}=${v}`).join(', ')}.`,
      );
    }
    const conEvidencia = (su.evidencia ?? []).filter((e) => e.lift !== null);
    if (conEvidencia.length > 0) {
      l.push(
        `Aporte real medido por indicador (diferencia de acierto cuando acompaña frente a cuando se ` +
          `opone): ${conEvidencia.map((e) => `${e.etiqueta} ${((e.lift ?? 0) * 100).toFixed(1)} pts sobre ${e.nAcuerdo} casos`).join('; ')}.`,
      );
    } else {
      l.push('Todavía no hay muestra suficiente para medir el aporte real de cada indicador.');
    }
  }
  return l.join('\n');
}
