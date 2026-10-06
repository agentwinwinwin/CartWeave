FROM node:24-bookworm-slim AS model-runtime
WORKDIR /app
COPY package.json package-lock.json /app/
RUN npm ci --omit=dev --ignore-scripts

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
ENV COMMERCE_HARNESS_NODE=/usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*
COPY --from=model-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=model-runtime /app/node_modules /app/node_modules
WORKDIR /app/backend
COPY backend/requirements.lock /app/backend/requirements.lock
RUN pip install --no-cache-dir -r requirements.lock
COPY backend /app/backend
COPY agent-runtime /app/agent-runtime
COPY public/integration-skills /app/public/integration-skills
COPY public/test-store/crownley /app/public/test-store/crownley
COPY components/commerce/test-store/crownley/snapshot.json /app/components/commerce/test-store/crownley/snapshot.json
RUN useradd --create-home commerce && chown -R commerce:commerce /app
USER commerce
EXPOSE 8000
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "85"]
