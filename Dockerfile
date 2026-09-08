FROM rust:1.93.0-bookworm AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/tools

RUN curl -fL --retry 5 --retry-delay 2 \
        -o nargo.tar.gz \
        https://github.com/noir-lang/noir/releases/download/v1.0.0-beta.26/nargo-x86_64-unknown-linux-gnu.tar.gz \
    && printf '%s  %s\n' \
        64048040befd55a987158b11137d8f38f9688f696db4d84910dd1bcf0442fb80 \
        nargo.tar.gz | sha256sum -c - \
    && tar -xzf nargo.tar.gz \
    && install -m 0755 nargo /usr/local/bin/nargo \
    && nargo --version \
    && test "$(nargo --version | sed -n '1p')" = "nargo version = 1.0.0-beta.26"

RUN curl -fL --retry 5 --retry-delay 2 \
        -o bb.tar.gz \
        https://github.com/AztecProtocol/aztec-packages/releases/download/v5.2.0/barretenberg-amd64-linux.tar.gz \
    && printf '%s  %s\n' \
        17ab8476961728cdc5c69b6c4ff427c9092cef11d1e0b0166929a0417dfa7cfb \
        bb.tar.gz | sha256sum -c - \
    && tar -xzf bb.tar.gz \
    && install -m 0755 bb /usr/local/bin/bb \
    && bb --version \
    && test "$(bb --version)" = "5.2.0"

WORKDIR /src
COPY . .
ARG NOIR_SOURCE_COMMIT=unknown
ARG NOIR_SOURCE_DIRTY=unknown
ENV NOIR_SOURCE_COMMIT=${NOIR_SOURCE_COMMIT} NOIR_SOURCE_DIRTY=${NOIR_SOURCE_DIRTY}

RUN NARGO_PATH=/usr/local/bin/nargo \
    BB_PATH=/usr/local/bin/bb \
    ./scripts/build-zk.sh

RUN cargo build --locked --release -p server

FROM node:24.12.0-bookworm-slim AS test-node

FROM builder AS test-gates
COPY --from=test-node /usr/local/bin/node /usr/local/bin/node
COPY --from=test-node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && npm ci --ignore-scripts --prefix apps/web

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgcc-s1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home-dir /home/app app \
    && mkdir -p /home/app \
    && chown app:app /home/app

WORKDIR /app

COPY --from=builder --chown=app:app /src/target/release/server /app/server
COPY --from=builder /usr/local/bin/bb /usr/local/bin/bb
COPY --from=builder --chown=app:app /src/apps/server/zk/challenge_v2.vk /app/zk/challenge_v2.vk

ENV HOME=/home/app \
    BB_PATH=/usr/local/bin/bb \
    CHALLENGE_VK_PATH=/app/zk/challenge_v2.vk

EXPOSE 10000

USER app

CMD ["/app/server"]
