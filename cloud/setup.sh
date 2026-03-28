#!/usr/bin/env bash
# setup.sh — One-time setup for Instapoll Cloud Notifier on Oracle Cloud Free Tier
# Run as the default user (ubuntu on Ubuntu, opc on Oracle Linux):
#   bash setup.sh
#
# What this script does:
#   1. Installs Python 3 and pip (if not already present)
#   2. Copies the cloud/ files to /opt/instapoll/
#   3. Creates a Python virtual environment and installs dependencies
#   4. Prompts you to create the .env file with your COURSE_ID and NTFY_TOPIC
#   5. Installs and enables the systemd service (auto-start on boot, auto-restart on crash)
#
# After running, check status with:
#   sudo systemctl status instapoll
# Live logs with:
#   sudo journalctl -u instapoll -f

set -euo pipefail

INSTALL_DIR="/opt/instapoll"
SERVICE_NAME="instapoll"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Instapoll Cloud Notifier Setup ==="

# ── 1. Install Python 3 ───────────────────────────────────────────────────────
echo "[1/5] Checking Python 3..."
if ! command -v python3 &>/dev/null; then
    echo "      Installing Python 3..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -q && sudo apt-get install -y python3 python3-pip python3-venv
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y python3 python3-pip
    else
        echo "ERROR: Cannot detect package manager. Install Python 3 manually then re-run."
        exit 1
    fi
fi
python3 --version

# ── 2. Copy files to install dir ─────────────────────────────────────────────
echo "[2/5] Copying files to ${INSTALL_DIR}..."
sudo mkdir -p "$INSTALL_DIR"
sudo cp "$SCRIPT_DIR/main.py"          "$INSTALL_DIR/main.py"
sudo cp "$SCRIPT_DIR/requirements.txt" "$INSTALL_DIR/requirements.txt"
# Set ownership to current user so venv creation doesn't need sudo
sudo chown -R "$USER:$USER" "$INSTALL_DIR"

# ── 3. Create virtual environment and install deps ────────────────────────────
echo "[3/5] Installing Python dependencies..."
python3 -m venv "$INSTALL_DIR/venv"
"$INSTALL_DIR/venv/bin/pip" install --quiet --upgrade pip
"$INSTALL_DIR/venv/bin/pip" install --quiet -r "$INSTALL_DIR/requirements.txt"
echo "      Dependencies installed."

# ── 4. Create .env file ───────────────────────────────────────────────────────
echo "[4/5] Configuring environment variables..."
ENV_FILE="$INSTALL_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
    echo "      .env already exists at ${ENV_FILE} — skipping (edit manually to change values)."
else
    echo ""
    echo "  Enter your Instapoll course ID."
    echo "  (Find it in the URL when you open a course: polls.la.utexas.edu/student/course/XXXX/...)"
    read -r -p "  COURSE_ID: " COURSE_ID

    echo ""
    echo "  Enter your ntfy.sh topic name."
    echo "  Use a long random string — anyone who knows it can read your notifications."
    echo "  Generate one with: python3 -c \"import uuid; print(uuid.uuid4())\""
    read -r -p "  NTFY_TOPIC: " NTFY_TOPIC

    # Write .env with restricted permissions (owner-read only)
    cat > "$ENV_FILE" <<EOF
COURSE_ID=${COURSE_ID}
NTFY_TOPIC=${NTFY_TOPIC}
EOF
    chmod 600 "$ENV_FILE"
    echo "      .env written to ${ENV_FILE} (permissions: 600 — owner read only)."
fi

# ── 5. Install and enable systemd service ────────────────────────────────────
echo "[5/5] Installing systemd service..."
# Patch the User= line to match the current user (may be ubuntu or opc)
sed "s/^User=ubuntu$/User=${USER}/" "$SCRIPT_DIR/instapoll.service" \
    | sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Useful commands:"
echo "  sudo systemctl status ${SERVICE_NAME}        # check if running"
echo "  sudo journalctl -u ${SERVICE_NAME} -f        # live log stream"
echo "  sudo systemctl restart ${SERVICE_NAME}       # restart after changes"
echo "  sudo systemctl stop ${SERVICE_NAME}          # stop the worker"
echo ""
echo "To update COURSE_ID each semester:"
echo "  sudo nano ${ENV_FILE}"
echo "  sudo systemctl restart ${SERVICE_NAME}"
