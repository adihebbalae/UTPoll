# Privacy Policy — UT Instapoll Alert

**Last updated: March 11, 2026**

## Summary

UT Instapoll Alert is a Chrome extension that monitors the UT Instapoll portal for live polls and alerts you in real time. **This extension does not collect, store, transmit, or share any personal data.**

---

## Data Collection

This extension collects **no personal data whatsoever**.

| Category | What happens |
|---|---|
| Browsing history | Not accessed or stored |
| Personal identifiers | Not accessed or stored |
| Authentication credentials | Not accessed or stored |
| Network requests | Read-only interception of responses from `polls.la.utexas.edu` only; data is processed locally in memory and never leaves your device |
| Settings (course ID, ntfy topic) | Stored locally in `chrome.storage.sync` (synced across your own Chrome profile only); never transmitted to any server controlled by this extension |

---

## Data Transmission

The extension makes **two types of outbound network requests**, both initiated explicitly by you:

1. **ntfy.sh push notifications** — If you enable push notifications and configure a topic name, the extension sends a short plain-text alert message (`"Poll is live!"`) to `https://ntfy.sh/{your_topic}`. This is a third-party service; see [ntfy.sh's privacy policy](https://ntfy.sh/docs/privacy/) for how they handle messages.

2. **Auto-submit (experimental)** — If enabled, the extension submits attendance polls using your existing browser session cookies. This request goes to the same `polls.la.utexas.edu` server your browser already communicates with. No data is sent to any external server.

---

## Permissions Justification

| Permission | Reason |
|---|---|
| `notifications` | Display desktop alerts when a live poll is detected |
| `storage` | Save your settings (toggles, course ID, ntfy topic) |
| `offscreen` | Play the audio chime (MV3 requires an offscreen document for audio) |
| `*://polls.la.utexas.edu/*` | Monitor the Instapoll page for live polls |
| `https://ntfy.sh/*` | Send optional push notifications when enabled by you |

---

## Third-Party Services

- **ntfy.sh**: Used only if you opt in. Messages sent contain only the text `"Poll is live! Open Instapoll now."` or a welcome message. No user identity, course details, or session data is included.

---

## Changes

If this policy changes, the updated version will be published in this repository. Continued use of the extension constitutes acceptance of the updated policy.

---

## Contact

This extension is open source. For questions or concerns, open an issue at the GitHub repository linked in the Chrome Web Store listing.
