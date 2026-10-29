# panel-web/Dockerfile
# ─────────────────────────────────────────────────────────────────────────────
# Imagen Docker para el Panel Web Institucional de Supervisión (Expo Web)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Instalar dependencias respetando resolución de peer dependencies (React 19 / Expo)
COPY package.json package-lock.json* ./
RUN npm install --legacy-peer-deps

# Copiar código fuente del panel web
COPY . .

ENV EXPO_NO_TELEMETRY=1 \
    BROWSER=none

EXPOSE 8082

CMD ["npx", "expo", "start", "--web", "--port", "8082", "--host", "lan"]

