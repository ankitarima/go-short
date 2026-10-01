import type { IncomingMessage } from 'node:http';
import proxyaddr from 'proxy-addr';

type Trust = number | boolean | string[];

/**
 * Same semantics as Express's `trust proxy` (it uses the same library): X-Forwarded-For is only
 * honoured for hops that are configured proxies, so a client cannot choose its own IP.
 */
export function makeClientIp(trust: Trust): (req: IncomingMessage) => string {
  const fn =
    typeof trust === 'number'
      ? (_addr: string, i: number) => i < trust
      : trust === true
        ? () => true
        : trust === false
          ? () => false
          : proxyaddr.compile(trust);
  return (req) => proxyaddr(req, fn) || req.socket.remoteAddress || 'unknown';
}
