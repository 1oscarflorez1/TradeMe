# ¿Aporta Optuna? El veredicto, con muestra suficiente

> Reoptimizar **empeora** la configuración activa (p = 0,0013). Y ninguna configuración —ni la
> optimizada ni la activa— se distingue del `ensemble.yaml` escrito a mano.

## Por qué no se podía responder antes

El hold-out del optimizador eran **25 operaciones**, justo el mínimo del guardia. Con esa muestra la
diferencia entre una mejora y una racha no es medible, y el guardia frenaba el 100 % de las
promociones — con razón, pero dejando la pregunta abierta.

Desde 0.60.0 la ventana es de 20.000 velas y el hold-out pasa a **56-562 operaciones**. La pregunta
se vuelve contestable.

## El diseño

Cuatro condiciones sobre el **mismo hold-out intacto** (el 30 % final, nunca visto por la búsqueda):

| condición | qué es |
|---|---|
| **manual** | el `ensemble.yaml` de M3, escrito a mano, nunca optimizado |
| **activa** | lo que esa clave opera hoy — en 15 de 20 es una optimizada de agosto |
| **libre** | Optuna con el espacio de siempre: `suggest_float(0.0, 2.0)` sin restricción |
| **coherente** | Optuna con la conmutación de régimen obligada a significar lo que dice |

La cuarta existe porque la tercera tenía una salida fácil: 6 de las 15 configuraciones publicadas
invertían el régimen, así que «Optuna no aporta» podía ser «Optuna busca en un espacio que permite
configuraciones incoherentes». Separarlas era el objeto del estudio.

**El criterio se fijó antes de ver resultados**: aportar = ganar en más de la mitad de las claves.
Se cuenta por claves y no promediando expectancies, porque las claves comparten mercado —cuatro
activos que la plataforma calcula como 1,49 independientes— y promediar sobre ellas volvería a
inflar la evidencia, que es el error que este proyecto ya cometió una vez.

## El resultado (40 trials, 20 claves)

| clave | n hold-out | manual | activa | libre | coherente |
|---|---|---|---|---|---|
| BNBUSDT:15m | 476 | **0,042** | 0,010 | −0,037 | 0,019 |
| BNBUSDT:1h | 502 | −0,032 | **0,027** | −0,016 | −0,040 |
| BNBUSDT:30m | 235 | −0,082 | **0,170** | 0,012 | 0,025 |
| BTCUSDT:15m | 472 | 0,019 | 0,074 | 0,060 | **0,103** |
| BTCUSDT:30m | 539 | −0,068 | 0,008 | −0,065 | **0,068** |
| ETHUSDT:1d | 77 | 0,272 | **0,386** | 0,017 | 0,204 |
| SOLUSDT:15m | 562 | 0,051 | **0,121** | 0,017 | 0,018 |
| *(y 13 más)* | | | | | |

**Recuentos, con su contraste binomial de una cola:**

| comparación | recuento | p |
|---|---|---|
| **la activa gana a Optuna libre** | **17/20** | **0,0013** |
| **la activa gana a Optuna coherente** | **15/20** | **0,021** |
| la activa gana a la manual | 12/20 | 0,252 |
| Optuna libre gana a la manual | 11/20 | 0,412 |
| Optuna coherente gana a la manual | 9/20 | 0,748 |

Y **ninguna de las 40 configuraciones generadas pasa el guardia de promoción**: cero con libre, cero
con coherente.

## Qué significa, y qué no

**Lo que está establecido:**

1. **Reoptimizar ahora empeora.** No es un empate: la configuración activa bate a lo que Optuna
   encuentra en 17 de 20 claves, con p = 0,0013. Esto sí es señal.
2. **Nada se distingue del diseño manual.** Activa, libre y coherente están todas en el empate
   estadístico frente al `ensemble.yaml` de M3 (p entre 0,25 y 0,75). Un año de optimización
   automática no ha producido una configuración demostrablemente mejor que la escrita a mano.
3. **La coherencia de régimen no cuesta nada.** Se temía que restringir el espacio impusiera un
   prejuicio; medido, mejora ligeramente frente a la búsqueda libre (5/20 contra 3/20). El
   argumento para activarla es que el mecanismo signifique lo que dice, y ahora se sabe que ese
   argumento no se paga con rendimiento.

**Lo que NO está establecido:**

- **No** que «Optuna sea inútil» en abstracto. Lo medido es este espacio de búsqueda, con estos
  datos, contra estas configuraciones.
- **No** que la configuración manual sea buena. Es indistinguible de las demás, y todas rondan
  expectancies de ±0,1 R. Empatar en la mediocridad sigue siendo mediocridad.
- **No** que más trials no cambien nada — aunque se comprobó: ver la sección siguiente.

## El control: ¿eran pocos trials?

Es la objeción obvia, y se midió con 120 trials —el triple— sobre las mismas 20 claves. *(Resultados
en `artifacts/optimizador_estudio_120.json`.)*

## Qué hacer con esto

La recomendación honesta **no** es apagar el optimizador, sino **dejar de reoptimizar en piloto
automático**: el guardia de promoción ya lo impide de hecho (0 promociones), y ahora se sabe que eso
es correcto y no un exceso de celo.

Lo que sí abre este resultado es una pregunta mejor: si el espacio de pesos no tiene nada más que
dar, el margen no está en ajustar los votos sino en **qué se vota**. La plataforma sigue sin
habilidad direccional demostrable, y ningún reparto de pesos sobre los mismos ocho indicadores va a
producirla.

## Cómo reproducirlo

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_optimizador_estudio 40
```
