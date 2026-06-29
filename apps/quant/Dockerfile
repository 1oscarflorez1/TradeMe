# TradeMe quant — entorno offline (Python)
FROM python:3.11-slim
WORKDIR /app/apps/quant
COPY apps/quant/pyproject.toml apps/quant/README.md ./
COPY apps/quant/trademe_quant ./trademe_quant
RUN pip install --no-cache-dir -e ".[dev]"
# Contenedor de tooling: no es un servicio. Mantener vivo para ejecutar trabajos quant.
CMD ["python", "-c", "import trademe_quant; print('trademe-quant', trademe_quant.__version__, 'listo')"]
