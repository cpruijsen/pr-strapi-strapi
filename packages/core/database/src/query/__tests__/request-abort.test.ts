import knex from 'knex';
import { errors } from '@strapi/utils';

import { createMetadata } from '../../metadata';
import { raceWithAbort, requestCtx } from '../../request-context';
import createQueryBuilder from '../query-builder';
import type { Database } from '../..';

const UID = 'api::test.test';

const models = [
  {
    uid: UID,
    singularName: 'test',
    pluralName: 'tests',
    tableName: 'tests',
    attributes: {
      id: { type: 'increments' },
      name: { type: 'string' },
    },
  },
];

const makeDb = () => {
  const connection = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  const db = {
    connection,
    metadata: createMetadata(models as any),
    getConnection: (table?: string) => (table ? connection(table) : connection),
    dialect: {
      client: 'sqlite',
      useReturning: () => false,
      transformErrors(e: Error) {
        throw e;
      },
    },
    lifecycles: {
      run: jest.fn(async () => undefined),
    },
  } as any;

  return { db: db as Database, connection };
};

describe('requestCtx', () => {
  it('exposes the signal to work running inside the request scope', async () => {
    const controller = new AbortController();

    await requestCtx.run(controller.signal, async () => {
      expect(requestCtx.get()).toBe(controller.signal);
    });
  });

  it('is empty outside of a request scope', () => {
    expect(requestCtx.get()).toBeUndefined();
  });
});

describe('raceWithAbort', () => {
  it('resolves with the promise value while the request is alive', async () => {
    const controller = new AbortController();

    await expect(raceWithAbort(Promise.resolve('result'), controller.signal)).resolves.toBe(
      'result'
    );
  });

  it('rejects with RequestAbortedError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const settled = jest.fn();
    await expect(
      raceWithAbort(Promise.resolve('result').then(settled), controller.signal)
    ).rejects.toBeInstanceOf(errors.RequestAbortedError);
  });

  it('rejects with RequestAbortedError as soon as the request aborts mid-flight', async () => {
    const controller = new AbortController();
    let resolveQuery!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolveQuery = resolve;
    });

    const raced = raceWithAbort(pending, controller.signal);
    controller.abort();

    await expect(raced).rejects.toBeInstanceOf(errors.RequestAbortedError);

    // The underlying work still settles afterwards without an unhandled rejection.
    resolveQuery('late');
    await expect(pending).resolves.toBe('late');
  });

  it('propagates the original rejection when the promise fails before abort', async () => {
    const controller = new AbortController();
    const failure = new Error('query failed');

    await expect(raceWithAbort(Promise.reject(failure), controller.signal)).rejects.toBe(failure);
  });
});

describe('query builder abort handling', () => {
  it('executes queries normally when the request signal is not aborted', async () => {
    const { db, connection } = makeDb();
    await connection.schema.createTable('tests', (t) => {
      t.increments('id');
      t.string('name');
    });
    await connection('tests').insert({ name: 'a' });

    const controller = new AbortController();
    const rows = await requestCtx.run(controller.signal, () =>
      createQueryBuilder(UID, db)
        .init({ where: { name: 'a' } })
        .execute()
    );

    expect(rows).toHaveLength(1);

    await connection.destroy();
  });

  it('refuses to issue a query once the request is aborted', async () => {
    const { db, connection } = makeDb();
    await connection.schema.createTable('tests', (t) => {
      t.increments('id');
      t.string('name');
    });
    await connection('tests').insert({ name: 'a' });

    const issuedQueries: string[] = [];
    connection.on('query', (query) => issuedQueries.push(query.sql));

    const controller = new AbortController();
    await requestCtx.run(controller.signal, async () => {
      await createQueryBuilder(UID, db).init().execute();

      controller.abort();

      await expect(
        createQueryBuilder(UID, db)
          .init({ where: { name: 'a' } })
          .execute()
      ).rejects.toBeInstanceOf(errors.RequestAbortedError);

      await expect(
        createQueryBuilder(UID, db).insert({ name: 'b' }).execute()
      ).rejects.toBeInstanceOf(errors.RequestAbortedError);
    });

    // Only the first select was issued; nothing ran after the abort.
    expect(issuedQueries).toHaveLength(1);
    await expect(connection('tests').where({ name: 'b' })).resolves.toHaveLength(0);

    await connection.destroy();
  });

  it('unwinds an in-flight query when the request aborts mid-execution', async () => {
    const { db, connection } = makeDb();
    await connection.schema.createTable('tests', (t) => {
      t.increments('id');
      t.string('name');
    });

    const controller = new AbortController();
    const qb = createQueryBuilder(UID, db);

    // Stand in for a query that is still running when the client goes away.
    jest
      .spyOn(qb, 'getKnexQuery')
      .mockReturnValue(new Promise(() => {}) as unknown as ReturnType<(typeof qb)['getKnexQuery']>);

    const execution = requestCtx.run(controller.signal, () => qb.execute());
    controller.abort();

    await expect(execution).rejects.toBeInstanceOf(errors.RequestAbortedError);

    await connection.destroy();
  });

  it('does not abort queries executed outside of a request scope', async () => {
    const { db, connection } = makeDb();
    await connection.schema.createTable('tests', (t) => {
      t.increments('id');
      t.string('name');
    });
    await connection('tests').insert({ name: 'a' });

    const rows = await createQueryBuilder(UID, db).init().execute();
    expect(rows).toHaveLength(1);

    await connection.destroy();
  });
});
