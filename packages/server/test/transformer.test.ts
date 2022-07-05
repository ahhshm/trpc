/* eslint-disable @typescript-eslint/no-unused-vars */
import devalue from 'devalue';
import superjson from 'superjson';
import {
  createWSClient,
  TRPCWebSocketClient,
  wsLink,
} from '../../client/src/links/wsLink';
import { TRPCClientError } from '../../client/src';
import { httpBatchLink } from '../../client/src/links/httpBatchLink';
import { TRPCError } from '../src/TRPCError';
import * as trpc from '../src';
import { routerToServerAndClient, waitError } from './_testHelpers';
import { httpLink } from '../../client/src/links/httpLink';
import fetch from 'node-fetch';
import { z } from 'zod';

function createMockRouterWithTransformer<Context>(
  transformer: trpc.DataTransformerOptions,
) {
  const resolverMock = jest.fn();
  const router = trpc
    .router<Context>()
    .transformer(transformer)
    .query('err', {
      resolve() {
        throw new Error('woop');
      },
    })
    .query('ping', {
      resolve() {
        resolverMock();
        return 'pong';
      },
    })
    .mutation('ping', {
      resolve() {
        resolverMock();
        return 'pong';
      },
    })
    .query('withStringInput', {
      input: z.string(),
      resolve({ input }) {
        resolverMock(input);
        return input;
      },
    })
    .query('withDateInput', {
      input: z.date(),
      resolve({ input }) {
        resolverMock(input);
        return input;
      },
    });

  return { router, resolverMock };
}

function Factory() {
  const { router, resolverMock } = createMockRouterWithTransformer();
}

// let factory

test('superjson up and down', async () => {
  const transformer = superjson;
  const { router, resolverMock } = createMockRouterWithTransformer(transformer);

  const date = new Date();
  const { client, close } = routerToServerAndClient(router, {
    client: { transformer },
  });
  const res = await client.query('withDateInput', date);
  expect(res.getTime()).toBe(date.getTime());
  expect((resolverMock.mock.calls[0][0] as Date).getTime()).toBe(
    date.getTime(),
  );

  close();
});

test('empty superjson up and down', async () => {
  const transformer = superjson;
  const { router } = createMockRouterWithTransformer(transformer);

  const { client, close } = routerToServerAndClient(router, {
    client: { transformer },
  });
  const res1 = await client.query('ping');
  expect(res1).toBe('pong');
  const res2 = await client.query('withStringInput', 'hello');
  expect(res2).toBe('hello');

  close();
});

test('wsLink: empty superjson up and down', async () => {
  const transformer = superjson;
  const { router } = createMockRouterWithTransformer(transformer);

  let ws: any = null;
  const { client, close } = routerToServerAndClient(router, {
    client({ wssUrl }) {
      ws = createWSClient({ url: wssUrl });
      return { transformer, links: [wsLink({ client: ws })] };
    },
  });
  const res1 = await client.query('ping');
  expect(res1).toBe('pong');
  const res2 = await client.query('withStringInput', 'hello');
  expect(res2).toBe('hello');

  close();
  ws.close();
});

test('devalue up and down', async () => {
  const transformer: trpc.DataTransformer = {
    serialize: (object) => devalue(object),
    deserialize: (object) => eval(`(${object})`),
  };
  const { router, resolverMock } = createMockRouterWithTransformer(transformer);

  const date = new Date();
  const { client, close } = routerToServerAndClient(router, {
    client: { transformer },
  });

  const res = await client.query('withDateInput', date);
  expect(res.getTime()).toBe(date.getTime());
  expect((resolverMock.mock.calls[0][0] as Date).getTime()).toBe(
    date.getTime(),
  );

  close();
});

test('not batching: superjson up and devalue down', async () => {
  const transformer: trpc.CombinedDataTransformer = {
    input: superjson,
    output: {
      serialize: (object) => devalue(object),
      deserialize: (object) => eval(`(${object})`),
    },
  };
  const { router, resolverMock } = createMockRouterWithTransformer(transformer);

  const date = new Date();
  const { client, close } = routerToServerAndClient(router, {
    client: ({ httpUrl }) => ({
      transformer,
      links: [httpLink({ url: httpUrl })],
    }),
  });
  const res = await client.query('withDateInput', date);
  expect(res.getTime()).toBe(date.getTime());
  expect((resolverMock.mock.calls[0][0] as Date).getTime()).toBe(
    date.getTime(),
  );

  close();
});

test('batching: superjson up and devalue down', async () => {
  const transformer: trpc.CombinedDataTransformer = {
    input: superjson,
    output: {
      serialize: (object) => devalue(object),
      deserialize: (object) => eval(`(${object})`),
    },
  };
  const { router, resolverMock } = createMockRouterWithTransformer(transformer);

  const date = new Date();
  const { client, close } = routerToServerAndClient(router, {
    client: ({ httpUrl }) => ({
      transformer,
      links: [httpBatchLink({ url: httpUrl })],
    }),
  });
  const res = await client.query('withDateInput', date);
  expect(res.getTime()).toBe(date.getTime());
  expect((resolverMock.mock.calls[0][0] as Date).getTime()).toBe(
    date.getTime(),
  );

  close();
});

test('batching: superjson up and devalue down', async () => {
  const transformer: trpc.CombinedDataTransformer = {
    input: superjson,
    output: {
      serialize: (object) => devalue(object),
      deserialize: (object) => eval(`(${object})`),
    },
  };
  const { router, resolverMock } = createMockRouterWithTransformer(transformer);

  const date = new Date();
  const { client, close } = routerToServerAndClient(router, {
    client: ({ httpUrl }) => ({
      transformer,
      links: [httpBatchLink({ url: httpUrl })],
    }),
  });
  const res = await client.query('withDateInput', date);
  expect(res.getTime()).toBe(date.getTime());
  expect((resolverMock.mock.calls[0][0] as Date).getTime()).toBe(
    date.getTime(),
  );

  close();
});

test('all transformers running in correct order', async () => {
  const transformerMock = jest.fn();

  const transformer: trpc.CombinedDataTransformer = {
    input: {
      serialize: (object) => {
        transformerMock('client:serialized');
        return object;
      },
      deserialize: (object) => {
        transformerMock('server:deserialized');
        return object;
      },
    },
    output: {
      serialize: (object) => {
        transformerMock('server:serialized');
        return object;
      },
      deserialize: (object) => {
        transformerMock('client:deserialized');
        return object;
      },
    },
  };

  const { router, resolverMock } = createMockRouterWithTransformer(transformer);

  const { client, close } = routerToServerAndClient(router, {
    client: { transformer },
  });
  const res = await client.query('withStringInput', 'hello');
  expect(res).toBe('hello');
  expect(resolverMock.mock.calls[0][0]).toBe('hello');
  expect(transformerMock.mock.calls[0][0]).toBe('client:serialized');
  expect(transformerMock.mock.calls[1][0]).toBe('server:deserialized');
  expect(transformerMock.mock.calls[2][0]).toBe('server:serialized');
  expect(transformerMock.mock.calls[3][0]).toBe('client:deserialized');

  close();
});

describe('transformer on router', () => {
  test('http', async () => {
    const transformer = superjson;
    const { router, resolverMock } =
      createMockRouterWithTransformer(transformer);

    const date = new Date();
    const { client, close } = routerToServerAndClient(router, {
      client: { transformer },
    });
    const res = await client.query('withDateInput', date);
    expect(res.getTime()).toBe(date.getTime());
    expect((resolverMock.mock.calls[0][0] as Date).getTime()).toBe(
      date.getTime(),
    );

    close();
  });

  test('ws', async () => {
    let wsClient: TRPCWebSocketClient = null as any;
    const transformer = superjson;
    const date = new Date();
    const { router, resolverMock } =
      createMockRouterWithTransformer(transformer);

    const { client, close } = routerToServerAndClient(router, {
      client({ wssUrl }) {
        wsClient = createWSClient({
          url: wssUrl,
        });
        return {
          transformer,
          links: [wsLink({ client: wsClient })],
        };
      },
    });

    const res = await client.query('withDateInput', date);
    expect(res.getTime()).toBe(date.getTime());
    expect((resolverMock.mock.calls[0][0] as Date).getTime()).toBe(
      date.getTime(),
    );

    wsClient.close();
    close();
  });

  test('duplicate transformers', () => {
    expect(() =>
      trpc.router().transformer(superjson).transformer(superjson),
    ).toThrowErrorMatchingInlineSnapshot(
      `"You seem to have double \`transformer()\`-calls in your router tree"`,
    );
  });

  test('superjson up and devalue down: transform errors correctly', async () => {
    const transformer: trpc.CombinedDataTransformer = {
      input: superjson,
      output: {
        serialize: (object) => devalue(object),
        deserialize: (object) => eval(`(${object})`),
      },
    };

    const { router } = createMockRouterWithTransformer(transformer);

    const onError = jest.fn();
    const { client, close } = routerToServerAndClient(router, {
      server: {
        onError,
      },
      client: {
        transformer,
      },
    });
    const clientError = await waitError(client.query('err'), TRPCClientError);
    expect(clientError.shape.message).toMatchInlineSnapshot(`"woop"`);
    expect(clientError.shape.code).toMatchInlineSnapshot(`-32603`);

    expect(onError).toHaveBeenCalledTimes(1);
    const serverError = onError.mock.calls[0][0].error;

    expect(serverError).toBeInstanceOf(TRPCError);
    if (!(serverError instanceof TRPCError)) {
      throw new Error('Wrong error');
    }
    expect(serverError.cause).toBeInstanceOf(Error);

    close();
  });
});

test('superjson - no input', async () => {
  const transformer = superjson;
  const { router } = createMockRouterWithTransformer(transformer);

  const { close, httpUrl } = routerToServerAndClient(router, {
    client: { transformer },
  });
  const json = await (await fetch(`${httpUrl}/ping`)).json();

  expect(json).not.toHaveProperty('error');
  expect(json).toMatchInlineSnapshot(`
Object {
  "id": null,
  "result": Object {
    "data": Object {
      "json": "pong",
    },
    "type": "data",
  },
}
`);

  close();
});
