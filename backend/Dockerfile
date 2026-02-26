# --- build stage ---
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:20-slim
WORKDIR /app

# Install yt-dlp standalone binary (no Python required)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
         -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Copy schema and generate the Prisma client for this exact runtime environment
COPY prisma ./prisma
RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 8080
# Railway injects PORT at runtime. Health check uses it so the container is only "ready" when the app responds.
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["sh", "-c", "curl -f http://127.0.0.1:${PORT}/health || exit 1"]
# Start server immediately so Railway health checks pass; run migrations in background.
CMD ["sh", "-c", "npx prisma migrate deploy & exec node dist/index.js"]
