# Inkling

A multiplayer draw-and-guess game for private rooms. Same classic game idea, its own look and feel.

## Layout

- `shared/` event types and game constants used by both sides
- `server/` Node 22 + Socket.IO + Express; owns all game state in memory
- `client/` React + Vite + Canvas

## Run it

```sh
npm install
npm run dev      # server on :3001, Vite on :5173 (both listen on the LAN)
```

Play over the office LAN in production mode (one process, serves the built client):

```sh
npm run build
npm start        # prints http://<your-LAN-IP>:3001 for teammates to open
```

If teammates cannot connect, check the firewall and that the Wi-Fi does not isolate clients.

## Rooms

Rooms are private: create one, then share the `/r/CODE` invite link (or the 5-character code). The lobby shows the roster live, the host edits rounds, draw time and max players, and the host role moves on if the host leaves. A refresh keeps your seat for 30 seconds.

## Drawing

The host presses Start game (two or more players) to open the drawing studio. For now the host holds the pen; the game loop will rotate it. The drawer gets a brush in five sizes, a 20-colour palette, an eraser, flood fill, undo (Ctrl/Cmd+Z) and clear; shortcuts are B, E and F. Everyone else watches live.

Strokes travel as 0 to 1 fractions of a fixed 960x720 sheet, batched about every 30 ms. The server keeps the ordered operations per room, so a refresh, reconnect or late join replays the whole picture. Only the drawer's events are accepted, and every event is validated and size-capped. The protocol lives in `shared/src/canvas.ts`.

## Checks

`npm run lint`, `npm run typecheck`, `npm test`, `npm run format:check`, and `npm run test:e2e` (Playwright, multi-browser room flows). All run in CI.
