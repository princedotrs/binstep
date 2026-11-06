# The always-on demo bot: web/scripts/volume-bot.ts and the keeper it runs.
# DEPLOYER_KEY is set on the host at run time, so no key is in this image.
FROM oven/bun:1.4.2-debian

WORKDIR /app/web
COPY web/scripts ./scripts
COPY web/src/lib ./src/lib

# The bot needs only viem from the web app's dependencies.
RUN echo '{"private":true}' >package.json && bun add viem@2.57.16

CMD ["bun", "run", "scripts/volume-bot.ts"]
