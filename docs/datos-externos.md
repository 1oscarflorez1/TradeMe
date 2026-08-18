# Data Intelligence Layer (M11)

La capa que **prepara datos y no decide nada**. Obtiene información de fuentes externas, la valida,
la normaliza y la guarda con su fecha de conocimiento. Ninguna señal cambia por su culpa: el
Fundamental Score es M12.

Esa separación es deliberada. Registrar primero y decidir después es lo que permite **comprobar** si
el análisis fundamental aporta algo, en vez de darlo por supuesto — y la primera comprobación que se
hizo con esta capa desmintió la hipótesis que la justificaba.

## La regla que sostiene el hito

```
observed_at   a qué momento se REFIERE el dato
published_at  cuándo se SUPO
```

El IPC de julio se publica a mediados de agosto. Un backtest situado el 10 de agosto **no puede
verlo**, aunque hable de un mes ya terminado. Sin esa distinción, cualquier medición del análisis
fundamental sería una reconstrucción con datos del futuro: *look-ahead*, el fallo más difícil de
detectar porque no rompe nada — solo produce resultados magníficos que no se reproducen jamás.

Por eso `published_at` es obligatorio en las cuatro tablas: un dato sin fecha de conocimiento no se
puede usar honestamente, así que no se guarda.

**`as_of()` es la única forma autorizada de leer estas tablas.** Filtra por `published_at <= momento`,
no por `observed_at`. Cualquier otra consulta podría olvidar el filtro y devolver datos del futuro
sin que nadie lo note.

## Fuentes de la fase 1

| Fuente | Qué trae | Clave | Cadencia | Histórico |
|---|---|---|---|---|
| **Binance** | funding, interés abierto, long/short | No | 15 min | **Sí** |
| **Fear & Greed** (alternative.me) | sentimiento 0–100 | No | 6 h | Sí |
| **BCE** | tipo de depósito, IPC de la zona euro | No | 12 h | Sí |
| **FRED** | tipos, IPC y empleo de EE. UU. | Sí (gratuita) | 12 h | Sí |

Tres de las cuatro funcionan **desde el primer despliegue, sin registrarse en ningún sitio**. FRED
pide una clave gratuita en `fred.stlouisfed.org`; sin ella queda **apagado, no roto**, y el sistema
sigue con las demás.

```env
FRED_API_KEY=tu_clave   # opcional
```

## Degradación grácil

Cada fuente va aislada. Si una falla o está apagada, se anota en la tabla `data_sources` y las demás
siguen. Una fuente ausente **nunca** se convierte en un dato inventado ni en un ciclo perdido.

`data_sources` guarda el último éxito, el último error y los recuentos de cada fuente. Sin eso, una
fuente caída y una fuente sin novedades son indistinguibles, y el sistema creería estar bien
informado llevando días a ciegas. Es lo que permitirá en M12 **bajar la confianza** del score en vez
de fingir que todo va bien.

## Relleno retroactivo, y la primera hipótesis comprobada

Binance publica el histórico de funding, así que se puede **reconstruir el contexto de decisiones ya
tomadas sin inventar nada**: el funding de aquel momento es un hecho registrado, no una estimación
de hoy.

La primera pregunta que se le hizo a esta capa fue la que justificaba todo el roadmap fundamental:
*¿habría evitado el escudo macro los 69 cortos de 4h que costaron −0,723 R?*

Reconstruido el funding desde el 23 de julio y recalculado el sesgo con la fórmula y los parámetros
exactos del motor (EMA 20 semanal, cierre semanal):

| Métrica | Valor en la ventana de los 69 cortos |
|---|---|
| macroBias medio | **−0,496** (bajista) |
| Componente funding | −0,108 |
| Componente tendencia semanal | −0,884 |
| Veces que habría **vetado** un corto | **0 de 60** |
| Veces que habría **reforzado** el corto | **60 de 60** |

**La respuesta es no.** El escudo macro habría estado de acuerdo con los cortos y los habría
reforzado. El diagnóstico original —«operaba contra una tendencia alcista de fondo»— era una
inferencia a partir de los desenlaces, no una medición: hubo un rebote de corto plazo dentro de una
tendencia semanal claramente bajista.

Eso **no invalida el análisis fundamental**, pero cambia su argumento. Sigue justificándose porque
el funding, el macro y el calendario **no derivan del precio**, y son la primera evidencia
independiente en un comité cuyos seis votos colapsan en 1,41 efectivos. Ya no se justifica por
«habría salvado el 4h», que es sencillamente falso.

Y es exactamente para lo que existe M11: si hubiéramos construido M12 sobre aquella tesis,
habríamos cableado un escudo que empeora el problema que decía resolver.

## Añadir una fuente

Implementar `fetch()` y declarar `id`, `table` y `cadence_s`. El resto —cadencia, validación,
deduplicación, salud, aislamiento de errores— ya está resuelto.

```python
class MiFuente(DataProvider):
    id = "mi_fuente"
    table = "sentiment"
    cadence_s = 3600

    def fetch(self) -> list[Record]:
        return [Record(observed_at=..., published_at=..., value=..., key="...")]
```

`validate()` descarta lo que no se puede usar: sin fecha de conocimiento, conocido antes de
ocurrir, o con valores imposibles. No se corrige ni se adivina — se descarta y se deja constancia.
