"""
Instapoll Cloud Poll Notifier
Connects to the Instapoll Pusher WebSocket and fires an ntfy.sh
notification the moment a poll_released event arrives.

Required env vars:
  COURSE_ID   — numeric Instapoll course ID (e.g. 6104)
  NTFY_TOPIC  — ntfy.sh topic name (use a random UUID for privacy)
"""

import os
import sys
import time
import threading
import requests
import pysher

PUSHER_APP_KEY = "instapollprod"
PUSHER_HOST    = "pusher-ws.la.utexas.edu"
NTFY_BASE_URL  = "https://ntfy.sh"

# ── env var validation ────────────────────────────────────────────────────────

COURSE_ID  = os.environ.get("COURSE_ID", "").strip()
NTFY_TOPIC = os.environ.get("NTFY_TOPIC", "").strip()

if not COURSE_ID:
    sys.exit("ERROR: COURSE_ID env var is required (e.g. COURSE_ID=6104)")
if not NTFY_TOPIC:
    sys.exit("ERROR: NTFY_TOPIC env var is required (e.g. NTFY_TOPIC=my-random-uuid-topic)")

CHANNEL_NAME = f"polls_course_{COURSE_ID}"

# ── ntfy helpers ──────────────────────────────────────────────────────────────

def send_ntfy(title: str, body: str, priority: str = "default", tags: list[str] | None = None) -> None:
    url = f"{NTFY_BASE_URL}/{NTFY_TOPIC}"
    headers = {
        "Title":    title,
        "Priority": priority,
        "Tags":     ",".join(tags or []),
    }
    try:
        resp = requests.post(url, data=body.encode("utf-8"), headers=headers, timeout=10)
        resp.raise_for_status()
        print(f"[ntfy] Sent: {title!r}")
    except requests.RequestException as exc:
        print(f"[ntfy] ERROR sending notification: {exc}")

# ── Pusher event handlers ─────────────────────────────────────────────────────

def on_poll_released(data: str) -> None:
    print(f"[event] poll_released received: {data}")
    send_ntfy(
        title="Instapoll Alert",
        body="A poll is open — you have 3 minutes!",
        priority="high",
        tags=["bell"],
    )

def on_poll_finished(data: str) -> None:
    print(f"[event] poll_finished received: {data}")
    send_ntfy(
        title="Instapoll Closed",
        body="The poll has closed.",
        priority="low",
        tags=["white_check_mark"],
    )

def on_poll_recalled(data: str) -> None:
    print(f"[event] poll_recalled received: {data}")
    send_ntfy(
        title="Instapoll Recalled",
        body="The poll was recalled before closing.",
        priority="low",
        tags=["x"],
    )

def on_any_event(event_name: str, data: str) -> None:
    """Log every channel event so you can verify exact event names on first deploy."""
    print(f"[channel] {event_name}: {data}")

# ── connection / subscription ─────────────────────────────────────────────────

def on_connect(data: str) -> None:
    print(f"[pusher] Connected — subscribing to {CHANNEL_NAME}")
    channel = pusher.subscribe(CHANNEL_NAME)

    # Log all events for initial verification (harmless to leave in).
    channel.bind("pusher:subscription_succeeded", lambda d: print(f"[pusher] Subscribed to {CHANNEL_NAME}"))
    channel.bind_all(on_any_event)

    channel.bind("poll_released", on_poll_released)
    channel.bind("poll_finished", on_poll_finished)
    channel.bind("poll_recalled", on_poll_recalled)

# ── heartbeat thread ──────────────────────────────────────────────────────────

HEARTBEAT_INTERVAL = 10 * 60  # 10 minutes

def heartbeat_loop() -> None:
    while True:
        time.sleep(HEARTBEAT_INTERVAL)
        print(f"[heartbeat] Worker alive — monitoring {CHANNEL_NAME}")

# ── main ──────────────────────────────────────────────────────────────────────

print(f"[startup] Instapoll Cloud Notifier starting")
print(f"[startup] Course channel : {CHANNEL_NAME}")
print(f"[startup] ntfy topic     : {NTFY_TOPIC}")

pusher = pysher.Pusher(
    key=PUSHER_APP_KEY,
    custom_host=PUSHER_HOST,
    secure=True,
    reconnect_interval=5,
)
pusher.connection.bind("pusher:connection_established", on_connect)
pusher.connect()

threading.Thread(target=heartbeat_loop, daemon=True).start()

while True:
    time.sleep(1)
