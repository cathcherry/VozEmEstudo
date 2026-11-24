# Voz em Estudo: one image for both Railway services.
#   API    (default): node backend/src/server.js   (serves frontend/ and /demo-media too)
#   Worker          : node backend/src/worker.js   (set as the worker service's start command,
#                     or point that service to deploy/railway.worker.json)
# The repository root also holds quality tooling (eslint, playwright, Python linters) that the
# server does not need; this image installs only the backend's production dependencies.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

WORKDIR /app

# Dependencies first (cached between deploys). ffmpeg-static/ffprobe-static fetch their binaries
# in their install scripts, so scripts stay enabled here.
COPY backend/package.json backend/package-lock.json backend/
RUN npm ci --prefix backend --omit=dev \
    && npm cache clean --force

# Only what the running server reads: the API code, the static front end and the canonical demo
# lessons (lesson.json + media), which the API seeds and serves itself.
COPY backend/src backend/src
COPY frontend frontend
COPY database/demo-lessons database/demo-lessons

USER node
EXPOSE 3000
CMD ["node", "backend/src/server.js"]
