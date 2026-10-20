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
# The official Node image ships a non-root `node` user; don't rely on
# useradd being present in the slim base image.
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["npm", "run", "serve"]
