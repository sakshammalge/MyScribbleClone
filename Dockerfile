# Build the client, then run the server on a slim runtime image.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY shared shared
COPY client client
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev
COPY shared shared
COPY server server
COPY --from=build /app/client/dist client/dist
# Hosts inject PORT; 3001 is the local default.
ENV PORT=3001
EXPOSE 3001
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Run node directly (not via npm) so SIGTERM reaches the server.
CMD ["node", "--import", "tsx", "server/src/main.ts"]
