FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/requirements.lock /app/backend/requirements.lock
RUN pip install --no-cache-dir -r requirements.lock
COPY backend /app/backend
COPY public/test-store/crownley /app/public/test-store/crownley
COPY components/commerce/test-store/crownley/snapshot.json /app/components/commerce/test-store/crownley/snapshot.json
RUN useradd --create-home commerce && chown -R commerce:commerce /app
USER commerce
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "60"]
