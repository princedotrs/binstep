# The always-on demo bot: web/scripts/volume-bot.ts plus the automation workflow it runs.
# The keys are set on the host at run time, so none of them are in this image.
FROM oven/bun:1.4.2-debian

ARG CRE_VERSION=v1.39.0
ARG CRE_SHA256=e840ee945d3741fbc76a3cae73749bc9a1730cc58c6babc5e65c2567413c7af0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL "https://github.com/smartcontractkit/cre-cli/releases/download/${CRE_VERSION}/cre_linux_amd64.tar.gz" -o /tmp/cre.tar.gz \
  && echo "${CRE_SHA256}  /tmp/cre.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/cre.tar.gz -C /tmp \
  && mv "/tmp/cre_${CRE_VERSION}_linux_amd64" /usr/local/bin/cre \
  && chmod +x /usr/local/bin/cre \
  && rm /tmp/cre.tar.gz

WORKDIR /app
COPY cre ./cre
COPY web/scripts ./web/scripts
COPY web/src/lib ./web/src/lib
COPY scripts/bot-entry.sh ./bot-entry.sh

RUN cd cre/automation && bun install --frozen-lockfile && bunx cre-setup
# The bot needs only viem from the web app's dependencies.
RUN cd web && echo '{"private":true}' >package.json && bun add viem@2.57.16

CMD ["sh", "./bot-entry.sh"]
