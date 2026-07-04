FROM golang:1.23-alpine AS build
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY NO_PROXY=$NO_PROXY
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
CMD ["./goserver"]
