FROM python:3.11.14-slim-bookworm
ARG MSODBCSQL_VERSION=18.7.1.1-1
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unixodbc libgssapi-krb5-2 \
    && curl --fail --retry 3 -sSL https://packages.microsoft.com/config/debian/12/packages-microsoft-prod.deb -o /tmp/microsoft.deb \
    && dpkg -i /tmp/microsoft.deb \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends msodbcsql18=${MSODBCSQL_VERSION} \
    && rm -rf /var/lib/apt/lists/* /tmp/microsoft.deb
WORKDIR /app
COPY requirements.lock ./requirements.lock
COPY wheels /wheels
ARG INSTALL_OFFLINE=0
RUN if [ "$INSTALL_OFFLINE" = "1" ]; then \
        pip install --disable-pip-version-check --no-index --find-links=/wheels -r requirements.lock; \
    else \
        pip install --disable-pip-version-check --timeout 120 --retries 5 -r requirements.lock; \
    fi \
    && rm -rf /wheels \
    && useradd --uid 10001 --create-home risk
COPY --chown=risk:risk risk ./risk
USER risk
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=6 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"
CMD ["python", "-m", "risk.app"]
