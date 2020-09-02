import VieraTV from './viera';

const ip = process.argv.slice(2);

if (ip.length !== 1) {
  // eslint-disable-next-line no-console
  console.error(
    'Please (only) your Panasonic TV IP address as the (only) argument'
  );
  process.exitCode = 1;
} else {
  VieraTV.setup(ip[0]);
}
