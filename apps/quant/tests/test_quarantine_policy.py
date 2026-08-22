"""Tests del gobierno automático de la cuarentena (M10.7)."""

from __future__ import annotations

import inspect
from datetime import UTC, datetime, timedelta
from typing import Any

from trademe_quant.nula import MIN_BLOQUES, MIN_POBLACION
from trademe_quant.quarantine_policy import (
    MAX_EXPECTANCY_ENTRADA,
    MIN_EXPECTANCY_SALIDA,
    MIN_SAMPLES_ENTRADA,
    MIN_SAMPLES_SALIDA,
    Poblacion,
    decide_quarantine,
    estado_previo,
    evaluate_real,
    evaluate_shadow,
    umbral_salida,
)

INICIO = datetime(2026, 8, 1, tzinfo=UTC)
#: Instante de las decisiones observadas: después de toda la población sintética de abajo.
AHORA = INICIO + timedelta(days=19, hours=12)


def _sombra(n: int, r: float) -> list[dict[str, Any]]:
    return [
        {
            "shadow_outcome_return_r": r,
            "outcome_return_r": None,
            "captured_at": AHORA - timedelta(minutes=i),
        }
        for i in range(n)
    ]


def _real(n: int, r: float) -> list[dict[str, Any]]:
    return [
        {
            "outcome_return_r": r,
            "shadow_outcome_return_r": None,
            "captured_at": AHORA - timedelta(minutes=i),
        }
        for i in range(n)
    ]


def _poblacion(valor_dia: list[float], dias: int = 20, por_dia: int = 30) -> Poblacion:
    """Población sintética: cada día homogéneo, con su valor propio. `dias * por_dia` decisiones."""
    rs: list[float] = []
    fechas: list[datetime] = []
    for d in range(dias):
        for k in range(por_dia):
            rs.append(valor_dia[d % len(valor_dia)])
            fechas.append(INICIO + timedelta(days=d, minutes=k))
    return Poblacion(rs, fechas)


# --- Resúmenes -------------------------------------------------------------------------------


def test_expedientes_no_se_mezclan() -> None:
    """El aislamiento es la razón de ser del diseño: una sombra no es rendimiento."""
    filas = _sombra(10, 1.0) + _real(5, -1.0)
    assert evaluate_shadow(filas)["n"] == 10
    assert evaluate_real(filas)["n"] == 5
    assert evaluate_shadow(filas)["expectancy"] == 1.0
    assert evaluate_real(filas)["expectancy"] == -1.0


def test_resumen_sin_datos() -> None:
    assert evaluate_shadow([])["n"] == 0
    assert evaluate_real([])["expectancy"] == 0.0


# --- Salir de cuarentena ---------------------------------------------------------------------


def test_no_sale_sin_muestra_aunque_gane() -> None:
    """La comprobación que importa: una racha buena y corta NO levanta la cuarentena.

    Es el modo natural de equivocarse aquí — ver tres días buenos y volver a operar algo que
    perdía dinero.
    """
    ev = evaluate_shadow(_sombra(MIN_SAMPLES_SALIDA - 1, 2.0))
    sigue, motivo = decide_quarantine(True, ev)
    assert sigue is True
    assert "decisiones sombra evaluadas" in motivo


def test_no_sale_con_muestra_pero_sin_ventaja() -> None:
    ev = evaluate_shadow(_sombra(80, 0.0))
    sigue, motivo = decide_quarantine(True, ev)
    assert sigue is True and "se exige" in motivo


def test_sale_con_muestra_y_ventaja() -> None:
    ev = evaluate_shadow(_sombra(60, 0.30))
    sigue, motivo = decide_quarantine(True, ev)
    assert sigue is False
    assert "sale de cuarentena" in motivo


def test_el_umbral_de_salida_es_estricto() -> None:
    """Justo por debajo no sale; justo por encima sí. Sin zona gris."""
    justo_debajo = evaluate_shadow(_sombra(60, MIN_EXPECTANCY_SALIDA - 0.01))
    justo_encima = evaluate_shadow(_sombra(60, MIN_EXPECTANCY_SALIDA + 0.01))
    assert decide_quarantine(True, justo_debajo)[0] is True
    assert decide_quarantine(True, justo_encima)[0] is False


# --- Entrar en cuarentena --------------------------------------------------------------------


def test_entra_si_pierde_de_forma_sostenida() -> None:
    ev = evaluate_real(_real(50, -0.5))
    entra, motivo = decide_quarantine(False, ev)
    assert entra is True and "entra en cuarentena" in motivo


def test_no_entra_con_muestra_insuficiente() -> None:
    ev = evaluate_real(_real(5, -0.9))
    entra, _ = decide_quarantine(False, ev)
    assert entra is False


def test_no_entra_si_solo_pierde_un_poco() -> None:
    ev = evaluate_real(_real(50, MAX_EXPECTANCY_ENTRADA + 0.01))
    assert decide_quarantine(False, ev)[0] is False


# --- Asimetría -------------------------------------------------------------------------------


def test_cuesta_mas_salir_que_entrar() -> None:
    """Deliberadamente asimétrico: dejar de operar es barato, volver a operar no.

    Con la MISMA muestra, una expectancy que basta para no entrar en cuarentena no basta para
    salir de ella.
    """
    n = MIN_SAMPLES_SALIDA
    exp = 0.0  # ni gana ni pierde
    assert decide_quarantine(False, evaluate_real(_real(n, exp)))[0] is False  # no entra
    assert decide_quarantine(True, evaluate_shadow(_sombra(n, exp)))[0] is True  # tampoco sale


def test_el_motivo_siempre_explica_la_decision() -> None:
    """Una decisión automática que no se puede explicar no es auditable."""
    for en_cuarentena in (True, False):
        for filas in ([], _sombra(60, 0.3), _real(50, -0.5)):
            ev = evaluate_shadow(filas) if en_cuarentena else evaluate_real(filas)
            _, motivo = decide_quarantine(en_cuarentena, ev)
            assert isinstance(motivo, str) and len(motivo) > 10


# --- El expediente mira lo reciente, no toda la historia (arreglo del 17/08/2026) ------------


def test_lo_antiguo_no_diluye_lo_reciente() -> None:
    """El caso real de 15m: 65 decisiones malas recientes tapadas por 155 buenas antiguas.

    Promediando todo salía −0,029 R y la temporalidad se libraba de la cuarentena por un pasado
    que ya no la describe. Cambiar la configuración cambia el sujeto medido.
    """
    recientes = _real(65, -0.26)
    antiguas = _real(155, 0.068)
    filas = recientes + antiguas  # ordenado de más reciente a más antigua, como llega de la BD

    todo = sum(float(r["outcome_return_r"]) for r in filas) / len(filas)
    assert -0.05 < todo < 0.0, todo  # promediando todo, no llega al umbral

    ev = evaluate_real(filas)
    assert ev["n"] == MIN_SAMPLES_ENTRADA
    assert ev["expectancy"] < MAX_EXPECTANCY_ENTRADA
    assert decide_quarantine(False, ev)[0] is True  # ahora sí entra


def test_la_ventana_es_el_minimo_de_muestra_ya_exigido() -> None:
    """La ventana no se eligió mirando el resultado: es el umbral que ya estaba escrito."""
    assert evaluate_real(_real(500, 1.0))["n"] == MIN_SAMPLES_ENTRADA
    assert evaluate_shadow(_sombra(500, 1.0))["n"] == MIN_SAMPLES_SALIDA


def test_con_menos_decisiones_que_la_ventana_se_usan_todas() -> None:
    ev = evaluate_real(_real(7, -0.5))
    assert ev["n"] == 7
    assert decide_quarantine(False, ev)[0] is False  # y sigue sin bastar para decidir


def test_se_respeta_el_orden_de_llegada() -> None:
    """Si la base devolviera lo antiguo primero, el arreglo no serviría de nada."""
    filas = _real(40, 1.0) + _real(40, -1.0)
    assert evaluate_real(filas)["expectancy"] == 1.0
    assert evaluate_real(list(reversed(filas)))["expectancy"] == -1.0


# --- La nula de la puerta de salida (Hito A, 22/08/2026) --------------------------------------
#
# La cuarentena era el único módulo con poder de veto activo y el único sin control contra el azar.
# Lo que se comprueba aquí es que el control **solo endurece**: sin nula calculable, o con una nula
# plana, la decisión tiene que salir exactamente igual que antes de existir este bloque.


def test_sin_poblacion_decide_igual_que_antes() -> None:
    """La compatibilidad hacia atrás es el listón: sin población, comportamiento de siempre."""
    ev = evaluate_shadow(_sombra(60, 0.30))
    assert ev["nula_p95"] == 0.0
    assert decide_quarantine(True, ev)[0] is False  # sale, como antes del Hito A


def test_nula_plana_se_comporta_como_el_umbral_fijo() -> None:
    """Extremo conocido: si el azar da siempre 0, el umbral efectivo es el fijo de 0,05."""
    poblacion = _poblacion([0.0])
    justo_debajo = evaluate_shadow(_sombra(60, MIN_EXPECTANCY_SALIDA - 0.01), poblacion=poblacion)
    justo_encima = evaluate_shadow(_sombra(60, MIN_EXPECTANCY_SALIDA + 0.01), poblacion=poblacion)
    assert justo_debajo["nula_p95"] == 0.0
    assert decide_quarantine(True, justo_debajo)[0] is True
    assert decide_quarantine(True, justo_encima)[0] is False


def test_poblacion_insuficiente_no_inventa_listón() -> None:
    """Sin bloques ni filas bastantes no hay percentil: se devuelve 0,0 y manda el fijo."""
    pocas_filas = _poblacion([1.0], dias=20, por_dia=2)  # 40 < MIN_POBLACION
    pocos_bloques = _poblacion([1.0, -1.0], dias=MIN_BLOQUES - 1, por_dia=60)
    assert len(pocas_filas.rs) < MIN_POBLACION
    for poblacion in (pocas_filas, pocos_bloques):
        ev = evaluate_shadow(_sombra(60, 0.30), poblacion=poblacion)
        assert ev["nula_p95"] == 0.0
        assert decide_quarantine(True, ev)[0] is False  # sale: igual que sin nula


def test_una_racha_buena_de_mercado_ya_no_basta_para_salir() -> None:
    """El caso que motiva el Hito A.

    La plataforma entera está en una racha de +1 R. Una temporalidad vetada cuya sombra da +0,30 R
    superaba el umbral fijo de 0,05 y salía. Pero +0,30 es PEOR que lo que daba coger decisiones
    cualesquiera de esos mismos días: no ha demostrado nada sobre sí misma, solo que hubo mercado.
    """
    poblacion = _poblacion([1.0, 0.8, 1.2, 0.9, 1.1])
    ev = evaluate_shadow(_sombra(60, 0.30), poblacion=poblacion)

    assert ev["expectancy"] >= MIN_EXPECTANCY_SALIDA  # antes del Hito A habría salido
    assert ev["nula_mediana"] > MIN_EXPECTANCY_SALIDA  # un tramo típico del mercado da más
    sigue, motivo = decide_quarantine(True, ev)
    assert sigue is True
    assert "tramo típico del mercado" in motivo


def test_la_nula_nunca_deja_salir_a_quien_el_umbral_fijo_retenia() -> None:
    """Monotonía: la regla nueva solo puede endurecer, jamás relajar. En ningún caso.

    Es la garantía que se prometió al aprobar el hito, y la única forma de comprobarla es barrer
    combinaciones en vez de fiarse de un ejemplo favorable.
    """
    poblaciones = [
        _poblacion([0.0]),
        _poblacion([1.0, -1.0]),
        _poblacion([-0.9, -1.0, -0.8]),
        _poblacion([1.0, 0.8, 1.2, 0.9, 1.1]),
    ]
    for poblacion in poblaciones:
        for exp in (-1.0, -0.2, 0.0, 0.049, 0.05, 0.3, 1.0, 3.0):
            ev = evaluate_shadow(_sombra(60, exp), poblacion=poblacion)
            salia_antes = exp >= MIN_EXPECTANCY_SALIDA
            sale_ahora = decide_quarantine(True, ev)[0] is False
            assert not (sale_ahora and not salia_antes), (exp, ev["nula_p95"])


# --- La puerta de ENTRADA no lleva nula, y no puede llevarla por accidente ---------------------


def test_la_entrada_no_admite_poblacion_ni_por_error() -> None:
    """Aislamiento estructural, no de disciplina: la firma ni siquiera acepta el argumento.

    Exigir significancia para ENTRAR dejaría operando temporalidades malas mientras no se demuestre
    que lo son. Es el error contrario y el caro. Que no se pueda pasar la población hace imposible
    ese fallo aunque alguien lo intente.
    """
    assert "poblacion" not in inspect.signature(evaluate_real).parameters
    assert "poblacion" in inspect.signature(evaluate_shadow).parameters


def test_la_entrada_decide_igual_aunque_le_metan_una_nula_altisima() -> None:
    """Y si alguien construyera la evidencia a mano con `nula_p95`, la entrada la ignora."""
    ev = evaluate_real(_real(50, -0.5))
    ev["nula_p95"] = 5.0  # un listón absurdo que, de leerse, cambiaría el resultado
    entra, motivo = decide_quarantine(False, ev)
    assert entra is True
    assert "entra en cuarentena" in motivo


def test_la_entrada_sigue_siendo_barata_y_la_salida_cara() -> None:
    """La asimetría original, ahora con la nula puesta: la distancia entre puertas solo crece."""
    poblacion = _poblacion([1.0, 0.8, 1.2, 0.9, 1.1])
    exp = 0.30
    assert decide_quarantine(False, evaluate_real(_real(60, exp)))[0] is False  # no entra
    ev = evaluate_shadow(_sombra(60, exp), poblacion=poblacion)
    assert decide_quarantine(True, ev)[0] is True  # y tampoco sale


def test_el_motivo_sigue_explicando_la_decision_con_nula() -> None:
    poblacion = _poblacion([1.0, 0.8, 1.2, 0.9, 1.1])
    for exp in (-0.5, 0.3, 2.0):
        ev = evaluate_shadow(_sombra(60, exp), poblacion=poblacion)
        _, motivo = decide_quarantine(True, ev)
        assert isinstance(motivo, str) and len(motivo) > 10
        assert "R" in motivo


def test_la_evidencia_publica_los_dos_numeros() -> None:
    """`n` y el listón del azar tienen que verse los dos, no esconderse tras el veredicto."""
    ev = evaluate_shadow(_sombra(60, 0.3), poblacion=_poblacion([1.0, -1.0]))
    assert ev["n_poblacion"] > 0
    assert ev["bloques_poblacion"] >= MIN_BLOQUES
    assert "nula_p95" in ev


# --- El destrabe: quién está vetado se lee del artefacto, no solo del yaml (22/08/2026) --------
#
# `publish` decidía a qué expediente mirar con `interval in quarantine_intervals` —la lista del
# yaml, por temporalidad— cuando quien veta de verdad es `quarantine.json`, por clave. Una clave
# vetada por rendimiento real dejaba de producir desenlaces reales, su expediente se congelaba, y se
# la recondenaba cada ciclo con las mismas filas sin llegar jamás a la puerta de salida.


def test_el_yaml_veta_por_temporalidad() -> None:
    assert estado_previo({}, "BTCUSDT:4h", "4h", ["4h"]) is True
    assert estado_previo({}, "BTCUSDT:15m", "15m", ["4h"]) is False


def test_el_artefacto_veta_por_clave() -> None:
    """Lo que arregla el destrabe: 15m vetada en BTC no dice nada de 15m en ETH."""
    politica = {"intervals": {"BTCUSDT:15m": {"quarantined": True}}}
    assert estado_previo(politica, "BTCUSDT:15m", "15m", []) is True
    assert estado_previo(politica, "ETHUSDT:15m", "15m", []) is False


def test_sin_artefacto_manda_el_yaml_y_nada_mas() -> None:
    """Compatibilidad hacia atrás: es exactamente el comportamiento anterior al destrabe."""
    vacias: list[dict[str, Any]] = [{}, {"intervals": {}}, {"intervals": None}]
    for politica in vacias:
        assert estado_previo(politica, "BTCUSDT:15m", "15m", []) is False
        assert estado_previo(politica, "BTCUSDT:4h", "4h", ["4h"]) is True


def test_un_artefacto_corrupto_no_veta_ni_revienta() -> None:
    """Lo escribe otro proceso; una entrada rara cae al yaml en vez de tumbar el ciclo."""
    politica: dict[str, Any] = {
        "intervals": {"BTCUSDT:15m": None, "BTCUSDT:30m": "sí", "BTCUSDT:1h": []}
    }
    for clave, interval in (("BTCUSDT:15m", "15m"), ("BTCUSDT:30m", "30m"), ("BTCUSDT:1h", "1h")):
        assert estado_previo(politica, clave, interval, []) is False


def test_el_yaml_es_suelo_no_techo() -> None:
    """El yaml puede vetar lo que el artefacto daba por operando; al revés, no."""
    politica: dict[str, Any] = {"intervals": {"BTCUSDT:4h": {"quarantined": False}}}
    assert estado_previo(politica, "BTCUSDT:4h", "4h", ["4h"]) is True

    # Y quitar la temporalidad del yaml NO levanta un veto vigente: se sale con evidencia, no
    # editando un fichero.
    politica = {"intervals": {"BTCUSDT:4h": {"quarantined": True}}}
    assert estado_previo(politica, "BTCUSDT:4h", "4h", []) is True


def test_una_clave_atrapada_pasa_a_juzgarse_por_su_sombra(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """La prueba que importa, sobre el ciclo entero.

    Antes: `BTCUSDT:15m` estaba vetada en el artefacto, su intervalo no figuraba en el yaml, y se la
    juzgaba con un expediente real congelado en -0,940 R. Se recondenaba en cada pasada.
    Ahora: se la juzga con su expediente sombra, que sí crece, y con la puerta de salida.
    """
    from trademe_quant import quarantine_policy as qp

    filas = _sombra(20, 0.5) + _real(30, -0.94)
    monkeypatch.setattr(qp, "fetch_expedientes", lambda dsn: ({"BTCUSDT:15m": filas}, None))

    # Primera pasada sin artefacto: manda el yaml, que no incluye 15m -> se la juzga por lo real.
    out = qp.publish(tmp_path, "dsn", [])
    entrada = out["intervals"]["BTCUSDT:15m"]
    assert entrada["quarantined"] is True
    assert entrada["evidence"]["source"] == "real"
    assert entrada["changed"] is True

    # Segunda pasada: el artefacto ya la marca vetada, así que ahora mira su SOMBRA.
    out = qp.publish(tmp_path, "dsn", [])
    entrada = out["intervals"]["BTCUSDT:15m"]
    assert entrada["evidence"]["source"] == "sombra"
    assert entrada["evidence"]["n"] == 20
    # Sigue vetada porque le faltan decisiones, no porque nadie la mire.
    assert entrada["quarantined"] is True
    assert "decisiones sombra evaluadas" in entrada["reason"]
    # Y deja de anunciar un cambio que no ocurre: antes esto disparaba una alerta cada ciclo.
    assert entrada["was_quarantined"] is True
    assert entrada["changed"] is False


def test_el_destrabe_no_libera_a_nadie_de_golpe(tmp_path, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """Con muestra sombra insuficiente, pasar a juzgarla por sombra la deja vetada igual."""
    from trademe_quant import quarantine_policy as qp

    # Sombra corta pero excelente: el tipo de caso que podría soltar a alguien por accidente.
    filas = _sombra(MIN_SAMPLES_SALIDA - 1, 2.0) + _real(30, -0.9)
    monkeypatch.setattr(qp, "fetch_expedientes", lambda dsn: ({"BTCUSDT:30m": filas}, None))
    qp.publish(tmp_path, "dsn", [])
    out = qp.publish(tmp_path, "dsn", [])
    assert out["intervals"]["BTCUSDT:30m"]["quarantined"] is True


# --- El umbral de salida es no-inferioridad, no un cupo (22/08/2026, corrige la v0.46.0) ------
#
# La v0.46.0 exigió el percentil 95 de una nula muestreada de la PROPIA plataforma. Eso no es un
# listón de calidad, es un cupo del 5 %: pedía un 57 % de aciertos para volver cuando para seguir
# operando bastaba un 28 %, y la mitad de las claves que operaban ese día no habrían podido regresar
# con el rendimiento que tenían.


def test_una_temporalidad_rentable_puede_volver() -> None:
    """El caso que motiva la corrección: BTCUSDT:1m opera con +0,267 R y no habría podido volver.

    Con el mercado en calma —mediana en torno a 0— el listón vuelve a ser el fijo de 0,05 R, así que
    una temporalidad rentable recupera su sitio. Con el P95 se le exigían ~0,70 R.
    """
    poblacion = _poblacion([0.4, -0.4, 0.2, -0.2, 0.0])
    ev = evaluate_shadow(_sombra(60, 0.267), poblacion=poblacion)
    assert ev["nula_p95"] > 0.267  # con el criterio viejo no habría salido
    assert decide_quarantine(True, ev)[0] is False  # con el nuevo, sí


def test_el_liston_sigue_a_la_mediana_del_mercado() -> None:
    """Neutralidad de régimen, el objetivo del Hito A: sube en rachas buenas y baja en malas."""
    buena = evaluate_shadow(_sombra(60, 0.30), poblacion=_poblacion([1.0, 0.9, 1.1]))
    calma = evaluate_shadow(_sombra(60, 0.30), poblacion=_poblacion([0.1, -0.1, 0.0]))
    assert umbral_salida(buena) > umbral_salida(calma)
    assert decide_quarantine(True, buena)[0] is True  # no basta: solo hubo mercado
    assert decide_quarantine(True, calma)[0] is False  # aquí sí demuestra algo


def test_el_suelo_absoluto_aguanta_un_mercado_malo() -> None:
    """Con la mediana negativa `mediana + 0,05` sería negativo. Salir con 0,00 R sigue sin valer."""
    poblacion = _poblacion([-0.8, -1.0, -0.9, -0.7, -1.0])
    ev = evaluate_shadow(_sombra(60, 0.0), poblacion=poblacion)
    assert ev["nula_mediana"] < 0
    assert umbral_salida(ev) == MIN_EXPECTANCY_SALIDA
    assert decide_quarantine(True, ev)[0] is True


def test_el_umbral_de_salida_no_es_un_cupo() -> None:
    """La propiedad que distingue un listón de un cupo, comprobada sobre la nula misma.

    Con el P95, el umbral por construcción solo lo cruza ~1 de cada 20 tramos de la plataforma. Con
    la mediana, en torno a la mitad — más la asimetría de 0,05 R, que es deliberada.
    """
    ev = evaluate_shadow(_sombra(60, 0.30), poblacion=_poblacion([0.4, -0.4, 0.2, -0.2, 0.0]))
    assert umbral_salida(ev) < ev["nula_p95"]
    esperado = max(MIN_EXPECTANCY_SALIDA, ev["nula_mediana"] + MIN_EXPECTANCY_SALIDA)
    assert abs(umbral_salida(ev) - esperado) < 1e-9


def test_sin_nula_el_umbral_es_el_fijo_de_siempre() -> None:
    """Compatibilidad: sin población, `umbral_salida` es MIN_EXPECTANCY_SALIDA y nada cambia."""
    ev = evaluate_shadow(_sombra(60, 0.10))
    assert umbral_salida(ev) == MIN_EXPECTANCY_SALIDA
    assert decide_quarantine(True, ev)[0] is False


def test_la_entrada_sigue_sin_mirar_la_nula() -> None:
    """Decidido dejar intacto: la puerta de entrada no cambia con esta corrección."""
    ev = evaluate_real(_real(50, -0.5))
    ev["nula_mediana"] = 5.0
    ev["nula_p95"] = 9.0
    assert decide_quarantine(False, ev)[0] is True
