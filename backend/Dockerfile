# =============================================================================
# Snapsec TaskTracker — Backend API Dockerfile (backend/Dockerfile)
# Runs modular Express + Drizzle ORM (PostgreSQL / SQLite WAL) API on port 5000
# =============================================================================
FROM node:22-alpine

WORKDIR /app

# Install curl for container healthchecks and build tools for native SQLite bindings
RUN apk add --no-cache curl python3 make g++

# Install backend dependencies
COPY package.json package-lock.json* ./
RUN npm install --force

# Copy modular backend source files
COPY tsconfig.json firebase-applet-config.json* ./
COPY src/ ./src/

# Prepare persistent data directory owned by non-root node user
RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV NODE_ENV=production \
    PORT=5000

EXPOSE 5000

VOLUME ["/app/data"]

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:5000/api/health || exit 1

CMD ["npm", "start"]
