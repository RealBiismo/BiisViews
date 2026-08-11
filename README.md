# BiisViews

BiisViews is a lightweight web app for looking up public Kick channel information using undocumented website endpoints rather than requiring your own official Kick developer credentials.

## Features

- Search by Kick username or channel URL
- Live/offline status
- Viewer count when available
- Stream title and category
- Follower count where returned
- Profile photo and bio
- Channel and chatroom IDs
- Raw upstream JSON for debugging

## Run locally

Requires Node.js 18+.

```bash
npm start
```

Then open `http://localhost:3000`.

## Important

This integration uses undocumented Kick website endpoints. They can change, become rate limited, or stop working without notice. The endpoint adapter lives in `server.js` so it can be replaced without rebuilding the rest of the app.
