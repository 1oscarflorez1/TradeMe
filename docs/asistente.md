# Asistente con modelo de lenguaje

El botón 🤖 de la esquina inferior derecha funciona de dos maneras:

- **Sin configurar** (por defecto): responde una base de conocimiento local, en el navegador, con el
  estado en vivo del sistema. Cero coste, cero red, cero claves. Entiende preguntas por palabras
  clave.
- **Con modelo**: responde un modelo de lenguaje real, al que la API le entrega el mismo estado en
  vivo. Entiende cualquier formulación y razona sobre las cifras.

Si el modelo falla —red caída, cupo agotado, proveedor con problemas— **responde la base local**. El
asistente nunca se queda mudo.

## Por qué la llamada va por la API y no por el navegador

Si el navegador hablara directamente con el proveedor, la clave viajaría al cliente y cualquiera
podría leerla desde las herramientas de desarrollo del navegador. Va por `POST /assistant/ask`, así
que la clave no sale de la máquina y el cupo se controla por usuario.

## Un adaptador, cinco proveedores

Groq, Cerebras, Mistral, OpenRouter y Ollama hablan todos el formato de chat de OpenAI. Cambiar de
uno a otro es cambiar dos variables.

| Proveedor | `ASSISTANT_BASE_URL` | Modelo sugerido | Plan gratuito |
|---|---|---|---|
| **Groq** *(recomendado)* | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | 30 peticiones/min, 14 400/día, sin tarjeta |
| **Cerebras** | `https://api.cerebras.ai/v1` | `llama-3.3-70b` | ~1 M tokens/día |
| **Mistral** | `https://api.mistral.ai/v1` | `mistral-small-latest` | ~1 000 M tokens/mes |
| **OpenRouter** | `https://openrouter.ai/api/v1` | cualquiera con sufijo `:free` | ~50 peticiones/día sin comprar créditos |
| **Ollama** (en tu equipo) | `http://ollama:11434/v1` | `qwen2.5:7b` o `llama3.1:8b` | ilimitado, pero consume tu RAM |

> Los límites de los planes gratuitos cambian a menudo. Verifícalos antes de comprometerte.

## Cómo activarlo

Añade a `infra/.env.prod` y vuelve a levantar el stack:

```env
ASSISTANT_BASE_URL=https://api.groq.com/openai/v1
ASSISTANT_API_KEY=tu_clave
ASSISTANT_MODEL=llama-3.3-70b-versatile
```

La clave gratuita de Groq se obtiene en `console.groq.com`, sin tarjeta. La pestaña **Estado** y la
cabecera del propio asistente muestran qué proveedor está en uso, sin revelar la clave.

Para desactivarlo, deja `ASSISTANT_BASE_URL` vacío: vuelve a la base local sin tocar nada más.

## Qué se le envía al modelo, exactamente

Solo lo que necesita para responder con propiedad:

- Versión de la plataforma y si la operación real está habilitada (siempre: no).
- Activo y temporalidad en pantalla.
- La decisión en vivo: acción, dirección, confianza, inclinación, régimen, ADX, precio y ATR.
- Los votos actuales de los ocho indicadores.
- Estadísticas de registros: totales, objetivos, stops, cierres por tiempo, acierto y expectancy.
- Configuración activa: pesos, banda neutra, si está optimizada.
- El aporte real medido de cada indicador.

**No se envía**: claves, contraseñas, correos, tokens, direcciones IP ni nada de la base de datos
que no sea una cifra agregada. El contexto se construye en `apps/api/src/assistant/context.ts` y se
puede leer entero de un vistazo.

Aun así, esto son datos de tu sistema saliendo a un tercero. Si eso no es aceptable, la opción es
Ollama: mismo adaptador, todo dentro de tu red.

## Si prefieres que nada salga de tu red: Ollama

Añade el servicio al compose y apunta el asistente a él:

```yaml
  ollama:
    image: ollama/ollama:latest
    restart: unless-stopped
    volumes:
      - ollama_models:/root/.ollama
```

```env
ASSISTANT_BASE_URL=http://ollama:11434/v1
ASSISTANT_API_KEY=
ASSISTANT_MODEL=qwen2.5:7b
```

Y descarga el modelo una vez:

```powershell
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec ollama ollama pull qwen2.5:7b
```

**Coste real**: un modelo de 7 000 millones de parámetros cuantizado ocupa unos 5 GB y necesita
otros 2–3 GB de margen. Tu equipo ya sostiene Postgres, Redis, la API, quant y la web — y el plan
contempla añadir el gateway de IBKR, que pide otro giga. Mídelo antes de dejarlo fijo.

## Salvaguardas

- **Cupo por usuario**: 6 preguntas por minuto y 120 al día. Evita que una pestaña abierta agote el
  plan gratuito y deje al equipo sin asistente el resto del día.
- **Instrucciones que el modelo no puede saltarse**: no da asesoría financiera, no recomienda operar,
  no promete rentabilidad, y los datos concretos solo pueden salir del contexto que se le entrega —
  si no está ahí, debe decir que no lo sabe en vez de inventarlo.
- **Tiempo máximo de espera** y límite de tokens configurables.
- El historial que se envía se limita a los últimos intercambios.

## Lo que el asistente no puede hacer

No opera, no toca la configuración y no lanza procesos. Solo lee y explica. Cualquier acción sobre
la plataforma se hace desde sus propios botones.
