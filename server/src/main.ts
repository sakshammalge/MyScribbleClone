import { DEFAULT_PORT } from '@inkling/shared';
import { clientBuilt, createInklingServer } from './app';
import { lanAddresses } from './lan';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
// INKLING_TIME_SCALE=0.1 shortens the pauses between turns (used by e2e tests).
const timeScale = Number(process.env.INKLING_TIME_SCALE) || undefined;
const { http } = createInklingServer({ timeScale });

http.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Stop the other process, or run with PORT=3002.`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

// Bind every interface so other machines on the LAN can reach us.
http.listen(port, '0.0.0.0', () => {
  const addresses = lanAddresses();
  console.log(`\nInkling is running.\n`);
  console.log(`  This machine:  http://localhost:${port}`);
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
