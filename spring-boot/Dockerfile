# syntax=docker/dockerfile:1
FROM maven:3.9.11-eclipse-temurin-17@sha256:e4a7ace3dc0d645ed97f8d9ad0b0d3f0b14fa8d150138f27f116d7105a639b82 AS build
WORKDIR /workspace
COPY pom.xml mvnw ./
COPY .mvn .mvn
COPY src src
RUN --mount=type=cache,target=/root/.m2 sh ./mvnw -B package

FROM eclipse-temurin:17.0.17_10-jre-jammy
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* && useradd --uid 10001 --create-home portfolio
WORKDIR /app
COPY --from=build --chown=portfolio:portfolio /workspace/target/portfolio-api-0.1.0.jar /app/app.jar
USER portfolio
ENV SERVER_PORT=8080 JAVA_TOOL_OPTIONS="-Xms64m -Xmx256m -XX:ActiveProcessorCount=2"
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=12 \
    CMD curl --fail --silent http://127.0.0.1:8080/actuator/health/readiness > /dev/null || exit 1
ENTRYPOINT ["java","-jar","/app/app.jar"]
