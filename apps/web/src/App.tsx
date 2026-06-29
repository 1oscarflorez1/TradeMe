import { AssetSelector } from './AssetSelector.tsx';

export function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◆
          </span>
          <h1>TradeMe</h1>
          <span className="tag">copiloto de trading</span>
        </div>
        <AssetSelector />
      </header>

      <main className="content">
        <section className="panel placeholder">
          <h2>Dashboard</h2>
          <p>
            Shell del dashboard (M0). El gráfico de velas en vivo, el anillo de confianza y el panel
            de plan llegan a partir de M1.
          </p>
        </section>
      </main>

      <footer className="disclaimer">
        Apoyo a la decisión, no asesoría financiera. Ningún modelo garantiza rentabilidad; el
        rendimiento pasado no asegura resultados futuros.
      </footer>
    </div>
  );
}
