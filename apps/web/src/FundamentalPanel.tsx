import type { Action, Fundamental } from './types';

/**
 * Fundamental Score (M12) en el sustento del Panel.
 *
 * Se enseña aunque no influya, y se dice que no influye. Un indicador visible que el usuario cree
 * que manda, y no manda, es peor que no enseñarlo: le hace atribuir a la máquina razones que la
 * máquina no ha usado.
 */
export function FundamentalPanel({
  fundamental,
  action,
  shadowAction,
}: {
  fundamental?: Fundamental;
  action?: Action;
  shadowAction?: Action;
}) {
  if (!fundamental || fundamental.mode === 'off') {
    return (
      <p className="muted">
        Fundamental Score apagado. La decisión sale solo de los indicadores y del sesgo macro.
      </p>
    );
  }

  if (fundamental.stale) {
    return (
      <div className="fundamental">
        <div className="fund-head">
          <span className="fund-title">Funding</span>
          <span className="wh-flat">SIN DATOS</span>
        </div>
        <p className="muted">
          Aún no hay histórico suficiente para saber si este funding es alto o bajo{' '}
          {fundamental.n > 0 ? `(${fundamental.n} observaciones)` : ''}. Mientras tanto no penaliza
          nada: sin datos no se adivina.
        </p>
      </div>
    );
  }

  const pct = Math.round(fundamental.percentile * 100);
  const nivel = pct >= 67 ? 'wh-short' : pct <= 33 ? 'wh-long' : 'wh-flat';
  const etiqueta = pct >= 67 ? 'ALTO' : pct <= 33 ? 'BAJO' : 'MEDIO';
  const cambiaria = Boolean(shadowAction && action && shadowAction !== action);

  return (
    <div className="fundamental">
      <div className="fund-head">
        <span className="fund-title">Funding</span>
        <span
          className={nivel}
          title="Dónde cae el funding actual dentro de los últimos 90 días. Alto = el apalancamiento largo está caro comparado con lo normal últimamente."
        >
          {etiqueta} · percentil {pct}
        </span>
      </div>

      <div className="fund-bar" aria-hidden>
        <div className="fund-bar-fill" style={{ width: `${pct}%` }} />
        <div className="fund-bar-umbral" style={{ left: '33%' }} />
      </div>

      <p className="fund-explica">
        {fundamental.penalty > 0 ? (
          <>
            Con el funding aquí, históricamente los largos rendían peor. El score{' '}
            <strong>desaconseja comprar</strong> con fuerza {(fundamental.penalty * 100).toFixed(0)}{' '}
            sobre 100. No opina sobre vender: el efecto medido solo existe en los largos.
          </>
        ) : (
          <>
            Funding en el tercio bajo: es justo donde los largos rendían mejor (+0,20 R de media).
            El score no penaliza nada aquí.
          </>
        )}
      </p>

      {fundamental.applied ? (
        <div className="fund-estado fund-activo">
          Aplicado a la decisión (peso {fundamental.w_fund}).
        </div>
      ) : (
        <div className="fund-estado fund-sombra">
          <strong>En sombra: no influye en esta decisión.</strong> Se registra y se mide. Solo pasará
          a mandar si demuestra lift ≥ 0,05 R y AUC ≥ 0,55 sobre operaciones reales ya cerradas —
          las mismas reglas que tuvo que cumplir el meta-modelo.
          {cambiaria ? (
            <div className="fund-discrepa">
              Aquí sí discrepa: con el score aplicado la decisión habría sido{' '}
              <strong>{shadowAction}</strong> en vez de <strong>{action}</strong>.
            </div>
          ) : null}
        </div>
      )}

      <div className="fund-meta">
        <span>ventana 90 d</span>
        <span>{fundamental.n} observaciones</span>
        {fundamental.version ? <span>{fundamental.version}</span> : null}
      </div>
    </div>
  );
}
