# use the official Bun image see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1 AS base
WORKDIR /usr/src/app

# install dependencies into temp directory
# this will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev

COPY apps ./apps
COPY packages ./packages
COPY package.json bun.lock /temp/dev/

RUN --mount=type=secret,id=github_token,env=GITHUB_TOKEN cd /temp/dev && bun install --frozen-lockfile

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod

COPY apps ./apps
COPY packages ./packages
COPY package.json bun.lock /temp/dev/

RUN --mount=type=secret,id=github_token,env=GITHUB_TOKEN cd /temp/prod && bun install --frozen-lockfile --production

# copy node_modules from temp directory
# then copy all (non-ignored) project files into the image
FROM base AS prerelease
COPY --from=install /temp/dev/apps/server/node_modules node_modules
COPY ./apps/server .

# [optional] tests & build
ENV NODE_ENV=production
RUN bun build src/index.ts --out server --compile --minify --sourcemap --target bun

# copy production dependencies and source code into final image
FROM base AS release
# COPY --from=install /temp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/server .
# COPY --from=prerelease /usr/src/app/package.json .

# run the app
USER bun
EXPOSE 4000/tcp
ENTRYPOINT [ "./server" ]
