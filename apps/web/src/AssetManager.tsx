import { useEffect, useState } from 'react';
import { addAsset, fetchAssets, removeAsset, searchAssets, toggleAsset } from './api';
import type { AssetRow, CatalogHit } from './api';

/**
 * Gestor de activos: busca en el catálogo del proveedor, añade a la lista seguida y permite
 * activar/quitar. Al añadir uno, el motor se suscribe en caliente y el piloto empieza a medirlo.
 */
export function AssetManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = () =>
    fetchAssets().then((a) => {
      setAssets(a);
      onChanged();
    });

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      void searchAssets(q).then((r) => {
        if (!cancelled) setHits(r);
      });
    }, 250); // pequeño retardo para no consultar en cada tecla
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q]);

  const seguidos = new Set(assets.map((a) => a.symbol));

  const doAdd = async (symbol: string) => {
    setBusy(symbol);
    setMsg(null);
    const r = await addAsset(symbol);
    setBusy(null);
    if (r.ok) {
      setMsg(`✓ ${symbol} añadido. El motor ya lo está siguiendo; el piloto lo medirá en su próximo ciclo.`);
      await reload();
    } else {
      setMsg(`No se pudo añadir: ${r.error}`);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-assets"
        role="dialog"
        aria-modal="true"
        aria-label="Gestionar activos"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chart-head">
          <strong>Activos</strong>
          <span className="muted">· busca, añade y gestiona lo que TradeMe analiza</span>
          <button type="button" className="modal-x" aria-label="Cerrar" onClick={onClose}>
            ✕
          </button>
        </div>

        <input
          className="help-search asset-search"
          placeholder="Buscar activo (ETH, SOL, ADAUSDT…)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />

        <div className="asset-cols">
          <div>
            <h4 className="asset-h">Resultados del catálogo</h4>
            <div className="asset-list">
              {hits.length === 0 ? (
                <p className="muted">Sin coincidencias.</p>
              ) : (
                hits.map((h) => (
                  <div key={h.symbol} className="asset-item">
                    <div>
                      <strong>{h.symbol}</strong>
                      <span className="muted"> · {h.label}</span>
                    </div>
                    {seguidos.has(h.symbol) ? (
                      <span className="muted">ya seguido</span>
                    ) : (
                      <button
                        type="button"
                        className="bt-run"
                        disabled={busy === h.symbol}
                        onClick={() => void doAdd(h.symbol)}
                      >
                        {busy === h.symbol ? '…' : '+ Añadir'}
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <h4 className="asset-h">Siguiendo ({assets.length})</h4>
            <div className="asset-list">
              {assets.map((a) => (
                <div key={a.symbol} className={`asset-item ${a.enabled ? '' : 'is-off'}`}>
                  <div>
                    <strong>{a.symbol}</strong>
                    {a.label && <span className="muted"> · {a.label}</span>}
                    {!a.enabled && <span className="muted"> · pausado</span>}
                  </div>
                  <div className="asset-actions">
                    <button
                      type="button"
                      className="row-btn"
                      title={a.enabled ? 'Pausar (deja de analizarlo)' : 'Reanudar'}
                      onClick={() => void toggleAsset(a.symbol, !a.enabled).then(reload)}
                    >
                      {a.enabled ? '⏸' : '▶'}
                    </button>
                    <button
                      type="button"
                      className="row-btn row-del"
                      title="Quitar de la lista (no borra sus registros ni backtests)"
                      onClick={() => void removeAsset(a.symbol).then(reload)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {msg && <p className="bt-runmsg">{msg}</p>}
        <p className="muted calib-legend">
          El catálogo proviene del proveedor de datos (Binance spot), que es de donde TradeMe obtiene
          las velas para decidir y hacer backtest. El gráfico de TradingView puede mostrar otros
          mercados, pero solo se puede <strong>analizar y entrenar</strong> sobre activos con datos
          disponibles. Cada activo nuevo entrena su propia estrategia por temporalidad.
        </p>
      </div>
    </div>
  );
}
