FROM eclipse-temurin:21-jdk-alpine AS build
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY NO_PROXY=$NO_PROXY
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN apk add --no-cache maven && mvn -q -DskipTests package

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=build /src/target/*.jar app.jar
ENV SERVER_PORT=8003
EXPOSE 8003
CMD ["java", "-jar", "app.jar"]
