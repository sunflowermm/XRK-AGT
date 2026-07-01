FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /goserver .

FROM alpine:3.20
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=build /goserver .
COPY apis ./apis
COPY config ./config
ENV HOST=0.0.0.0 PORT=8001
EXPOSE 8001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8001/health || exit 1
CMD ["./goserver"]
