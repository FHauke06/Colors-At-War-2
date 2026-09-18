# --- build stage: bundle the TS server (incl. the shared src/engine code it imports) ---
FROM node:22-alpine AS build
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN npm --prefix server ci

COPY src/engine ./src/engine
COPY src/net/protocol.ts ./src/net/protocol.ts
COPY src/data ./src/data
COPY server ./server

RUN npm --prefix server run build

# --- runtime stage: just the bundle + its one external dependency ---
FROM node:22-alpine
WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/server/dist/index.js ./dist/index.js

EXPOSE 8787
CMD ["node", "dist/index.js"]
