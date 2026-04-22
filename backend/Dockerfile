# References:
#   https://bun.sh/guides/ecosystem/docker
#   https://hub.docker.com/r/oven/bun

ARG BUN_VERSION=1

FROM oven/bun:${BUN_VERSION} AS base
WORKDIR /usr/src/app

FROM base AS deps
RUN mkdir -p /temp/dev
COPY package.json bun.lock* /temp/dev/
RUN cd /temp/dev && bun install --frozen-lockfile

RUN mkdir -p /temp/prod
COPY package.json bun.lock* /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production

FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /temp/dev/node_modules node_modules
COPY --chown=bun:bun .
USER bun
EXPOSE 3000
CMD ["bun", "run", "dev"]

FROM base AS build
ENV NODE_ENV=production
COPY --from=deps /temp/dev/node_modules node_modules
COPY . .
RUN bun build ./src/server.ts --target bun --outdir ./dist

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /temp/prod/node_modules node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY package.json ./
USER bun
EXPOSE 3000
CMD ["bun", "run", "dist/server.js"]
