# =============================================================================
# Snapsec TaskTracker — Frontend Dockerfile (frontend/Dockerfile)
# Multi-stage build: compiles Vite SPA and serves via Nginx on port 4000
# Designed to sit behind a host reverse proxy
# =============================================================================

# Stage 1: Build the SPA
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --force

COPY index.html vite.config.ts tsconfig.json metadata.json ./
COPY public/ ./public/
COPY src/ ./src/

RUN npm run build

# Stage 2: Production Nginx Server
FROM nginx:1.27-alpine AS runner

# Remove default configuration and add our custom port 4000 config
RUN rm -rf /etc/nginx/conf.d/* /usr/share/nginx/html/*
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Install curl for container health check
RUN apk add --no-cache curl

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://localhost:4000/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
