import { AsyncLocalStorage } from 'node:async_hooks';

import { errors } from '@strapi/utils';

const storage = new AsyncLocalStorage<AbortSignal>();

/**
 * Abort signal of the HTTP request currently being handled, when work runs
 * inside a request scope. Work done outside of a request (bootstrap,
 * lifecycles, migrations, background jobs) has no store and is never aborted.
 */
const requestCtx = {
  run<T>(signal: AbortSignal, cb: () => T) {
    return storage.run(signal, cb);
  },

  get() {
    return storage.getStore();
  },
};

/**
 * Rejects with RequestAbortedError as soon as the request aborts instead of
 * waiting for the promise to settle. The underlying work still runs to
 * completion (knex cannot cancel a running query), but callers unwind
 * immediately and no further queries are issued for an aborted request.
 */
const raceWithAbort = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
  if (signal.aborted) {
    // Nobody consumes the result anymore; swallow the late settlement.
    promise.catch(() => {});
    return Promise.reject(new errors.RequestAbortedError());
  }

  const aborted = new Promise<never>((_, reject) => {
    const onAbort = () => reject(new errors.RequestAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    const detach = () => signal.removeEventListener('abort', onAbort);
    promise.then(detach, detach);
  });

  return Promise.race([promise, aborted]);
};

export { requestCtx, raceWithAbort };
