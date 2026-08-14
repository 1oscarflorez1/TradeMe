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
      name: 'cambios_de_version',
      description:
        'Qué cambió en una versión de TradeMe y por qué, leído del registro de cambios oficial. ' +
        'Sin argumentos devuelve las últimas versiones. Úsala siempre que pregunten qué hay de ' +
        'nuevo, qué trajo la última actualización, cuándo se añadió algo o por qué se hizo un ' +
        'cambio. Es la única fuente fiable: no respondas de memoria sobre el historial.',
      parameters: {
        type: 'object',
        properties: {
          version: {
            type: 'string',
            description: 'Versión concreta, por ejemplo "0.34.0". Omítela para las más recientes.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_documentacion',
      description:
        'Documentación técnica de la plataforma: cómo funciona la calibración, el meta-modelo, el ' +
        'régimen, los proveedores de datos, el backtesting, la independencia de los votos… ' +
        'Úsala para preguntas conceptuales sobre CÓMO está hecho TradeMe, cuando quieras responder ' +
        'con el texto vigente en vez de con lo que recuerdes. Sin argumentos lista lo disponible.',
      parameters: {
        type: 'object',
        properties: {
          tema: {
            type: 'string',
            description:
              'Término a buscar (por ejemplo "calibración", "cuarentena") o el identificador de un ' +
              'documento para leerlo entero. Omítelo para ver el índice.',
          },
        },
      },
    },
  },
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

/**
 * Búsqueda en internet. Se declara aparte porque solo se ofrece al modelo si hay proveedor
 * configurado: prometerle una herramienta que no funciona lo lleva a inventarse las fuentes.
 */
export const TOOL_BUSCAR: ToolSpec = {
  type: 'function',
  function: {
    name: 'buscar_en_internet',
    description:
      'Busca información actual en internet: noticias de mercado, contexto macroeconómico, qué es ' +
      'un concepto que no conozcas, o novedades de una tecnología. Devuelve título, fragmento y ' +
      'enlace de unos pocos resultados. Úsala cuando la pregunta dependa de algo externo a la ' +
      'plataforma o posterior a tu conocimiento. NO la uses para datos de TradeMe: esos están en ' +
      'las otras herramientas y son los únicos fiables.',
    parameters: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'Qué buscar, en lenguaje natural.' },
      },
      required: ['consulta'],
    },
  },
};

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
