# Notificaciones (M8)

> Objetivo: avisar al usuario de lo relevante sin que tenga que vigilar la pantalla. Web-first:
> **centro de alertas** in-app (historial persistente) + **notificaciones del navegador** en
> escritorio. El push móvil real (FCM/APNs) llega con la app móvil en **M9**.

## Arquitectura

Los umbrales y el cooldown viven en el navegador (engranaje de la barra), así que el **motor de
reglas corre en el cliente**: detecta las condiciones con los datos que ya maneja (decisiones por
temporalidad, señal en vivo, votos Reditum y seguimiento de snapshots) y, respetando el **cooldown**,
crea la alerta. La **API persiste el historial** (tabla `alerts`, con leído/no leído).

```
cliente (reglas + cooldown) ──POST /alerts──► DB (historial)  ──GET /alerts──► campana (no-leídas)
                            └─ Notification API (aviso de escritorio)
```

## Reglas

- **Decisión accionable ≥ umbral:** una temporalidad pasa a tener COMPRAR/VENDER con confianza ≥ su
  umbral (reutiliza los umbrales de la barra).
- **Señal Reditum recibida:** entra una alerta de TradingView/Reditum por el webhook.
- **Snapshot alcanza TP/SL:** un registro guardado toca su objetivo o su stop.
- **Cambio de dirección / sesgo macro:** la dirección (LONG/SHORT/FLAT) o el signo del sesgo macro cambia.
- **Avance cada 10% al objetivo:** un registro en curso cruza cada hito de 10% de avance hacia su TP.

**Cooldown:** configurable en el engranaje (por defecto 5 min). No se repite la misma alerta
(regla+símbolo+temporalidad) dentro de ese margen.

## API

- `GET /alerts?limit=50` → `{ alerts, unread }`.
- `POST /alerts` → crea una alerta (`{ type, severity, title, message?, symbol?, interval?, meta? }`).
- `POST /alerts/read` → marca todas como leídas.

Tabla `alerts` (TimescaleDB): `id, created_at, symbol, interval, type, severity, title, message, meta, read`.

## Web

- **Centro de alertas:** campana en la barra con contador de no-leídas; panel con el historial,
  botón "Marcar leídas" y botón para **activar las notificaciones del navegador** (pide permiso).
- **Notificación de escritorio:** al crear una alerta, si hay permiso, se muestra un aviso del sistema.

## Qué NO hace todavía

El **push real en segundo plano** (con la pestaña cerrada) necesita service worker + Web Push/FCM/APNs
y llega con la app móvil en **M9**. Por ahora las notificaciones del navegador funcionan con el portal
abierto.
