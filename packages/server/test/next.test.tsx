/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import { routerToServerAndClient, expectType } from './_testHelpers';
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { httpBatchLink } from '@trpc/client/links/httpBatchLink';
import { AppType } from 'next/dist/shared/lib/utils';
import React, { Fragment, ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
import { splitLink } from '../../client/src/links/splitLink';
import {
  TRPCWebSocketClient,
  createWSClient,
  wsLink,
} from '../../client/src/links/wsLink';
import { withTRPC } from '../../next/src';
import { createReactQueryHooks } from '../../react/src';
import { createSSGHelpers } from '../../react/ssg';
import { createMockRouter, createMockDatabase,Post } from './_mockRouter';

function createAppRouter() {
  const createContext = jest.fn(() => ({}));
  let wsClient: TRPCWebSocketClient = null as any;

  const { router, resolverMock, mockDatabase } = createMockRouter();

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
    client({ httpUrl, wssUrl }) {
      wsClient = createWSClient({
        url: wssUrl,
      });
      return {
        // links: [wsLink({ client: ws })],
        links: [
          () =>
            ({ op, next, prev }) => {
              linkSpy.up(op);
              next(op, (result) => {
                linkSpy.down(result);
                prev(result);
              });
            },
          splitLink({
            condition(op) {
              return op.type === 'subscription';
            },
            true: wsLink({
              client: wsClient,
            }),
            false: httpBatchLink({
              url: httpUrl,
            }),
          }),
        ],
      };
    },
  });

  const trpc = createReactQueryHooks<typeof router>();

  function App(props: { children: ReactElement }) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    return (
      <trpc.Provider queryClient={queryClient} client={client}>
        <QueryClientProvider client={queryClient}>
          {props.children}
        </QueryClientProvider>
      </trpc.Provider>
    );
  }

  function renderWithClient(component: ReactElement) {
    return render(<App>{component}</App>);
  }

  function createWrapper() {
    return ({ children }: any) => {
      return withTRPC({
        config: () => trpcClientOptions,
        ssr: true,
      })(children);
    };
  }

  return {
    db: mockDatabase,
    renderWithClient,
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
let trpcClientOptions: typeof factory.trpcClientOptions;
let appRouter: typeof factory.appRouter;
// let linkSpy: typeof factory.linkSpy;
// let resolverMock: typeof factory.resolverMock;
// let createWrapper: typeof factory.createWrapper;
// let renderWithClient: typeof factory.renderWithClient;

beforeEach(() => {
  factory = createAppRouter();
  trpc = factory.trpc;
  trpcClientOptions = factory.trpcClientOptions;
  appRouter = factory.appRouter
  // linkSpy = factory.linkSpy;
  // resolverMock = factory.resolverMock;
  // createWrapper = factory.createWrapper;
  // renderWithClient = factory.renderWithClient;
});

afterEach(() => {
  factory.close();
});

describe('withTRPC', () => {
  test('useQuery', async () => {
    const App: AppType = () => {
      const query = trpc.useQuery(['post.all']);
      return <>{JSON.stringify(query.data)}</>;
    };

    const Wrapped = withTRPC({
      config: () => trpcClientOptions,
      ssr: true,
    })(App);

    const props = await Wrapped.getInitialProps!({
      AppTree: Wrapped,
      Component: <div />,
    } as any);

    const utils = render(<Wrapped {...props} />);
    expect(utils.container).toHaveTextContent('first post');
  });

  // TODO: better place?
  test.skip('useInfiniteQuery', async () => {
    // @ts-ignore
    const { window } = global;
    // @ts-ignore
    delete global.window;

    const { trpc, trpcClientOptions } = factory;
    const App: AppType = () => {
      const query = trpc.useInfiniteQuery(
        [
          'post.paginated',
          {
            limit: 10,
          },
        ],
        {
          getNextPageParam: (lastPage) => lastPage.nextCursor,
        },
      );
      return <>{JSON.stringify(query.data || query.error)}</>;
    };

    const Wrapped = withTRPC({
      config: () => trpcClientOptions,
      ssr: true,
    })(App);

    const props = await Wrapped.getInitialProps!({
      AppTree: Wrapped,
      Component: <div />,
    } as any);

    // @ts-ignore
    global.window = window;

    const utils = render(<Wrapped {...props} />);
    expect(utils.container).toHaveTextContent('first post');
  });

  test.skip('browser render', async () => {
    const { trpc, trpcClientOptions } = factory;
    const App: AppType = () => {
      const query = trpc.useQuery(['post.all']);
      return <>{JSON.stringify(query.data)}</>;
    };

    const Wrapped = withTRPC({
      config: () => trpcClientOptions,
      ssr: true,
    })(App);

    const props = await Wrapped.getInitialProps!({
      AppTree: Wrapped,
      Component: <div />,
    } as any);

    const utils = render(<Wrapped {...props} />);

    await waitFor(() => {
      expect(utils.container).toHaveTextContent('first post');
    });
  });

  describe('`ssr: false` on query', () => {
    test.skip('useQuery()', async () => {
      // @ts-ignore
      const { window } = global;
      // @ts-ignore
      delete global.window;

      const { trpc, trpcClientOptions } = factory;

      const App: AppType = () => {
        const query = trpc.useQuery(['post.all'], { ssr: false });
        return <>{JSON.stringify(query.data)}</>;
      };

      const Wrapped = withTRPC({
        config: () => trpcClientOptions,
        ssr: true,
      })(App);

      const props = await Wrapped.getInitialProps!({
        AppTree: Wrapped,
        Component: <div />,
      } as any);

      // @ts-ignore
      global.window = window;

      const utils = render(<Wrapped {...props} />);
      expect(utils.container).not.toHaveTextContent('first post');

      // should eventually be fetched
      await waitFor(() => {
        expect(utils.container).toHaveTextContent('first post');
      });
    });

    // TODO: doublecheck
    test.skip('useInfiniteQuery', async () => {
      // @ts-ignore
      const { window } = global;
      // @ts-ignore
      delete global.window;

      const { trpc, trpcClientOptions } = factory;

      const App: AppType = () => {
        const query = trpc.useInfiniteQuery(
          [
            'post.paginated',
            {
              limit: 10,
            },
          ],
          {
            getNextPageParam: (lastPage) => lastPage.nextCursor,
            ssr: false,
          },
        );
        return <>{JSON.stringify(query.data || query.error)}</>;
      };

      const Wrapped = withTRPC({
        config: () => trpcClientOptions,
        ssr: true,
      })(App);

      const props = await Wrapped.getInitialProps!({
        AppTree: Wrapped,
        Component: <div />,
      } as any);

      // @ts-ignore
      global.window = window;

      const utils = render(<Wrapped {...props} />);
      expect(utils.container).not.toHaveTextContent('first post');

      // should eventually be fetched
      await waitFor(() => {
        expect(utils.container).toHaveTextContent('first post');
      });
    });
  });

  test.skip('useQuery - ssr batching', async () => {
    // @ts-ignore
    const { window } = global;
    // @ts-ignore
    delete global.window;

    const { trpc, trpcClientOptions, createContext } = factory;

    const App: AppType = () => {
      const query1 = trpc.useQuery(['post.byId', '1']);
      const query2 = trpc.useQuery(['post.byId', '2']);
      return <>{JSON.stringify([query1.data, query2.data])}</>;
    };

    const Wrapped = withTRPC({
      config: () => trpcClientOptions,
      ssr: true,
    })(App);

    const props = await Wrapped.getInitialProps!({
      AppTree: Wrapped,
      Component: <div />,
    } as any);

    // @ts-ignore
    global.window = window;

    const utils = render(<Wrapped {...props} />);
    expect(utils.container).toHaveTextContent('first post');
    expect(utils.container).toHaveTextContent('second post');

    // confirm we've batched if createContext has only been called once
    expect(createContext).toHaveBeenCalledTimes(1);
  });

  // TODO: better message
  describe('`enabled: false` on query during ssr', () => {
    describe('useQuery', () => {
      test.skip('queryKey does not change', async () => {
        // @ts-ignore
        const { window } = global;
        // @ts-ignore
        delete global.window;

        const { trpc, trpcClientOptions } = factory;

        const App: AppType = () => {
          const query1 = trpc.useQuery(['post.byId', '1']);
          // query2 depends only on query1 status
          const query2 = trpc.useQuery(['post.byId', '2'], {
            enabled: query1.status === 'success',
          });
          return (
            <>
              <>{JSON.stringify(query1.data)}</>
              <>{JSON.stringify(query2.data)}</>
            </>
          );
        };

        const Wrapped = withTRPC({
          config: () => trpcClientOptions,
          ssr: true,
        })(App);

        const props = await Wrapped.getInitialProps!({
          AppTree: Wrapped,
          Component: <div />,
        } as any);

        // @ts-ignore
        global.window = window;

        const utils = render(<Wrapped {...props} />);

        // when queryKey does not change query2 only fetched in the browser
        expect(utils.container).toHaveTextContent('first post');
        expect(utils.container).not.toHaveTextContent('second post');

        await waitFor(() => {
          expect(utils.container).toHaveTextContent('first post');
          expect(utils.container).toHaveTextContent('second post');
        });
      });

      test.skip('queryKey changes', async () => {
        // @ts-ignore
        const { window } = global;
        // @ts-ignore
        delete global.window;

        const { trpc, trpcClientOptions } = factory;
        const App: AppType = () => {
          const query1 = trpc.useQuery(['post.byId', '1']);
          // query2 depends on data fetched by query1
          const query2 = trpc.useQuery(
            [
              'post.byId',
              // workaround of TS requiring a string param
              query1.data
                ? (parseInt(query1.data.id) + 1).toString()
                : 'definitely not a post id',
            ],
            {
              enabled: !!query1.data,
            },
          );
          return (
            <>
              <>{JSON.stringify(query1.data)}</>
              <>{JSON.stringify(query2.data)}</>
            </>
          );
        };

        const Wrapped = withTRPC({
          config: () => trpcClientOptions,
          ssr: true,
        })(App);

        const props = await Wrapped.getInitialProps!({
          AppTree: Wrapped,
          Component: <div />,
        } as any);

        // @ts-ignore
        global.window = window;

        const utils = render(<Wrapped {...props} />);

        // when queryKey changes both queries are fetched on the server
        expect(utils.container).toHaveTextContent('first post');
        expect(utils.container).toHaveTextContent('second post');

        await waitFor(() => {
          expect(utils.container).toHaveTextContent('first post');
          expect(utils.container).toHaveTextContent('second post');
        });
      });
    });

    describe('useInfiniteQuery', () => {
      test.skip('queryKey does not change', async () => {
        // @ts-ignore
        const { window } = global;
        // @ts-ignore
        delete global.window;

        const { trpc, trpcClientOptions } = factory;
        const App: AppType = () => {
          const query1 = trpc.useInfiniteQuery(
            ['post.paginated', { limit: 1 }],
            {
              getNextPageParam: (lastPage) => lastPage.nextCursor,
            },
          );
          // query2 depends only on query1 status
          const query2 = trpc.useInfiniteQuery(
            ['post.paginated', { limit: 2 }],
            {
              getNextPageParam: (lastPage) => lastPage.nextCursor,
              enabled: query1.status === 'success',
            },
          );
          return (
            <>
              <>{JSON.stringify(query1.data)}</>
              <>{JSON.stringify(query2.data)}</>
            </>
          );
        };

        const Wrapped = withTRPC({
          config: () => trpcClientOptions,
          ssr: true,
        })(App);

        const props = await Wrapped.getInitialProps!({
          AppTree: Wrapped,
          Component: <div />,
        } as any);

        // @ts-ignore
        global.window = window;

        const utils = render(<Wrapped {...props} />);

        // when queryKey does not change query2 only fetched in the browser
        expect(utils.container).toHaveTextContent('first post');
        expect(utils.container).not.toHaveTextContent('second post');

        await waitFor(() => {
          expect(utils.container).toHaveTextContent('first post');
          expect(utils.container).toHaveTextContent('second post');
        });
      });

      test.skip('queryKey changes', async () => {
        // @ts-ignore
        const { window } = global;
        // @ts-ignore
        delete global.window;

        const { trpc, trpcClientOptions } = factory;
        const App: AppType = () => {
          const query1 = trpc.useInfiniteQuery(
            ['post.paginated', { limit: 1 }],
            {
              getNextPageParam: (lastPage) => lastPage.nextCursor,
            },
          );
          // query2 depends on data fetched by query1
          const query2 = trpc.useInfiniteQuery(
            [
              'post.paginated',
              { limit: query1.data ? query1.data.pageParams.length + 1 : 0 },
            ],
            {
              getNextPageParam: (lastPage) => lastPage.nextCursor,
              enabled: query1.status === 'success',
            },
          );
          return (
            <>
              <>{JSON.stringify(query1.data)}</>
              <>{JSON.stringify(query2.data)}</>
            </>
          );
        };

        const Wrapped = withTRPC({
          config: () => trpcClientOptions,
          ssr: true,
        })(App);

        const props = await Wrapped.getInitialProps!({
          AppTree: Wrapped,
          Component: <div />,
        } as any);

        // @ts-ignore
        global.window = window;

        const utils = render(<Wrapped {...props} />);

        // when queryKey changes both queries are fetched on the server
        expect(utils.container).toHaveTextContent('first post');
        expect(utils.container).toHaveTextContent('second post');

        await waitFor(() => {
          expect(utils.container).toHaveTextContent('first post');
          expect(utils.container).toHaveTextContent('second post');
        });
      });
    });
  });

  /**
   * @link https://github.com/trpc/trpc/pull/1645
   */
  test.skip('regression: SSR with error sets `status`=`error`', async () => {
    // @ts-ignore
    const { window } = global;
    // @ts-ignore
    delete global.window;

    let queryState: any;
    const { trpc, trpcClientOptions } = factory;

    const App: AppType = () => {
      const query1 = trpc.useQuery(['bad-useQuery'] as any);
      const query2 = trpc.useInfiniteQuery(['bad-useInfiniteQuery'] as any);
      queryState = {
        query1: {
          status: query1.status,
          error: query1.error,
        },
        query2: {
          status: query2.status,
          error: query2.error,
        },
      };
      return <>{JSON.stringify(query1.data || null)}</>;
    };

    const Wrapped = withTRPC({
      config: () => trpcClientOptions,
      ssr: true,
    })(App);

    await Wrapped.getInitialProps!({
      AppTree: Wrapped,
      Component: <div />,
    } as any);

    // @ts-ignore
    global.window = window;

    expect(queryState.query1.error).toMatchInlineSnapshot(
      `[TRPCClientError: No "query"-procedure on path "bad-useQuery"]`,
    );
    expect(queryState.query2.error).toMatchInlineSnapshot(
      `[TRPCClientError: No "query"-procedure on path "bad-useInfiniteQuery"]`,
    );
    expect(queryState.query1.status).toBe('error');
    expect(queryState.query2.status).toBe('error');
  });
});

describe('createSSGHelpers', () => {
  it('should currectly prefetch queries', async () => {
    const ssg = createSSGHelpers({ router: appRouter, ctx: {} });

    await ssg.prefetchQuery('post.all');
    await ssg.fetchQuery('post.byId', '1');

    const dehydrated = ssg.dehydrate();
    expect(dehydrated.queries).toHaveLength(2);

    const [allPostsCache, postByIdCache] = dehydrated.queries;

    expect(allPostsCache.queryHash).toMatchInlineSnapshot(`"[\\"post.all\\"]"`);
    expect(allPostsCache.queryKey).toMatchInlineSnapshot(`
    Array [
      "post.all",
    ]
  `);
    expect(allPostsCache.state.data).toEqual(db.posts);
    expect(postByIdCache.state.data).toMatchInlineSnapshot(`
    Object {
      "createdAt": 0,
      "id": "1",
      "title": "first post",
    }
  `);
  });
});

describe('SSR', () => {
  // test('prefetchQuery', async () => {
  //   const { trpc, renderWithClient } = factory;
  //
  //   function MyComponent() {
  //     const [state, setState] = useState<string>('nope');
  //     const utils = trpc.useContext();
  //     const queryClient = useQueryClient();
  //
  //     useEffect(() => {
  //       async function prefetch() {
  //         await utils.prefetchQuery(['post.byId', '1']);
  //         setState(JSON.stringify(dehydrate(utils)));
  //       }
  //       prefetch();
  //     }, [queryClient, utils]);
  //
  //     return <>{JSON.stringify(state)}</>;
  //   }
  //
  //   const rendered = renderWithClient(<MyComponent />);
  //   await waitFor(() => {
  //     expect(rendered.container).toHaveTextContent('first post');
  //   });
  // });

  test.skip('prefetchInfiniteQuery()', async () => {
    const { appRouter } = factory;
    const ssg = createSSGHelpers({ router: appRouter, ctx: {} });

    {
      await ssg.prefetchInfiniteQuery('post.paginated', { limit: 1 });
      const data = JSON.stringify(ssg.dehydrate());
      expect(data).toContain('first post');
      expect(data).not.toContain('second post');
    }
    {
      await ssg.fetchInfiniteQuery('post.paginated', { limit: 2 });
      const data = JSON.stringify(ssg.dehydrate());
      expect(data).toContain('first post');
      expect(data).toContain('second post');
    }
  });

  test.skip('useInfiniteQuery and prefetchInfiniteQuery', async () => {
    const { trpc, renderWithClient } = factory;

    function MyComponent() {
      const trpcContext = trpc.useContext();
      const paginatedPostsQuery = trpc.useInfiniteQuery(
        [
          'post.paginated',
          {
            limit: 1,
          },
        ],
        {
          getNextPageParam: (lastPage) => lastPage.nextCursor,
        },
      );
      // TODO: undefiend???
      expectType<undefined | Post[]>(paginatedPostsQuery.data?.pages[0].items);

      return paginatedPostsQuery.status === 'loading' ? (
        <p>Loading...</p>
      ) : paginatedPostsQuery.status === 'error' ? (
        <p>Error: {paginatedPostsQuery.error.message}</p>
      ) : (
        <>
          {paginatedPostsQuery.data?.pages.map((group, i) => (
            <Fragment key={i}>
              {group.items.map((msg) => (
                <Fragment key={msg.id}>
                  <div>{msg.title}</div>
                </Fragment>
              ))}
            </Fragment>
          ))}
          <div>
            <button
              onClick={() => paginatedPostsQuery.fetchNextPage()}
              disabled={
                !paginatedPostsQuery.hasNextPage ||
                paginatedPostsQuery.isFetchingNextPage
              }
              data-testid="loadMore"
            >
              {paginatedPostsQuery.isFetchingNextPage
                ? 'Loading more...'
                : paginatedPostsQuery.hasNextPage
                ? 'Load More'
                : 'Nothing more to load'}
            </button>
          </div>
          <div>
            <button
              data-testid="prefetch"
              onClick={() =>
                trpcContext.prefetchInfiniteQuery([
                  'post.paginated',
                  { limit: 1 },
                ])
              }
            >
              Prefetch
            </button>
          </div>
          <div>
            {paginatedPostsQuery.isFetching &&
            !paginatedPostsQuery.isFetchingNextPage
              ? 'Fetching...'
              : null}
          </div>
        </>
      );
    }

    const rendered = renderWithClient(<MyComponent />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('first post');
    });
    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('first post');
      expect(rendered.container).not.toHaveTextContent('second post');
      expect(rendered.container).toHaveTextContent('Load More');
    });

    userEvent.click(rendered.getByTestId('loadMore'));

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('Loading more...');
    });
    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('first post');
      expect(rendered.container).toHaveTextContent('second post');
      expect(rendered.container).toHaveTextContent('Nothing more to load');
    });

    // TODO: really needed?
    expect(rendered.container).toMatchInlineSnapshot(`
    <div>
      <div>
        first post
      </div>
      <div>
        second post
      </div>
      <div>
        <button
          data-testid="loadMore"
          disabled=""
        >
          Nothing more to load
        </button>
      </div>
      <div>
        <button
          data-testid="prefetch"
        >
          Prefetch
        </button>
      </div>
      <div />
    </div>
  `);

    userEvent.click(rendered.getByTestId('prefetch'));

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('Fetching...');
    });
    await waitFor(() => {
      expect(rendered.container).not.toHaveTextContent('Fetching...');
    });

    // It should correctly fetch both pages
    expect(rendered.container).toHaveTextContent('first post');
    expect(rendered.container).toHaveTextContent('second post');
  });
});
