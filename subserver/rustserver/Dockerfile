FROM rust:1.83-alpine AS build
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY NO_PROXY=$NO_PROXY
WORKDIR /src
RUN apk add --no-cache musl-dev build-base
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
CMD ["./rustserver"]
