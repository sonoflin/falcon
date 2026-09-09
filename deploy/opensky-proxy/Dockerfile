# syntax=docker/dockerfile:1
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY scripts/opensky-local-proxy.mjs ./scripts/opensky-local-proxy.mjs
EXPOSE 8787
USER node
CMD ["node", "scripts/opensky-local-proxy.mjs"]
