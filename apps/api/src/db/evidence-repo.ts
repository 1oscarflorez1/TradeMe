import type pg from 'pg';

/** Indicadores que votan. ADX y ATR no aparecen: son contexto y volatilidad, no voto. */
export const INDICADORES = [
  { clave: 'ema_cross', col: 'ema_cross_score', etiqueta: 'Cruce EMA 9/21', familia: 'tendencia' },
  { clave: 'macd', col: 'macd_score', etiqueta: 'MACD', familia: 'momentum' },
  { clave: 'supertrend', col: 'supertrend_score', etiqueta: 'Supertrend (10,3)', familia: 'tendencia' },
  { clave: 'rsi14', col: 'rsi14_score', etiqueta: 'RSI 14', familia: 'reversión' },
  { clave: 'bbands', col: 'bbands_score', etiqueta: 'Bollinger 20·2', familia: 'reversión' },
  { clave: 'stoch14', col: 'stoch14_score', etiqueta: 'Estocástico 14', familia: 'reversión' },
] as const;

export interface EvidenciaIndicador {
  clave: string;
  etiqueta: string;
  familia: string;
  /** Veces que el indicador apuntó en la misma dirección que la decisión, ya evaluadas. */
  nAcuerdo: number;
  aciertoAcuerdo: number | null;
  nDesacuerdo: number;
  aciertoDesacuerdo: number | null;
  /**
   * Diferencia entre acertar cuando el indicador acompañaba y acertar cuando se oponía.
   * Positivo = aporta información. Cerca de cero = está de adorno. Negativo = estorba.
   */
  lift: number | null;
}

/**
 * Evidencia histórica de cada indicador, calculada sobre las decisiones ya evaluadas.
 *
 * Es la respuesta a «¿por qué este indicador pesa lo que pesa?». Un peso sin evidencia es una
 * opinión; con evidencia es una medida. Solo se cuentan operaciones cerradas en objetivo o stop
 * (un cierre por tiempo no dice si el indicador acertaba) y una decisión por vela.
 */
export class EvidenceRepo {
  constructor(private readonly pool: pg.Pool) {}

  async porIndicador(symbol: string, interval: string): Promise<EvidenciaIndicador[]> {
    const partes = INDICADORES.map(
      (i) => `SELECT '${i.clave}' AS clave,
        COUNT(*) FILTER (WHERE acuerdo)::int AS n_ac,
        COUNT(*) FILTER (WHERE acuerdo AND res = 'tp')::int AS tp_ac,
        COUNT(*) FILTER (WHERE NOT acuerdo)::int AS n_des,
        COUNT(*) FILTER (WHERE NOT acuerdo AND res = 'tp')::int AS tp_des
      FROM (
        SELECT outcome_result AS res,
               SIGN(${i.col}) = CASE WHEN direction = 'LONG' THEN 1 ELSE -1 END AS acuerdo
          FROM una WHERE ${i.col} IS NOT NULL AND ${i.col} <> 0
      ) x_${i.clave}`,
    );
    const sql = `
      WITH una AS (
        SELECT DISTINCT ON (interval, candle_open) direction, outcome_result,
               ${INDICADORES.map((i) => i.col).join(', ')}
          FROM snapshots
         WHERE symbol = $1 AND interval = $2
           AND outcome_result IN ('tp','sl') AND direction IN ('LONG','SHORT')
         ORDER BY interval, candle_open, captured_at ASC
      )
      ${partes.join('\nUNION ALL\n')}`;
    const res = await this.pool.query<{
      clave: string; n_ac: number; tp_ac: number; n_des: number; tp_des: number;
    }>(sql, [symbol.toUpperCase(), interval]);

    const porClave = new Map(res.rows.map((r) => [r.clave, r]));
    return INDICADORES.map((i) => {
      const r = porClave.get(i.clave);
      const nAc = r?.n_ac ?? 0;
      const nDes = r?.n_des ?? 0;
      // Menos de 10 casos no sostienen un porcentaje: mejor no dar una cifra que dar una falsa.
      const acAc = nAc >= 10 ? (r?.tp_ac ?? 0) / nAc : null;
      const acDes = nDes >= 10 ? (r?.tp_des ?? 0) / nDes : null;
      return {
        clave: i.clave,
        etiqueta: i.etiqueta,
        familia: i.familia,
        nAcuerdo: nAc,
        aciertoAcuerdo: acAc,
        nDesacuerdo: nDes,
        aciertoDesacuerdo: acDes,
        lift: acAc !== null && acDes !== null ? acAc - acDes : null,
      };
    });
  }
}
