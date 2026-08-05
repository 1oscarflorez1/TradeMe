/**
 * Herramientas que el asistente puede usar para consultar la plataforma.
 *
 * Tres reglas de diseño, todas por seguridad:
 *
 * 1. **Solo lectura.** Ninguna herramienta escribe, borra, lanza procesos ni cambia configuración.
 *    El asistente mira; actuar se hace desde los botones de la interfaz.
 * 2. **Superficie cerrada.** No hay una herramienta genérica de «ejecuta esta consulta»: cada una
 *    tiene un propósito concreto y parámetros acotados. Un modelo no debería poder redactar SQL.
 * 3. **Respuestas pequeñas.** Se devuelven resúmenes, no volcados. Una serie de precios se resume
 *    en unas pocas cifras en vez de mandar mil velas que además llenarían la ventana de contexto.
 */

export interface ToolSpec {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

const INTERVALOS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

const conIntervalo = (descripcion: string, requerido = true): Record<string, unknown> => ({
  type: 'object',
  properties: {
    interval: { type: 'string', enum: INTERVALOS, description: descripcion },
  },
  ...(requerido ? { required: ['interval'] } : {}),
});

export const TOOLS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'decision_de_temporalidad',
      description:
        'Decisión en vivo del activo en OTRA temporalidad: acción, dirección, confianza, ' +
        'inclinación, régimen, ADX y el voto de cada indicador. Úsala cuando pregunten por una ' +
        'temporalidad distinta a la que está en pantalla, o para comparar varias.',
      parameters: conIntervalo('Temporalidad a consultar.'),
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_registros',
      description:
        'Estadísticas de las decisiones guardadas y ya evaluadas: totales, cuántas cerraron en ' +
        'objetivo, en stop o por tiempo, acierto y ganancia media en R. Sin temporalidad devuelve ' +
        'el total del activo y el desglose de todas.',
      parameters: conIntervalo('Temporalidad concreta. Omítela para el desglose completo.', false),
    },
  },
  {
    type: 'function',
    function: {
      name: 'historial_backtests',
      description:
        'Corridas de backtest guardadas de una temporalidad, de la más antigua a la más reciente, ' +
        'con operaciones, acierto, expectancy, profit factor, drawdown y el resultado fuera de ' +
        'muestra. Sirve para responder si el sistema mejora o se degrada.',
      parameters: conIntervalo('Temporalidad del backtest.'),
    },
  },
  {
    type: 'function',
    function: {
      name: 'evidencia_indicadores',
      description:
        'Aporte real medido de cada indicador en una temporalidad: acierto cuando acompañó a la ' +
        'decisión frente a cuando se opuso, y la diferencia. Responde a si un indicador sirve.',
      parameters: conIntervalo('Temporalidad a evaluar.'),
    },
  },
  {
    type: 'function',
    function: {
      name: 'resumen_de_precios',
      description:
        'Resumen del recorrido reciente del precio en una temporalidad: primer y último cierre, ' +
        'variación, máximo, mínimo, rango y cuántas velas fueron alcistas. No devuelve las velas ' +
        'una a una.',
      parameters: {
        type: 'object',
        properties: {
          interval: { type: 'string', enum: INTERVALOS, description: 'Temporalidad.' },
          velas: { type: 'integer', minimum: 10, maximum: 300, description: 'Cuántas velas mirar hacia atrás (por defecto 100).' },
        },
        required: ['interval'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estado_del_sistema',
      description:
        'Salud de cada componente (API, base de datos, datos de mercado, servicio quant, captura ' +
        'automática, meta-modelo, notificaciones, webhook) y proveedores de datos configurados.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'uso_por_temporalidad',
      description:
        'En qué temporalidades trabaja el motor: cuáles captura sola, cuáles tienen pesos ' +
        'optimizados propios, cuáles tienen backtest guardado y cuántos registros lleva cada una.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** Firma del ejecutor. Devuelve cualquier objeto serializable; el modelo lo lee como JSON. */
export type ToolExecutor = (nombre: string, args: Record<string, unknown>) => Promise<unknown>;

/** Resume una serie de cierres sin volcarla entera. */
export function resumirPrecios(
  closes: number[],
  highs: number[],
  lows: number[],
): Record<string, unknown> {
  if (closes.length === 0) return { error: 'sin datos para esa temporalidad' };
  const primero = closes[0]!;
  const ultimo = closes[closes.length - 1]!;
  const maximo = Math.max(...highs);
  const minimo = Math.min(...lows);
  let alcistas = 0;
  for (let i = 1; i < closes.length; i += 1) if (closes[i]! > closes[i - 1]!) alcistas += 1;
  return {
    velas: closes.length,
    primerCierre: primero,
    ultimoCierre: ultimo,
    variacionPct: primero > 0 ? Number((((ultimo - primero) / primero) * 100).toFixed(2)) : null,
    maximo,
    minimo,
    rangoPct: minimo > 0 ? Number((((maximo - minimo) / minimo) * 100).toFixed(2)) : null,
    velasAlcistas: alcistas,
    velasBajistas: Math.max(0, closes.length - 1 - alcistas),
  };
}
