import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';
import { errors } from '@strapi/utils';
import type { Core } from '@strapi/types';

import { wrapResolvers } from '../wrap-resolvers';

const buildSchema = () =>
  new GraphQLSchema({
    query: new GraphQLObjectType({
      name: 'Query',
      fields: {
        thing: {
          type: GraphQLString,
          resolve: () => 'resolved',
        },
      },
    }),
  });

const makeStrapi = () =>
  ({
    get: jest.fn(() => ({ resolve: jest.fn(() => []) })),
    auth: { verify: jest.fn(async () => undefined) },
    middleware: jest.fn(),
  }) as unknown as Core.Strapi;

const makeInfo = () => ({}) as any;

describe('wrapResolvers request abort', () => {
  it('refuses to resolve fields once the request abort signal fired', async () => {
    const schema = wrapResolvers({
      schema: buildSchema(),
      strapi: makeStrapi(),
      extension: {},
    });

    const field = schema.getQueryType()!.getFields().thing;
    const context = { state: { abortSignal: AbortSignal.abort() } };

    await expect(field.resolve!({}, {}, context, makeInfo())).rejects.toBeInstanceOf(
      errors.RequestAbortedError
    );
  });

  it('resolves fields normally when the request has not been aborted', async () => {
    const schema = wrapResolvers({
      schema: buildSchema(),
      strapi: makeStrapi(),
      extension: {},
    });

    const field = schema.getQueryType()!.getFields().thing;
    const context = { state: { abortSignal: new AbortController().signal } };

    await expect(field.resolve!({}, {}, context, makeInfo())).resolves.toBe('resolved');
  });

  it('resolves fields normally when the context carries no abort signal', async () => {
    const schema = wrapResolvers({
      schema: buildSchema(),
      strapi: makeStrapi(),
      extension: {},
    });

    const field = schema.getQueryType()!.getFields().thing;

    await expect(field.resolve!({}, {}, {}, makeInfo())).resolves.toBe('resolved');
  });
});
