# TradeMe quant — entorno offline (Python)
FROM python:3.11-slim
WORKDIR /app/apps/quant
COPY apps/quant/pyproject.toml apps/quant/README.md ./
COPY apps/quant/trademe_quant ./trademe_quant
COPY artifacts /app/artifacts
RUN pip install --no-cache-dir -e ".[dev]"
# Contenedor de tooling: no es un servicio. Mantener vivo para ejecutar trabajos quant.
EXPOSE 8000
CMD ["uvicorn", "trademe_quant.service:app", "--host", "0.0.0.0", "--port", "8000"]
