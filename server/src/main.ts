import { DEFAULT_PORT } from '@inkling/shared';
import { createInklingServer } from './app';
import { lanAddresses } from './lan';

const port = Number(process.env.PORT ?? DEFAULT_PORT);
const { http } = createInklingServer();

// Bind every interface so other machines on the LAN can reach us.
http.listen(port, '0.0.0.0', () => {
  console.log(`Inkling server listening on port ${port}`);
  console.log(`  local:   http://localhost:${port}`);
  for (const ip of lanAddresses()) console.log(`  network: http://${ip}:${port}`);
});
