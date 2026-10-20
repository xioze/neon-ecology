# NEON//ECOLOGY - production image for Render / Railway / Zeabur / Fly.io.
# The client is a Vite static build. The server is a long-running Express
# process that also serves dist/ and proxies DeepSeek requests.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# tsx is a production dependency because the Express server is written in TS.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
RUN useradd --system --create-home --uid 10001 neon \
    && chown -R neon:neon /app
USER neon
EXPOSE 3000
CMD ["npm", "run", "serve"]
