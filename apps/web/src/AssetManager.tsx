import { useEffect, useMemo, useState } from 'react';
import {
  addAsset,
  fetchAssets,
  fetchProviders,
  removeAsset,
  searchAssets,
  toggleAsset,
} from './api';
import type { AssetRow, CatalogHit, ProviderInfo } from './api';
import { setTvSymbols } from './tvSymbol';

const CLASES: Array<{ id: string; label: string }> = [
  { id: '', label: 'Todo' },
  { id: 'cripto', label: 'Cripto' },
  { id: 'acciones', label: 'Acciones' },
  { id: 'forex', label: 'Divisas' },
  { id: 'indices', label: 'Índices' },
  { id: 'materias', label: 'Materias' },
];

const CLASE_ICONO: Record<string, string> = {
  cripto: '₿',
  acciones: '🏛',
  forex: '💱',
  indices: '📊',
  materias: '🛢',
};

function ClaseChip({ clase }: { clase: string }) {
  const nombre = CLASES.find((c) => c.id === clase)?.label ?? clase;
  return (
    <span className={`asset-chip clase-${clase}`} title={`Clase de activo: ${nombre}`}>
      {CLASE_ICONO[clase] ?? '•'} {nombre}
    </span>
  );
}

function ProviderChip({ id, providers }: { id: string; providers: ProviderInfo[] }) {
  const p = providers.find((x) => x.id === id);
  const modo = p?.mode === 'poll' ? 'consulta periódica' : 'tiempo real';
  return (
    <span className="asset-chip prov" title={`Fuente de las velas: ${p?.label ?? id} (${modo})`}>
      {p?.mode === 'poll' ? '⏱' : '⚡'} {id}
    </span>
  );
}

/**
 * Gestor de activos: busca en los catálogos de todos los proveedores configurados, añade a la lista
 * seguida y permite activar/quitar. Al añadir uno, el motor se suscribe en caliente y el piloto
 * empieza a medirlo.
 */
export function AssetManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [q, setQ] = useState('');
  const [clase, setClase] = useState('');
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = () =>
    fetchAssets().then((a) => {
      setAssets(a);
      setTvSymbols(a);
      onChanged();
    });

  useEffect(() => {
    void reload();
    void fetchProviders().then(setProviders);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBuscando(true);
    const id = setTimeout(() => {
      void searchAssets(q, clase || undefined).then((r) => {
        if (!cancelled) {
          setHits(r);
          setBuscando(false);
        }
      });
    }, 300); // pequeño retardo para no gastar cupo del proveedor en cada tecla
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, clase]);

  const seguidos = new Set(assets.map((a) => a.symbol));
  const inactivos = useMemo(() => providers.filter((p) => !p.available), [providers]);

  const doAdd = async (h: CatalogHit) => {
    setBusy(h.symbol);
    setMsg(null);
    const r = await addAsset(h.symbol, h.provider);
    setBusy(null);
    if (r.ok) {
      setMsg(
        `✓ ${h.symbol} añadido desde ${h.provider}. El motor ya lo sigue; el piloto lo medirá en su próximo ciclo.`,
      );
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

        <div className="asset-providers" role="list" aria-label="Proveedores de datos">
          {providers.map((p) => (
            <span
              key={p.id}
              role="listitem"
              className={`asset-chip prov-state ${p.available ? 'ok' : 'off'}`}
              title={p.unavailableReason ?? `${p.label} · ${p.mode === 'poll' ? 'consulta periódica' : 'tiempo real'}`}
            >
              {p.available ? '●' : '○'} {p.label}
            </span>
          ))}
        </div>

        <input
          className="help-search asset-search"
          placeholder="Buscar activo (ETH, SOL, AAPL, EUR/USD, SPX…)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />

        <div className="asset-filters" role="tablist" aria-label="Clase de activo">
          {CLASES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={clase === c.id}
              className={clase === c.id ? 'tf active' : 'tf'}
              onClick={() => setClase(c.id)}
            >
              {c.id ? `${CLASE_ICONO[c.id]} ` : ''}
              {c.label}
            </button>
          ))}
        </div>

        <div className="asset-cols">
          <div>
            <h4 className="asset-h">Resultados del catálogo</h4>
            <div className="asset-list">
              {buscando && hits.length === 0 ? (
                <p className="muted">Buscando…</p>
              ) : hits.length === 0 ? (
                <p className="muted">
                  Sin coincidencias{clase ? ' en esta clase' : ''}.
                  {inactivos.length > 0 && ' Hay proveedores sin configurar (mira los puntos de arriba).'}
                </p>
              ) : (
                hits.map((h) => (
                  <div key={`${h.provider}:${h.symbol}`} className="asset-item">
                    <div>
                      <strong>{h.symbol}</strong>
                      <span className="muted"> · {h.label}</span>
                      <div className="asset-chips">
                        <ClaseChip clase={h.assetClass} />
                        <ProviderChip id={h.provider} providers={providers} />
                      </div>
                    </div>
                    {seguidos.has(h.symbol) ? (
                      <span className="muted">ya seguido</span>
                    ) : (
                      <button
                        type="button"
                        className="bt-run"
                        disabled={busy === h.symbol}
                        onClick={() => void doAdd(h)}
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
                    <div className="asset-chips">
                      <ClaseChip clase={a.assetClass} />
                      <ProviderChip id={a.provider} providers={providers} />
                    </div>
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
        {inactivos.length > 0 && (
          <p className="muted calib-legend">
            <strong>Proveedores sin configurar:</strong>{' '}
            {inactivos.map((p) => `${p.label} — ${p.unavailableReason ?? 'falta configuración'}`).join(' · ')}
          </p>
        )}
        <p className="muted calib-legend">
          TradeMe solo puede <strong>decidir, hacer backtest y entrenar</strong> sobre activos de los
          que recibe velas. El gráfico de TradingView dibuja casi cualquier mercado, pero no entrega
          datos: por eso cada activo indica de qué <strong>proveedor</strong> salen sus velas.{' '}
          <strong>⚡ tiempo real</strong> significa streaming continuo (cripto);{' '}
          <strong>⏱ consulta periódica</strong> significa que TradeMe pregunta cada pocos minutos,
          suficiente para temporalidades de 15m en adelante. Cada activo nuevo entrena su propia
          estrategia por temporalidad.
        </p>
      </div>
    </div>
  );
}
