import { requestCtx as dbRequestCtx } from '@strapi/database';
import type { Core } from '@strapi/types';

/**
 * Aborts request-scoped work when the client closes the connection before the
 * response has finished. The signal is exposed on `ctx.state.abortSignal` and
 * handed to the database request context so pending queries unwind and no
 * further queries are issued for a client that is already gone.
 *
 * `res` 'close' also fires on keep-alive connections once a completed response
 * ends; the `writableEnded` guard keeps those closes from aborting.
 */
const abortOnDisconnect: Core.MiddlewareHandler = (ctx, next) => {
  const abortController = new AbortController();
  ctx.state.abortSignal = abortController.signal;

  if (ctx.req.socket?.destroyed) {
    abortController.abort();
  } else {
    ctx.res.once('close', () => {
      if (!ctx.res.writableEnded) {
        abortController.abort();
      }
    });
  }

  return dbRequestCtx.run(abortController.signal, next);
};

export { abortOnDisconnect };
