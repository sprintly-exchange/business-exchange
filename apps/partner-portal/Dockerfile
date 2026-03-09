FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/partner-portal/package.json ./apps/partner-portal/
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:11000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd apps/partner-portal && ../../node_modules/.bin/next build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/apps/partner-portal/.next ./apps/partner-portal/.next
COPY --from=builder /app/apps/partner-portal/package.json ./apps/partner-portal/package.json
COPY --from=builder /app/apps/partner-portal/next.config.js ./apps/partner-portal/next.config.js
WORKDIR /app/apps/partner-portal
EXPOSE 3100
CMD ["/app/node_modules/.bin/next", "start", "-p", "3100"]
