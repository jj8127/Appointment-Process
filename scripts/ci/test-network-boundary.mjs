// Test processes inherit no service credentials. Runtime network is denied,
// except one explicit loopback port for a disposable PostgreSQL fixture.
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

const denied = () => { throw new Error('Runtime network is disabled in deterministic CI tests.'); };
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
  const port = Number(process.env.CI_TEST_LOOPBACK_POSTGRES_PORT);
  if (Number.isInteger(port) && port >= 1024 && options.host === '127.0.0.1' && Number(options.port) === port) {
    return connect.apply(this, args);
  }
  return denied();
};
http.request = http.get = https.request = https.get = denied;
globalThis.fetch = denied;
globalThis.WebSocket = class { constructor() { denied(); } };
syncBuiltinESMExports();
