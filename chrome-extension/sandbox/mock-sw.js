/**
 * mock-sw.js — Service Worker for the sandbox.
 * Intercepts fetch requests to the poll API endpoint and returns
 * mock data based on the current state set by the sandbox page.
 *
 * State is communicated from the controlled page via BroadcastChannel
 * 'utpoll-sandbox' with messages: { action: 'setPollState', live: bool }
 */
'use strict';

let pollIsLive = false;

// Receive state updates from the sandbox page
const channel = new BroadcastChannel('utpoll-sandbox');
channel.onmessage = ({ data }) => {
  if (data && data.action === 'setPollState') {
    pollIsLive = !!data.live;
  }
};

// Activate immediately — don't wait for old SW to be replaced
self.addEventListener('install',  ()  => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const { pathname } = new URL(event.request.url);

  // Match the same glob the extension watches: /api/v1/student/course/*/poll
  if (/\/api\/v1\/student\/course\/[^/?]+\/poll$/.test(pathname)) {
    event.respondWith(buildPollResponse());
  }
});

function buildPollResponse() {
  const body = pollIsLive
    ? JSON.stringify([
        {
          id:          1,
          type:        'attendance',
          title:       'Attendance Check',
          status:      'open',
          course_id:   12345,
          config_json: [],
          created_at:  new Date().toISOString(),
        },
      ])
    : JSON.stringify([]);

  return Promise.resolve(
    new Response(body, {
      status:  200,
      headers: {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  );
}
