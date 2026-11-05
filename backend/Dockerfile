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

USER node

ENV NODE_ENV=production \
    PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:5000/api/health || exit 1

CMD ["npm", "start"]
