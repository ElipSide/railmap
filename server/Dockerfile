FROM node:20-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-notebooklm.txt /tmp/requirements-notebooklm.txt

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:${PATH}"
ENV PYTHON_BIN=python3

RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    if [ -f /tmp/requirements-notebooklm.txt ]; then \
      pip install --no-cache-dir -r /tmp/requirements-notebooklm.txt; \
    fi

CMD ["bash", "-lc", "npm install && node route-server.js"]