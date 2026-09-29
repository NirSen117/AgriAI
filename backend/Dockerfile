FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --retries=5 CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"
CMD ["uvicorn", "app.main:app", "--app-dir", "/app", "--host", "0.0.0.0", "--port", "8000"]
