# The database: Postgres 16 (Alpine, the same image as before) plus pgvector for search by meaning.
# pgvector is compiled into this exact image instead of switching to the Debian-based pgvector image, so text
# sorting (musl locale) and every existing index stay exactly as they are. See docs/repos.md.
FROM postgres:16-alpine
ARG PGVECTOR_VERSION=v0.8.7
RUN apk add --no-cache --virtual .build-deps git build-base \
 && git clone --branch "$PGVECTOR_VERSION" --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector \
 && cd /tmp/pgvector \
 && make with_llvm=no OPTFLAGS="" \
 && make with_llvm=no install \
 && cd / && rm -rf /tmp/pgvector \
 && apk del .build-deps
