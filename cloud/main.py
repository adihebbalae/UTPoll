"""
Instapoll Cloud Poll Notifier v2
Connects directly to the Instapoll Pusher WebSocket via websocket-client
and fires ntfy.sh notifications when poll events arrive.

Replaces pysher with raw Pusher protocol handling for reliable connections
(pysher 1.0.8 dropped connections every ~60s on custom Pusher hosts).

Required env vars:
  COURSE_ID     -- numeric Instapoll course ID (e.g. 6104)
  NTFY_TOPIC    -- ntfy.sh topic for poll alerts

Optional env vars:
  NTFY_HB_TOPIC -- ntfy.sh topic for heartbeat pings (default: none)
"""

import json
import os
import re
import ssl
import sys
import time
import threading
from urllib.parse import quote

import requests
import websocket

# -- config -------------------------------------------------------------------

PUSHER_APP_KEY = "instapollprod"
PUSHER_HOST    = "pusher-ws.la.utexas.edu"
NTFY_BASE_URL  = "https://ntfy.sh"

COURSE_ID     = os.environ.get("COURSE_ID", "").strip()
NTFY_TOPIC    = os.environ.get("NTFY_TOPIC", "").strip()
NTFY_HB_TOPIC = os.environ.get("NTFY_HB_TOPIC", "").strip()

if not COURSE_ID:
    sys.exit("ERROR: COURSE_ID env var is required (e.g. COURSE_ID=6104)")
if not NTFY_TOPIC:
    sys.exit("ERROR: NTFY_TOPIC env var is required (e.g. NTFY_TOPIC=my-random-uuid-topic)")

CHANNEL_NAME = f"polls_course_{COURSE_ID}"

WS_URL = (
    f"wss://{PUSHER_HOST}/app/{PUSHER_APP_KEY}"
    f"?protocol=7&client=python-instapoll&version=2.0"
)

HEARTBEAT_INTERVAL   = 30 * 60  # 30 minutes -- ntfy heartbeat
PUSHER_PING_INTERVAL = 25       # seconds -- keep WebSocket alive

# -- ntfy helpers -------------------------------------------------------------

def send_ntfy(
    topic: str, title: str, body: str,
    priority: str = "default", tags = None,
) -> None:
    url = f"{NTFY_BASE_URL}/{quote(topic, safe='')}"
    # HTTP headers must be ASCII -- strip any non-ASCII characters from the title.
    safe_title = title.encode("ascii", errors="ignore").decode("ascii").strip()
    headers = {
        "Title":    safe_title,
        "Priority": priority,
        "Tags":     ",".join(tags or []),
    }
    try:
        resp = requests.post(url, data=body.encode("utf-8"), headers=headers, timeout=10)
        resp.raise_for_status()
        print(f"[ntfy] Sent: {title!r} -> {topic}")
    except requests.RequestException as exc:
        print(f"[ntfy] ERROR sending notification: {exc}")

# -- ntfy heartbeat thread ----------------------------------------------------

def heartbeat_loop() -> None:
    while True:
        time.sleep(HEARTBEAT_INTERVAL)
        print(f"[heartbeat] Worker alive -- monitoring {CHANNEL_NAME}")
        if NTFY_HB_TOPIC:
            send_ntfy(
                NTFY_HB_TOPIC,
                "Instapoll Heartbeat",
                f"Worker alive -- monitoring {CHANNEL_NAME}",
                priority="min",
                tags=["heartbeat"],
            )

# -- Pusher event processing --------------------------------------------------

def handle_pusher_message(ws, raw: str) -> None:
    try:
        frame = json.loads(raw)
    except json.JSONDecodeError:
        return

    event = frame.get("event", "")

    # -- protocol events ------------------------------------------------------
    if event == "pusher:connection_established":
        data = json.loads(frame.get("data", "{}"))
        sid = data.get("socket_id", "?")
        timeout = data.get("activity_timeout", 120)
        print(f"[pusher] Connected (socket_id={sid}, activity_timeout={timeout}s)")
        ws.send(json.dumps({
            "event": "pusher:subscribe",
            "data":  {"channel": CHANNEL_NAME},
        }))
        print(f"[pusher] -> subscribe {CHANNEL_NAME}")
        return

    if event in ("pusher_internal:subscription_succeeded", "pusher:subscription_succeeded"):
        print(f"[pusher] Subscribed to {frame.get('channel', CHANNEL_NAME)}")
        return

    if event == "pusher:ping":
        ws.send(json.dumps({"event": "pusher:pong", "data": {}}))
        return

    if event in ("pusher:pong", "pusher:error"):
        return

    # -- application events ---------------------------------------------------
    inner_text = frame.get("data", "")
    if not inner_text:
        return

    try:
        inner = json.loads(inner_text) if isinstance(inner_text, str) else inner_text
    except json.JSONDecodeError:
        inner = None

    # Normalize: strip non-alphanumeric to match poll_released/pollreleased/App\Events\PollReleased
    event_norm = re.sub(r'[^a-z0-9]', '', event.lower())

    if "pollrelease" in event_norm or "pollopened" in event_norm or "pollopen" in event_norm:
        print(f"[event] OPEN  {event}: {str(inner_text)[:300]}")
        send_ntfy(
            NTFY_TOPIC,
            "Instapoll Alert",
            "A poll is open! Open Instapoll now.",
            priority="urgent",
            tags=["rotating_light", "bell"],
        )
        return

    if any(kw in event_norm for kw in ("pollfinish", "pollclos", "pollended", "pollend")):
        print(f"[event] CLOSE {event}: {str(inner_text)[:300]}")
        send_ntfy(
            NTFY_TOPIC,
            "Instapoll Closed",
            "The poll has closed.",
            priority="low",
            tags=["white_check_mark"],
        )
        return

    if "pollrecall" in event_norm:
        print(f"[event] RECALL {event}: {str(inner_text)[:300]}")
        send_ntfy(
            NTFY_TOPIC,
            "Instapoll Recalled",
            "The poll was recalled before closing.",
            priority="low",
            tags=["x"],
        )
        return

    # Broad payload detection -- fallback for unknown event names.
    # Already subscribed to the course-specific channel so no course_id filter needed.
    if inner is not None:
        polls = None
        if isinstance(inner, list) and len(inner) > 0:
            polls = inner
        elif isinstance(inner, dict):
            if isinstance(inner.get("polls"), list) and len(inner["polls"]) > 0:
                polls = inner["polls"]
            elif inner.get("poll"):
                polls = [inner["poll"]]

        if polls:
            print(f"[event] POLL-DATA {event}: {json.dumps(polls)[:300]}")
            send_ntfy(
                NTFY_TOPIC,
                "Instapoll Alert",
                "A poll is open! Open Instapoll now.",
                priority="urgent",
                tags=["rotating_light", "bell"],
            )
        else:
            print(f"[event] UNKNOWN {event}: {str(inner_text)[:200]}")

# -- WebSocket callbacks ------------------------------------------------------

def on_open(ws) -> None:
    print(f"[pusher] WebSocket opened -> {PUSHER_HOST}")
    def ping_loop():
        while True:
            time.sleep(PUSHER_PING_INTERVAL)
            try:
                ws.send(json.dumps({"event": "pusher:ping", "data": {}}))
            except Exception:
                break
    threading.Thread(target=ping_loop, daemon=True).start()

def on_error(ws, error) -> None:
    print(f"[pusher] WebSocket error: {error}")

def on_close(ws, code, msg) -> None:
    print(f"[pusher] Connection closed (code={code}, msg={msg})")

# -- main ---------------------------------------------------------------------

def main() -> None:
    print("[startup] Instapoll Cloud Notifier v2")
    print(f"[startup] Course channel  : {CHANNEL_NAME}")
    masked_alert = NTFY_TOPIC[:4] + "****" if len(NTFY_TOPIC) > 4 else "****"
    print(f"[startup] Alert topic     : {masked_alert}")
    if NTFY_HB_TOPIC:
        masked_hb = NTFY_HB_TOPIC[:4] + "****" if len(NTFY_HB_TOPIC) > 4 else "****"
        print(f"[startup] Heartbeat topic : {masked_hb} (every {HEARTBEAT_INTERVAL // 60}m)")

    threading.Thread(target=heartbeat_loop, daemon=True).start()

    if NTFY_HB_TOPIC:
        send_ntfy(
            NTFY_HB_TOPIC,
            "Instapoll Started",
            f"Worker started -- monitoring {CHANNEL_NAME}",
            priority="low",
            tags=["rocket"],
        )

    backoff = 5
    while True:
        try:
            ws = websocket.WebSocketApp(
                WS_URL,
                on_open=on_open,
                on_message=handle_pusher_message,
                on_error=on_error,
                on_close=on_close,
            )
            ws.run_forever(
                sslopt={"cert_reqs": ssl.CERT_REQUIRED},
                ping_interval=0,
                reconnect=0,
            )
            backoff = 5
        except Exception as exc:
            print(f"[error] WebSocket crashed: {exc}")

        print(f"[pusher] Reconnecting in {backoff}s...")
        time.sleep(backoff)
        backoff = min(backoff * 2, 300)


if __name__ == "__main__":
    main()