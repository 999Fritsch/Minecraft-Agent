# ── Base image ─────────────────────────────────────────────────────────────────
# python:3.11-alpine gives us a minimal Alpine Linux with Python 3.11 pre-installed.
FROM python:3.11-alpine

# ── System dependencies ────────────────────────────────────────────────────────
# Install Node.js 20 LTS + npm from the Alpine package index.
# --no-cache avoids storing the index in the image layer.
RUN apk add --no-cache nodejs npm

# ── Working directory ──────────────────────────────────────────────────────────
WORKDIR /app

# ── Python dependencies (cached layer) ────────────────────────────────────────
# Copy only the requirements file first so this layer is rebuilt only when
# requirements change, not on every source code edit.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Node.js dependencies (cached layer) ───────────────────────────────────────
# Copy package manifests before source so npm install is cached separately.
COPY package.json .
RUN npm install --omit=dev

# Tell Node.js (and JSPyBridge) where to find the installed packages so they
# are not re-downloaded at runtime when javascript.require() is called.
ENV NODE_PATH=/app/node_modules

# ── Application source ────────────────────────────────────────────────────────
# Copy the rest of the project. In development the whole directory is mounted
# as a volume, so changes are reflected without rebuilding.
COPY . .

# ── Entrypoint ────────────────────────────────────────────────────────────────
CMD ["python", "src/main.py"]
