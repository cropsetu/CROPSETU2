// TEMP diagnostic — first import in server.js. Confirms the Node process starts
// and prints the runtime PORT so we can see how far boot gets in Railway logs.
process.stdout.write(`[boot] node process started — PORT=${process.env.PORT} NODE_ENV=${process.env.NODE_ENV}\n`);
process.on('uncaughtException', (e) => { process.stdout.write(`[boot] uncaughtException: ${e?.stack || e}\n`); });
process.on('unhandledRejection', (e) => { process.stdout.write(`[boot] unhandledRejection: ${e?.stack || e}\n`); });
