# Seguridad, riesgo y cumplimiento

- **No asesoría financiera**: disclaimer visible en la UI y en este documento. TradeMe es educativo
  y de apoyo a la decisión.
- **Paper trading primero**. La ejecución real solo tras un _feature flag_ (`ENABLE_LIVE_TRADING`)
  **desactivado por defecto**, con límites de riesgo, _kill switch_ y doble confirmación.
- **Secretos** en variables de entorno / gestor de secretos; nunca en el repo. Ver `.env.example`.
- **Cumplimiento**: ToS de exchanges/brokers y licencias de indicadores de cursos (no redistribuir
  código propietario).
- **Robustez de datos**: rate limits y reconexión con backoff en los adaptadores.

> Ningún modelo garantiza rentabilidad; el rendimiento pasado no asegura resultados futuros.
