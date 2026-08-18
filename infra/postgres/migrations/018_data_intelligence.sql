-- Data Intelligence Layer: datos externos con fecha de conocimiento (M11).
--
-- La regla que sostiene todo el hito, y la razón de que estas tablas no se parezcan a las demás:
--
--   observed_at  -> a qué momento se REFIERE el dato (el IPC de julio, el funding de las 08:00)
--   published_at -> cuándo se SUPO (el IPC de julio se publica a mediados de agosto)
--
-- Un backtest situado en el 10 de agosto puede usar el IPC de junio, no el de julio, aunque el de
-- julio hable de un mes anterior. Sin esa distinción, cualquier medición del análisis fundamental
-- sería una reconstrucción con datos del futuro: la definición exacta de look-ahead, y el fallo más
-- difícil de detectar porque produce resultados espectaculares.
--
-- Por eso `published_at` es NOT NULL en todas las tablas. Un dato sin fecha de conocimiento no se
-- puede usar honestamente, así que no se guarda.
--
-- M11 **no toma ninguna decisión**: solo registra. El Fundamental Score es M12.

-- --- Series macroeconómicas (FRED, BCE, BLS…) ----------------------------------------------------
-- Una serie es «tipo de interés de la Fed» o «IPC interanual de la zona euro». Los organismos
-- revisan sus cifras: la misma `observed_at` puede tener varias `published_at`, y todas son ciertas
-- en su momento. Por eso la clave incluye las dos.
CREATE TABLE IF NOT EXISTS macro_series (
  source        TEXT        NOT NULL,
  series_id     TEXT        NOT NULL,
  observed_at   TIMESTAMPTZ NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL,
  value         DOUBLE PRECISION,
  unit          TEXT,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw           JSONB,
  PRIMARY KEY (source, series_id, observed_at, published_at)
);
CREATE INDEX IF NOT EXISTS macro_series_asof_idx ON macro_series (series_id, published_at DESC);

-- --- Métricas de derivados (funding, interés abierto, long/short) ---------------------------------
-- Aquí observed_at y published_at coinciden: son datos de mercado, se conocen al instante. Se
-- guardan las dos columnas igualmente para que la consulta «lo que se sabía en el momento t» sea
-- idéntica en todas las tablas y nadie tenga que recordar cuál usar.
CREATE TABLE IF NOT EXISTS derivatives_metrics (
  source        TEXT        NOT NULL,
  symbol        TEXT        NOT NULL,
  metric        TEXT        NOT NULL,  -- funding_rate · open_interest · long_short_ratio
  observed_at   TIMESTAMPTZ NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL,
  value         DOUBLE PRECISION NOT NULL,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw           JSONB,
  PRIMARY KEY (source, symbol, metric, observed_at)
);
CREATE INDEX IF NOT EXISTS derivatives_asof_idx
    ON derivatives_metrics (symbol, metric, published_at DESC);

-- --- Sentimiento (Fear & Greed y sucesores) ------------------------------------------------------
CREATE TABLE IF NOT EXISTS sentiment (
  source        TEXT        NOT NULL,
  scope         TEXT        NOT NULL,  -- 'cripto' global, o un símbolo concreto
  observed_at   TIMESTAMPTZ NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL,
  value         DOUBLE PRECISION NOT NULL,
  label         TEXT,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw           JSONB,
  PRIMARY KEY (source, scope, observed_at)
);
CREATE INDEX IF NOT EXISTS sentiment_asof_idx ON sentiment (scope, published_at DESC);

-- --- Calendario económico ------------------------------------------------------------------------
-- Un evento se conoce ANTES de ocurrir (por eso hay calendario) y su cifra real se publica DESPUÉS.
-- `published_at` es cuándo supimos del evento; `actual_published_at`, cuándo se supo el dato.
-- Distinguirlos es lo que permite responder «¿qué se sabía la víspera del FOMC?».
CREATE TABLE IF NOT EXISTS econ_calendar (
  source        TEXT        NOT NULL,
  event_id      TEXT        NOT NULL,
  country       TEXT,
  event         TEXT        NOT NULL,
  importance    SMALLINT,              -- 1 baja · 2 media · 3 alta
  scheduled_at  TIMESTAMPTZ NOT NULL,
  published_at  TIMESTAMPTZ NOT NULL,
  forecast      DOUBLE PRECISION,
  previous      DOUBLE PRECISION,
  actual        DOUBLE PRECISION,
  actual_published_at TIMESTAMPTZ,
  ingested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw           JSONB,
  PRIMARY KEY (source, event_id)
);
CREATE INDEX IF NOT EXISTS econ_calendar_proximos_idx ON econ_calendar (scheduled_at, importance);

-- --- Salud de las fuentes ------------------------------------------------------------------------
-- Sin esto, una fuente caída es indistinguible de una fuente sin novedades, y el sistema creería
-- estar bien informado cuando lleva días a ciegas. Es lo que permite bajar la confianza en vez de
-- fingir que no pasa nada.
CREATE TABLE IF NOT EXISTS data_sources (
  source        TEXT        PRIMARY KEY,
  last_ok_at    TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error    TEXT,
  rows_last_run INTEGER     NOT NULL DEFAULT 0,
  runs_ok       INTEGER     NOT NULL DEFAULT 0,
  runs_error    INTEGER     NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
