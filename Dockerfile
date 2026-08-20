# HAULMATES matchmaking server.
#
# The server is the only part of this game that has to exist somewhere other
# than the player's machine, and until this file existed it existed nowhere:
# a customer who installed the game and pressed "Play online" was pointed at a
# matchmaking server on their own localhost that nobody had started.
#
# Multi-stage so the shipped image carries the built JavaScript and the
# production dependency tree, and none of the TypeScript, tests or client.
#
#   docker build -t haulmates-server .
#   docker run -p 8787:8787 haulmates-server
#
# Bake the web client in as well (so one container serves both the game and
# the matchmaking) with:
#
#   docker build --build-arg WITH_CLIENT=1 -t haulmates-server .

# ---------------------------------------------------------------- build stage
FROM node:22-alpine AS build
WORKDIR /app

# Install against the lockfile first, so a source-only change does not
# re-resolve the dependency tree.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
COPY packages/desktop/package.json packages/desktop/
RUN npm ci --ignore-scripts

COPY packages/core packages/core
COPY packages/server packages/server
COPY packages/client packages/client

RUN npm run build -w @haulmates/core && npm run build -w @haulmates/server

# The client is optional: most deployments serve the game from a CDN or ship it
# inside the desktop build, and only need the matchmaking socket here.
ARG WITH_CLIENT=0
RUN if [ "$WITH_CLIENT" = "1" ]; then npm run build -w @haulmates/client; else mkdir -p packages/client/dist; fi

# Re-resolve without dev dependencies for the runtime layer.
RUN npm prune --omit=dev

# -------------------------------------------------------------- runtime stage
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/server/package.json packages/server/package.json
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist

# node:alpine ships a `node` user; run as it rather than root.
USER node

EXPOSE 8787

# The server already answers /health with 200 and a JSON body, which is what
# every managed host wants to see before it routes traffic at a container.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Node in a container should receive signals directly: the server installs
# SIGTERM/SIGINT handlers that close rooms cleanly, and a shell wrapper would
# swallow them and leave players disconnected rather than returned to a lobby.
ENTRYPOINT ["node", "packages/server/dist/cli.js"]
