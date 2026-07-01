FROM rust:1.83-alpine AS build
WORKDIR /src
COPY Cargo.toml ./
RUN mkdir src && echo 'fn main() {}' > src/main.rs && cargo build --release && rm -rf src
COPY . .
RUN cargo build --release

FROM alpine:3.20
RUN apk add --no-cache wget libgcc
WORKDIR /app
COPY --from=build /src/target/release/rustserver .
COPY config ./config
ENV HOST=0.0.0.0 PORT=8005
EXPOSE 8005
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8005/health || exit 1
CMD ["./rustserver"]
