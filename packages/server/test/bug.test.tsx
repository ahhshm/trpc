/* eslint-disable @typescript-eslint/no-unused-var */

import '@testing-library/jest-dom';
import { httpBatchLink } from '@trpc/client/links/httpBatchLink';
import React from 'react';
import {
  QueryClient,
  QueryClientProvider,
  // useQueryClient,
} from 'react-query';
import { createReactQueryHooks } from '../../react/src';
import { DefaultErrorShape } from '../src';
import { routerToServerAndClient, expectType } from './_testHelpers';
import {
  wsLink,
  createWSClient,
  TRPCWebSocketClient,
} from '../../client/src/links/wsLink';
import { splitLink } from '../../client/src/links/splitLink';
import { renderHook, act } from '@testing-library/react-hooks';
import { createMockRouter } from './_mockRouter';

function createAppRouter() {
  const createContext = jest.fn(() => ({}));
  let wsClient: TRPCWebSocketClient = null as any;

  const { router, resolverMock } = createMockRouter();

  const linkSpy = {
    up: jest.fn(),
    down: jest.fn(),
  };

  const { client, trpcClientOptions, close } = routerToServerAndClient(router, {
    server: {
      createContext,
      batching: {
        enabled: true,
      },
    },
    client({ wssUrl }) {
      wsClient = createWSClient({
        url: wssUrl,
      });
      return {
        // links: [wsLink({ client: ws })],
        // links: [
        //   () =>
        //     ({ op, next, prev }) => {
        //       linkSpy.up(op);
        //       next(op, (result) => {
        //         linkSpy.down(result);
        //         prev(result);
        //       });
        //     },
        //   splitLink({
        //     condition(op) {
        //       return op.type === 'subscription';
        //     },
        //     true: wsLink({
        //       client: wsClient,
        //     }),
        //     false: httpBatchLink({
        //       url: httpUrl,
        //     }),
        //   }),
        // ],
      };
    },
  });

  const trpc = createReactQueryHooks<typeof router>();

  function createWrapper(): React.FC {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    return ({ children }) => (
      <trpc.Provider queryClient={queryClient} client={client}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </trpc.Provider>
    );
  }

  return {
    appRouter: router,
    createWrapper,
    trpc,
    close,
    client,
    trpcClientOptions,
    resolverMock,
    createContext,
    linkSpy,
  };
}

let factory: ReturnType<typeof createAppRouter>;
let trpc: typeof factory.trpc;
let createWrapper: typeof factory.createWrapper;

beforeEach(() => {
  factory = createAppRouter();
  trpc = factory.trpc;
  createWrapper = factory.createWrapper;
});

afterEach(() => {
  factory.close();
});

describe('formatError', () => {
  it('should return the currect error shape', async () => {
    const { result, waitFor } = renderHook(
      () =>
        trpc.useMutation('post.add', {
          onError: (error: any) => {
            console.log('err: ', error);
          },
        }),
      {
        wrapper: createWrapper(),
      },
    );

    const mutation = result.current;

    act(() => {
      mutation.mutate({ title: 123 as any });
    });

    console.log('status: ', mutation.status);
    // BUG: why is mutation.status is idle here? it should be error
    await waitFor(() => {
      if (mutation.isError) {
        console.log('error: ', mutation.error);
      }
      return mutation.isError;
    });

    // expect(result.error).toBeInstanceOf(TRPCError);

    expectType<
      DefaultErrorShape & {
        $test: string;
      }
    >(mutation.error?.shape!);
  });
});
