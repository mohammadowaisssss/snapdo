# =============================================================================
# Snapsec TaskTracker — Frontend Dockerfile (frontend/Dockerfile)
# Pure Node.js SPA build & Express static/reverse-proxy server on port 4000
# =============================================================================
FROM node:22-alpine

WORKDIR /app

# Install curl for container healthchecks
RUN apk add --no-cache curl

# Install frontend dependencies
COPY package.json package-lock.json* ./
RUN npm install --force

# Copy frontend source files and build static SPA bundle
COPY index.html vite.config.ts tsconfig.json metadata.json server.js ./
COPY firebase-applet-config.json* ./
COPY public/ ./public/
COPY src/ ./src/

RUN npm run build

# Run as non-root user
RUN chown -R node:node /app
USER node

ENV NODE_ENV=production \
    PORT=4000 \
    BACKEND_URL=http://backend:5000

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:4000/ || exit 1

CMD ["node", "server.js"]
