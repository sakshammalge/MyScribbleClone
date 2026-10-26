# Inkling

A multiplayer draw-and-guess game for private rooms. Same classic game idea, its own look and feel.

**Live:** https://inkling-5wrz.onrender.com (free plan, so the first visit after idle can take about a minute to wake up).

## Status

Milestones M1 to M6 are done: room lobby, live drawing studio, game loop with rotating drawer and word choice, guessing and scoring with podium and rematch, and solid LAN play with host kick and rate limits. Pre-deploy hardening (guarded handlers, abuse caps, profanity filter, security headers, phone layout) and cloud packaging (Dockerfile, SIGTERM shutdown, hosted-mode banner) are done, and the game is deployed on Render.

Next: a round of feedback on the live build. Likely areas are polish, a paid always-on instance so rooms survive idle periods, and custom domain.

## Layout

- `shared/` event types and game constants used by both sides
- `server/` Node 22 + Socket.IO + Express; owns all game state in memory
- `client/` React + Vite + Canvas

## Run it

```sh
npm install
npm run dev      # server on :3001, Vite on :5173 (both listen on the LAN)
```

## Hosting on the office LAN

One machine runs the game; everyone else opens its address in a browser. For a hosted deployment instead, see Deploying to the cloud below.

On the host machine (Node 22 or newer, Windows, macOS or Linux):

```sh
npm install     # once
npm run lan     # builds the client, then starts the server
```

The server prints the address to hand out:

```
  This machine:  http://localhost:3001
  Share this:    http://192.168.1.42:3001
```

Teammates open the "Share this" link. Use `PORT=3002 npm run lan` for another port (on Windows PowerShell: `$env:PORT=3002; npm run lan`). After the first build, `npm start` restarts without rebuilding. Rooms live in memory, so restarting the server ends every game.

Tip: the host should open the game through the "Share this" address too, so the invite link copied from the address bar works for everyone.

### If teammates cannot connect

1. **Check from the host first.** Open `http://localhost:3001/healthz`; it should answer `{"ok":true,...}`. If not, the server is not running (look at the terminal).
2. **Firewall.** The most common cause. Allow inbound TCP on port 3001 (or your `PORT`) for Node.js.
   - Windows: when the prompt "Allow Node.js to communicate on private networks" appears, tick Private and Allow. Otherwise Windows Security > Firewall > Allow an app, or `netsh advfirewall firewall add rule name="Inkling" dir=in action=allow protocol=TCP localport=3001`.
   - macOS: System Settings > Network > Firewall > Options, allow incoming connections for `node`.
   - Linux: `sudo ufw allow 3001/tcp`.
3. **Wrong address.** The machine may have several (VPN, Docker, Wi-Fi plus cable). Every one is printed; try the one that shares its first numbers with your teammates' own IP.
4. **Client isolation.** Guest or office Wi-Fi often stops devices from seeing each other. Put everyone on the same normal network, or ask IT to turn "AP/client isolation" off for it. Wired and Wi-Fi are sometimes separate subnets too.
5. **VPN.** A VPN on the host or a teammate's machine can hide LAN addresses; turn it off while playing.
6. **Port in use.** The server says so and exits; pick another with `PORT`.

Players who drop (sleep, Wi-Fi blip) keep their seat for 30 seconds and rejoin by reloading the page.

## Deploying to the cloud

The repo ships a `Dockerfile` (Node 22) that builds the client and serves everything, API and sockets, from one process on `PORT` (default 3001):

```sh
docker build -t inkling .
docker run --rm -p 3001:3001 inkling
```

The image sets `NODE_ENV=production`, so the server skips the LAN "Share this" banner and only reports its port. Locally, `npm start` with `NODE_ENV=production` (or `INKLING_LAN=0`) does the same. `/healthz` answers 200 for platform health checks, and the server shuts down cleanly on `SIGTERM`.

What the host must provide:

- **One instance only.** Rooms and games live in that process's memory. A second instance would not see the first's rooms, so do not scale out or enable autoscaling.
- **WebSockets.** The game runs over Socket.IO. Pick a host that keeps long-lived connections open (Fly.io, Render, Railway or any container host). Serverless platforms such as Vercel or Netlify functions cannot hold them and will not work.
- **HTTPS in front.** Hosts terminate TLS for you; no app config is needed because sockets use the page's own origin.
- **Proxy awareness.** Behind a host's proxy every visitor looks like the same IP unless you set `INKLING_TRUST_PROXY=1` (or the number of proxy hops), so the per-IP limits would be shared by everyone. The caps are tunable with `INKLING_MAX_CONNECTIONS_PER_IP`, `INKLING_MAX_ROOMS_PER_IP` and `INKLING_MAX_ROOMS`.
- **No sleeping.** An instance that scales to zero loses every room. Keep it always on (the free Render plan sleeps after about 15 minutes idle, which also ends every room).

### Current deployment (Render)

The live game runs as a Render Docker web service named `inkling`, built from this repo's `Dockerfile`:

- Plan: free, region Singapore, one instance.
- Health check: `/healthz`. Auto-deploy from `main` on every commit.
- Environment: `NODE_ENV=production`, `INKLING_LAN=0`, `INKLING_TRUST_PROXY=1`.
- The service was created through the Render API and is not linked to the `render.yaml` Blueprint, which documents the same settings for anyone recreating it. Editing `render.yaml` does not change the live service; change settings in the Render dashboard.
- API keys and other secrets never go in the repo.

Every deploy or restart wipes live games. Players who were mid-game see "The server restarted and the room is gone" and can create a new room. Deploy when nobody is playing.

## Rooms

Rooms are private: create one, then share the `/r/CODE` invite link (or the 5-character code). The lobby shows the roster live, the host edits rounds, draw time and max players, and the host role moves on if the host leaves. A refresh keeps your seat for 30 seconds.

Hosts can remove a player with the Remove button next to their name (in the lobby) or the ✕ in the game's player rail. Removed players are barred from that room under the same name. Chat, drawing and other events are rate-limited per connection (`server/src/ratelimit.ts`) so a stuck key or a script cannot flood a room.

## Drawing

The host presses Start game (two or more players) to open the drawing studio. For now the host holds the pen; the game loop will rotate it. The drawer gets a brush in five sizes, a 20-colour palette, an eraser, flood fill, undo (Ctrl/Cmd+Z) and clear; shortcuts are B, E and F. Everyone else watches live.

Strokes travel as 0 to 1 fractions of a fixed 960x720 sheet, batched about every 30 ms. The server keeps the ordered operations per room, so a refresh, reconnect or late join replays the whole picture. Only the drawer's events are accepted, and every event is validated and size-capped. The protocol lives in `shared/src/canvas.ts`.

## Scoring and results

A correct guess is worth 100 plus up to 300 for the time left, plus 100/60/30 for the first three guessers; the drawer earns the average guesser's score, scaled by how many found it (`server/src/game.ts`). After each turn the reveal lists the points biggest first and the scoreboard shows a `+N` chip. At the end the top three stand on a podium (equal scores share a place and announce a tie), and the host can hit Play again for an immediate rematch with the same players, or go back to the lobby.

## Checks

`npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`, and `npm run test:e2e` (Playwright, multi-browser room flows). All run in CI.

## Word list

The built-in words (`server/src/wordlist.ts`, about 3,400 of them) are common concrete nouns taken from
WordNet and filtered by SCOWL frequency, merged with the MIT-licensed `word-pictionary-list` package and a
hand-picked set of actions and party staples, minus a blocklist of words you would not want on a shared
screen. Hosts can add their own words (or use only theirs) from the lobby.
