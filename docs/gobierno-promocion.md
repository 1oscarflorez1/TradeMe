# La desconexión backtest ↔ realidad: no había tal desconexión

> El criterio que decidía qué configuración pasa a operar era **una línea**:
> `promoted = opt_exp > base_exp`. Puramente relativo. Cuatro de las doce configuraciones activas se
> promocionaron **prometiendo pérdidas**, porque la anterior perdía más.

## La premisa era falsa, y es una buena noticia

El hito se abrió para investigar por qué las configuraciones que ganan en el backtest fuera de
muestra se degradan en producción. **No ganan en el backtest.** El backtest y la producción están de
acuerdo: ambos dicen que estas configuraciones pierden.

No hay fuga de datos ni sobreajuste sofisticado. Lo que falla es el criterio de admisión.

## Lo que se descartó por el camino

**La vela en formación.** Producción decide sobre la vela abierta —`buffer.ts` la reemplaza a cada
tick— y el backtest sobre velas cerradas. Parecía la causa. Medido sobre `BTCUSDT:15m`, 7 días,
reconstruyendo el estado parcial de cada vela desde las de 1 minuto:

| momento | discrepa del cierre | expectancy |
|---|---|---|
| 25 % formada | 15,7 % | −0,140 R |
| 50 % formada | 13,6 % | −0,205 R |
| 75 % formada | 10,1 % | −0,168 R |
| **cierre (backtest)** | — | **−0,189 R** |

La decisión cambia en un 10-16 % de los casos, pero **la expectancy es la misma**. Diferencias de
±0,05 R con n≈300: ruido. No es la causa. Queda `run_vela_formacion_study` por si se quiere revisar
con otra clave o periodo.

**El walk-forward.** Tiene embargo entre bloques y purga de horizonte (`idx + horizon <= b`), así
que una operación nunca cruza del bloque de entrenamiento al de test. No se encontró leakage.

Y ese primer backtest ya apuntaba a lo importante: la config activa de `BTCUSDT:15m` da **−0,189 R**
en los últimos siete días. No se degradó en producción — nunca prometió otra cosa.

## La causa

```python
promoted = opt_exp > base_exp
```

Sin rentabilidad, sin muestra mínima, sin control contra el azar. Sobre los veinte informes
publicados:

| clave | promovida | base R | optimizada R | n hold-out |
|---|---|---|---|---|
| BTCUSDT:15m | sí | −0,768 | **−0,579** | 21 |
| BNBUSDT:30m | sí | −0,583 | **−0,274** | **11** |
| SOLUSDT:1d | sí | −0,258 | **−0,124** | 23 |
| BTCUSDT:30m | sí | −0,478 | **−0,066** | 32 |

Cuatro de las doce promovidas prometían perder. `BNBUSDT:30m` se decidió con **once operaciones**.
Con esa muestra, una diferencia de +0,19 R está entera dentro del ruido.

Y hay un efecto acumulativo que agrava lo anterior: **cada promoción compara contra la
configuración activa**, no contra un estándar. Si la activa ya está degradada, basta con perder un
poco menos para sustituirla. Es una carrera hacia abajo sin suelo.

## El quinto caso del mismo patrón

Umbrales decorativos → el cupo del percentil 95 en la cuarentena → el listón de ruido de los votos
efectivos → el régimen invertido → **la promoción relativa**.

Con una diferencia que importa: el optimizador es **el componente con más poder** sobre las
decisiones, porque reescribe los pesos enteros. Y era el único que nunca había pasado por el
gobierno que sí se exigió al Fundamental Score y a la cuarentena.

### Corrección (0.58.0): el meta-modelo tampoco había pasado

Esa frase decía «al meta-modelo» y era **falsa**. Auditado el 5-sep-2026, `metamodel.py` promovía
con `filtered > baseline and kept >= 30 %`: puramente relativo, sin muestra mínima seria y sin
control de azar. El mismo criterio que este documento declara inaceptable, vivo en el componente
que atenúa o veta decisiones ya tomadas.

Lo que dejaba pasar, medido: su tramo de prueba eran **134 filas repartidas en 6 días**, con cuatro
activos que la propia plataforma calcula como 1,46 independientes. De ahí salía un AUC de 0,74 que
nada comprobaba contra el azar.

Desde 0.58.0 el meta-modelo llama a `promocion.decidir` con una nula por bloques de 24 h sobre los
retornos del tramo de prueba. Las tres condiciones son las mismas para los dos componentes, y no
hay ya ningún camino de decisión que se promocione a sí mismo comparándose solo con su versión
anterior.

## El guardia

`promocion.decidir` exige **las tres**:

1. **Muestra mínima** — 25 operaciones en el hold-out.
2. **Rentabilidad** — expectancy ≥ +0,05 R. Que la base fuera peor no la hace buena.
3. **Superar al azar** — la mejora por encima del P95 de una nula que sortea por bloques de tiempo a
   cuál de las dos ramas se atribuye cada tramo.

**Solo endurece.** `mejora > nula ≥ 0` implica `optimizada > base`, así que todo lo que pase el
guardia nuevo habría pasado el viejo. Hay un test que barre el espacio para comprobarlo.

**No toca las configuraciones ya promovidas.** El guardia decide promociones futuras; lo que opera
hoy sigue operando.

## Qué habría pasado con las promociones de hoy

```
  promovidas hoy: 12   ·   seguirían siéndolo: 2   ·   se habrían frenado: 10
```

Y el motivo mayoritario **no es la rentabilidad, es la muestra**: ocho de las diez se frenan por
tener menos de 25 operaciones en el hold-out.

### Eso revela el problema de fondo, y es otro

**La ventana de optimización es demasiado corta para decidir nada.** Un hold-out de 11-32
operaciones no permite distinguir una mejora de una racha, por muy buen criterio que se le ponga
encima. El guardia lo hace visible en vez de dejar que el ruido decida.

Con el guardia activo, la plataforma **dejará de promocionar casi nada** hasta que la ventana crezca.
Eso es lo correcto —no promocionar es mejor que promocionar ruido— pero no es una solución: es un
freno. La solución es darle más historia al hold-out, y ese es el siguiente hito natural.

## Cómo reproducirlo

```
python -m trademe_quant.run_vela_formacion_study BTCUSDT 15m 7
```

Y para ver qué configuraciones no habrían pasado, los informes están en
`artifacts/optimized/report.*.json` con el bloque `promocion` desde esta versión.
