import { DEFAULT_PORT } from '@inkling/shared';
import { clientBuilt, createInklingServer } from './app';
import { lanAddresses } from './lan';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
// INKLING_TIME_SCALE=0.1 shortens the pauses between turns (used by e2e tests).
const timeScale = Number(process.env.INKLING_TIME_SCALE) || undefined;
// LAN mode (the default) prints the addresses teammates can open. Hosted deploys run with
// NODE_ENV=production, or INKLING_LAN=0, and only report the port.
const lanMode = process.env.INKLING_LAN
  ? process.env.INKLING_LAN !== '0'
  : process.env.NODE_ENV !== 'production';
const { http, io } = createInklingServer({ timeScale });

http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other process, or run with PORT=3002.`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

// Bind every interface so other machines (or the container's port mapping) can reach us.
http.listen(port, '0.0.0.0', () => {
  console.log(`\nInkling is running.\n`);
  console.log(`  This machine:  http://localhost:${port}`);
  if (!lanMode) {
    console.log(`  Hosted mode:   listening on port ${port}; share your public URL.\n`);
    return;
  }
  const addresses = lanAddresses();
  if (addresses.length === 0) {
    console.log('  Network:       no network connection found; teammates cannot join yet.');
  }
  for (const ip of addresses) console.log(`  Share this:    http://${ip}:${port}`);
  if (!clientBuilt) {
    console.log(
      '\n  The client is not built, so only the API is served. Run "npm run lan" instead.',
    );
  } else if (addresses.length > 0) {
    console.log(
      '\n  Teammates open the "Share this" link. If it will not load, see README > Hosting.',
    );
  }
  console.log('');
});

// Hosts stop containers with SIGTERM: close sockets and the listener, then exit.
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down.`);
  // Rooms are in memory, so there is nothing to flush; force exit if connections linger.
  setTimeout(() => process.exit(0), 5000).unref();
  io.close(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
