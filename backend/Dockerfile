# =============================================================================
# Snapsec TaskTracker — Backend API Dockerfile (backend/Dockerfile)
# Runs modular Express + Drizzle ORM (PostgreSQL) API on port 5000
# =============================================================================
FROM node:22-alpine

WORKDIR /app

# Install curl for container healthchecks
RUN apk add --no-cache curl

# Install backend dependencies
COPY package.json package-lock.json* ./
RUN npm install --force

# Copy modular backend source files
COPY tsconfig.json ./
COPY src/ ./src/

# Create writable data directory for persistent volume storage and assign permissions to node user
RUN mkdir -p /app/data && chown -R node:node /app

VOLUME ["/app/data"]

USER node

ENV NODE_ENV=production \
    PORT=5000 \
    DATA_DIR=/app/data

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:5000/api/health || exit 1

CMD ["npm", "start"]
