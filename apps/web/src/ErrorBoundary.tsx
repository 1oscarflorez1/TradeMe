import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Queda en la consola para diagnóstico.
    console.error('TradeMe UI error:', error, info);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div className="app">
          <div className="panel error" style={{ margin: '2rem' }}>
            <h2>Algo falló en la interfaz</h2>
            <p className="hint">{error.message}</p>
            <p className="muted">Revisa la consola (F12) para el detalle. Puedes reintentar.</p>
            <button
              type="button"
              className="tf active"
              onClick={() => this.setState({ error: null })}
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
