import { EventEmitter } from 'node:events';
import { requestCtx as dbRequestCtx } from '@strapi/database';

import { abortOnDisconnect } from '../request-abort';

const makeCtx = ({ socketDestroyed = false } = {}) => {
  const res = new EventEmitter() as NodeJS.EventEmitter & {
    writableEnded: boolean;
  };
  res.writableEnded = false;

  return {
    req: { socket: { destroyed: socketDestroyed } },
    res,
    state: {} as Record<string, unknown>,
  } as any;
};

describe('abortOnDisconnect middleware', () => {
  it('exposes an abort signal on ctx.state and inside the database request context', async () => {
    const ctx = makeCtx();

    await abortOnDisconnect(ctx, async () => {
      expect(ctx.state.abortSignal).toBeInstanceOf(AbortSignal);
      expect(ctx.state.abortSignal.aborted).toBe(false);
      expect(dbRequestCtx.get()).toBe(ctx.state.abortSignal);
    });
  });

  it('aborts when the client connection closes before the response finished', async () => {
    const ctx = makeCtx();
    let abortedInside: boolean | undefined;

    await abortOnDisconnect(ctx, async () => {
      ctx.res.emit('close');
      abortedInside = ctx.state.abortSignal.aborted;
    });

    expect(abortedInside).toBe(true);
    expect(ctx.state.abortSignal.aborted).toBe(true);
  });

  it('does not abort when the response already finished (keep-alive close)', async () => {
    const ctx = makeCtx();

    await abortOnDisconnect(ctx, async () => {
      ctx.res.writableEnded = true;
      ctx.res.emit('close');
      expect(ctx.state.abortSignal.aborted).toBe(false);
    });
  });

  it('aborts immediately when the socket is already destroyed', async () => {
    const ctx = makeCtx({ socketDestroyed: true });

    await abortOnDisconnect(ctx, async () => {
      expect(ctx.state.abortSignal.aborted).toBe(true);
    });
  });
});
