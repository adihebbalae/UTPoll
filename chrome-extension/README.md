# UT Instapoll Alert

![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)
![Platform: Chrome](https://img.shields.io/badge/Platform-Chrome-green.svg)
![Non-Commercial](https://img.shields.io/badge/Non--Commercial-Student%20Project-orange.svg)

> **Free & open-source — made by a UT student, for UT students. No ads, no monetization, no affiliation with UT Austin.**

Ever been deep in your notes during lecture and completely missed the Instapoll popup on your other monitor? This extension fires an audio chime, a desktop notification, and an optional phone push the instant a live poll appears — so you don't lose participation points while you're actively paying attention in class.

It piggybacks on requests the page already makes, so no extra network traffic is generated and no login credentials are needed.

---

## Academic Integrity & Compliance

> **This tool is intended to be used while physically attending class to ensure you do not miss a poll while taking notes. Using it to remotely answer polls for classes you are not attending is a violation of the [UT Honor Code](https://liberalarts.utexas.edu/dean/academic-integrity/index.php) and is not what this tool is for.**

### ⚠️ Read this before enabling Auto-Submit

This extension includes an **optional** auto-submit feature for attendance polls. **You are solely responsible for how you use it.**

- UT Austin's [Institutional Rules on Student Services and Activities (Chapter 11)](https://catalog.utexas.edu/general-information/appendices/appendix-c/student-discipline-and-conduct/) and the [UT Honor Code](https://liberalarts.utexas.edu/dean/academic-integrity/index.php) require honest completion of all academic activities, including attendance.
- **If your instructor expects physical presence, using auto-submit without attending constitutes academic dishonesty.** Do not enable it in that case.
- The auto-submit feature only exists because some courses use Instapoll purely as an opt-in participation nudge where the instructor explicitly does not require in-person attendance. Use your judgment.

### UT Acceptable Use Policy

This extension complies with the [UT Acceptable Use Policy for Information Resources](https://security.utexas.edu/policies/acceptable-use):

- It operates **entirely within your own authenticated browser session** — it reads only API responses your browser already receives, using no credentials beyond your existing login.
- It makes **no unauthorized requests** to UT systems and does not access any data you are not already authorized to view.
- It does **not scrape, store, or transmit** any student or course data to third-party servers (except the optional, user-configured ntfy.sh push, which contains no personal data — see [Privacy Policy](PRIVACY_POLICY.md)).
- It does **not automate login** or bypass any authentication mechanism.

### Non-Commercial & Open Source

This project is a **free, non-commercial tool** distributed under the [MIT License](LICENSE):

- The author receives **no payment, donations, or other compensation** from this extension.
- There are **no ads, tracking, analytics, or affiliate links** of any kind.
- The source code is fully open on GitHub for anyone to inspect, fork, or improve.
- This is student-to-student community software, shared in the spirit of the UT open-source community.

---

## Installation

1. **Generate the icon assets** (one-time setup):
   ```powershell
   cd UTPoll
   .\generate-icons.ps1
   ```
   This creates `assets/icon-16.png`, `icon-48.png`, and `icon-128.png` using .NET System.Drawing (built into Windows PowerShell 5.1).

2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `UTPoll/` folder.
5. The extension icon (orange "P") appears in the Chrome toolbar. Click it to open settings.

---

## How it works

`inject.js` wraps the page's own `fetch` and `XMLHttpRequest` calls, intercepting responses from `/api/v1/student/course/*/poll`. When the server returns a non-empty poll array it fires:

1. **Audio chime** — A C5→E5→G5 ascending tone generated with the Web Audio API (no audio file required).
2. **Desktop notification** — A persistent Chrome notification that stays visible until dismissed.
3. **Push notification** (optional) — A free push alert to your phone via [ntfy.sh](https://ntfy.sh).

A **debounce** of 2 consecutive detections within 5 seconds is required before alerts fire, preventing false positives from transient glitches. The extension resets to monitoring mode once the poll disappears from the API response.

---

## Finding your Course ID

1. Navigate to [polls.la.utexas.edu](https://polls.la.utexas.edu) and sign in.
2. Open **DevTools** (`F12`) → **Network** tab.
3. Filter by `/poll` in the search box and wait for a request to appear.
4. The URL looks like `/api/v1/student/course/12345/poll` — `12345` is your course ID.
5. Enter it in the popup's **Course ID** field to limit monitoring to that course only. Leave blank to monitor all courses.

---

## Setting up push notifications (ntfy.sh)

ntfy.sh is a free, open-source push notification service — no account or API key required.

1. Install the **ntfy** app on your phone ([iOS](https://apps.apple.com/app/ntfy/id1625396347) / [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)).
2. In the app, tap **+** and subscribe to a **unique private topic name** you choose (e.g. `ut-poll-alert-myfirstname-abc123`). Make it hard to guess — anyone who knows your topic can publish to it.
3. In the extension popup, enable **Push via ntfy.sh** and enter the exact same topic name.
4. Click **Save**. The extension POSTs to `https://ntfy.sh/<your-topic>` whenever a poll fires.

---

## Configuring the API URL pattern

If UT updates their API path, open the popup and edit the **API URL pattern** field. The default is:

```
/api/v1/student/course/*/poll
```

`*` matches any URL segment (i.e., any course ID). The pattern is matched against the full request URL.

---

## Browser audio policy

Chrome blocks audio playback unless triggered by a real user gesture. The **🔔 Arm Audio** button in the popup plays a near-silent tone (0.001 volume) to satisfy this requirement, allowing the chime to play automatically when a poll is detected later. Click it once after opening the popup. The button shows "✅ Audio armed" to confirm.

> Because the extension uses an [offscreen document](https://developer.chrome.com/docs/extensions/reference/offscreen/) for audio, the autoplay restriction may already be bypassed. The Arm Audio button is a safety net.

---

## Permissions explained

| Permission | Why it's needed |
|---|---|
| `notifications` | Show a persistent desktop notification when a poll is detected |
| `storage` | Persist your settings (course ID, alert toggles, ntfy topic) across sessions |
| `offscreen` | Create an invisible background page to play the audio chime (MV3 requirement) |
| `*://polls.la.utexas.edu/*` | Inject the monitoring script into the Instapoll page |

No broad host permissions (`<all_urls>`) are used. The extension only contacts `polls.la.utexas.edu` (via injected content script) and optionally `ntfy.sh` (outgoing POST from the service worker).

---

## Troubleshooting

**Extension doesn't detect polls**
- Make sure you're on `polls.la.utexas.edu`. The content script only activates on that domain.
- Open DevTools → Console and look for errors from `content.js` or `inject.js`.
- In the Network tab, verify the page is making requests matching `/api/v1/student/course/*/poll`. If the URL format has changed, update the **API URL pattern** in the popup and reload the extension.

**No audio plays**
- Click **🔔 Arm Audio** in the popup before navigating away.
- Confirm the **Audio alert** toggle is on and click Save.
- Check `chrome://extensions` → UTPoll → **Errors** for offscreen document errors.

**No desktop notification**
- Make sure Chrome notifications are permitted: `chrome://settings/content/notifications`.
- Confirm the **Desktop notification** toggle is on.

**Push notification not arriving**
- Ensure the ntfy topic name in the popup exactly matches the one subscribed to in the ntfy app (case-sensitive).
- Check the ntfy app's notification settings; make sure it isn't battery-optimised into silence.
- Test manually: open `https://ntfy.sh/<your-topic>` in a browser and send a test message.

**Page polling stops working after installing the extension**
- `inject.js` wraps `fetch` and `XHR` without altering or delaying the original requests. Responses are only read via `.clone()`. If you observe breakage, disable the extension, collect reproduction steps, and [open an issue](https://github.com/).

---

## Verification checklist

1. Load the unpacked extension; navigate to `polls.la.utexas.edu`. No console errors.
2. Network tab: confirm the site's `/poll` requests complete normally.
3. **Simulate a live poll**: in DevTools Console:
   ```js
   window.postMessage({ type: 'UTPOLL_LIVE', data: [{ id: 1 }] }, '*')
   // (send twice within 5 s to satisfy the debounce)
   window.postMessage({ type: 'UTPOLL_LIVE', data: [{ id: 1 }] }, '*')
   ```
   Verify notification, chime, and (if configured) ntfy push.
4. **Simulate poll clearing**:
   ```js
   window.postMessage({ type: 'UTPOLL_IDLE' }, '*')
   ```
   Status dot in popup turns green; extension re-arms for the next poll.
5. Open popup → change settings → close → reopen → settings persist.

---

## License

MIT — see [LICENSE](LICENSE) for full text.

---

## Privacy

This extension collects no personal data. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for details.

---

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by The University of Texas at Austin, UT ITS, or any UT department. "Instapoll" and "UT" are used descriptively to identify the service this tool monitors. All trademarks belong to their respective owners.

---

## Contributing

Pull requests welcome. For major changes please open an issue first to discuss what you'd like to change.
