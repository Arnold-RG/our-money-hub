# Our Money Hub web. Created by Arnold Rurangwa / Arnova Group.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
# Render injects service env as build-args; declare ARG or the rewrite bakes in localhost.
ARG OMH_API_INTERNAL_URL=http://127.0.0.1:8420
ARG NEXT_PUBLIC_RAGI_URL=https://arnova-ragi.onrender.com
ENV OMH_API_INTERNAL_URL=$OMH_API_INTERNAL_URL NEXT_PUBLIC_RAGI_URL=$NEXT_PUBLIC_RAGI_URL NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ARG OMH_API_INTERNAL_URL=http://127.0.0.1:8420
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 OMH_API_INTERNAL_URL=$OMH_API_INTERNAL_URL
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
USER node
EXPOSE 3420
# Honor Render's PORT.
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT:-3420}"]
