/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { httpBatchLink } from '@trpc/client/links/httpBatchLink';
import React, { Fragment, ReactElement, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from 'react-query';
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
import { createMockRouter, Post } from './_mockRouter';

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

  function createWrapper(): React.FC<any> {
    return ({ children }) => <App>{children}</App>;
  }

  return {
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
let linkSpy: typeof factory.linkSpy;
let resolverMock: typeof factory.resolverMock;
let createWrapper: typeof factory.createWrapper;
let renderWithClient: typeof factory.renderWithClient;

beforeEach(() => {
  factory = createAppRouter();
  trpc = factory.trpc;
  linkSpy = factory.linkSpy;
  resolverMock = factory.resolverMock;
  createWrapper = factory.createWrapper;
  renderWithClient = factory.renderWithClient;
});

afterEach(() => {
  factory.close();
});

describe('formatError', () => {
  it('should return the currect error shape', async () => {
    const { result, waitFor } = renderHook(() => trpc.useMutation('post.add'), {
      wrapper: createWrapper(),
    });

    const mutation = result.current;

    act(() => {
      mutation.mutate({ title: 123 as any });
    });

    // BUG: why is `mutation.status` idle? it should be error
    await waitFor(() => mutation.isIdle);

    expectType<
      DefaultErrorShape & {
        $test: string;
      }
    >(mutation.error?.shape!);
  });
});

// TODO: another file?
describe('link', () => {
  it('should be called on every query', async () => {
    const { result, waitFor } = renderHook(() => trpc.useQuery(['ping']), {
      wrapper: createWrapper(),
    });

    await waitFor(() => result.current.isSuccess);

    expect(linkSpy.up).toHaveBeenCalledTimes(1);
    expect(linkSpy.down).toHaveBeenCalledTimes(1);
  });

  it('should be called on a failed query', async () => {
    const { result, waitFor } = renderHook(() => trpc.useQuery(['err']), {
      wrapper: createWrapper(),
    });

    await waitFor(() => result.current.isError);

    expect(linkSpy.up).toHaveBeenCalledTimes(1);
    expect(linkSpy.down).toHaveBeenCalledTimes(1);
  });

  it('should be called on every mutation', async () => {
    const { result, waitFor } = renderHook(() => trpc.useMutation(['ping']), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => result.current.isSuccess);

    expect(linkSpy.up).toHaveBeenCalledTimes(1);
    expect(linkSpy.down).toHaveBeenCalledTimes(1);
  });
});

describe('useQuery', () => {
  it('should currectly infer the input type', () => {
    // @ts-ignore
    // eslint-disable-next-line
    function Component() {
      expectType<(p: ['hello', string]) => any>(trpc.useQuery);
      expectType<(p: ['ping', null | undefined]) => any>(trpc.useQuery);
    }
  });

  it('should currectly infer the return type', () => {
    // @ts-ignore
    // eslint-disable-next-line
    function Component() {
      const pingQuery = trpc.useQuery(['ping']);
      expectType<string | undefined>(pingQuery.data);

      const allPostsQuery = trpc.useQuery(['post.all']);
      expectType<Post[] | undefined>(allPostsQuery.data);
    }
  });

  it('should support setting context in the useQuery params', async () => {
    const { result, waitFor } = renderHook(
      () =>
        trpc.useQuery(['post.all'], {
          context: {
            test: true,
          },
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => result.current.isSuccess);

    expect(linkSpy.up.mock.calls[0][0].context).toMatchObject({
      test: true,
    });
  });

  it('should currectly handle input', async () => {
    const { result, waitFor } = renderHook(
      () => trpc.useQuery(['post.paginated', { limit: 1 }]),
      { wrapper: createWrapper() },
    );

    await waitFor(() => result.current.isSuccess);

    expect(result.current.data?.items).toHaveLength(1);
  });
});

describe('useMutation', () => {
  it('should currectly infer the input type', async () => {
    // @ts-ignore
    // eslint-disable-next-line
    function Component() {
      // with no input
      const pingMutation = trpc.useMutation('ping');
      expectType<(v: null | undefined) => void>(pingMutation.mutate);
      expectType<(v: null | undefined) => void>(pingMutation.mutateAsync);

      // with required input
      const addPostMutation = trpc.useMutation('post.add');
      expectType<(v: { title: string }) => void>(addPostMutation.mutate);
      expectType<(v: { title: string }) => void>(addPostMutation.mutateAsync);

      // with optional input
      const deletePostsMutation = trpc.useMutation('post.delete');
      expectType<(v: null | undefined | string[]) => void>(
        deletePostsMutation.mutate,
      );
      expectType<(v: null | undefined | string[]) => void>(
        deletePostsMutation.mutateAsync,
      );
    }
  });

  it('should currectly infer the return type', () => {
    // @ts-ignore
    // eslint-disable-next-line
    function Component() {
      const pingMutation = trpc.useMutation('ping');
      expectType<string | undefined>(pingMutation.data);
    }
  });

  it('should accept an array as its path', async () => {
    // @ts-ignore
    // eslint-disable-next-line
    function Component() {
      // TODO: make it better
      expectType<(p: Array<any>) => void>(trpc.useMutation);
    }
  });

  it('should support setting context in the useMutation params', async () => {
    const { result, waitFor } = renderHook(
      () =>
        trpc.useMutation(['post.delete'], {
          context: {
            test: true,
          },
        }),
      { wrapper: createWrapper() },
    );

    result.current.mutate();

    await waitFor(() => result.current.isSuccess);

    expect(linkSpy.up.mock.calls[0][0].context).toMatchObject({
      test: true,
    });
  });
});

describe('useInfiniteQuery', () => {
  it('should currectly infer the return type', async () => {
    // @ts-ignore
    // eslint-disable-next-line
    function Component() {
      const paginatedPostsQuery = trpc.useInfiniteQuery([
        'post.paginated',
        { limit: 1 },
      ]);

      expectType<Post[] | undefined>(paginatedPostsQuery.data?.pages[0].items);
    }
  });

  it('should currectly handle input', async () => {
    const { result, waitFor } = renderHook(
      () =>
        trpc.useInfiniteQuery(
          [
            'post.paginated',
            {
              limit: 1,
            },
          ],
          {
            getNextPageParam: (lastPage) => lastPage.nextCursor,
          },
        ),
      { wrapper: createWrapper() },
    );

    await waitFor(() => result.current.isSuccess);

    expect(result.current.data?.pages[0].items).toHaveLength(1);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(result.current.data?.pages[1].items).toHaveLength(1);
    expect(result.current.hasNextPage).toBe(false);
  });

  // TODO: make it better
  test('useInfiniteQuery and fetchInfiniteQuery', async () => {
    function Component() {
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
              data-testid="fetch"
              onClick={() =>
                trpcContext.fetchInfiniteQuery(['post.paginated', { limit: 1 }])
              }
            >
              Fetch
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

    const rendered = renderWithClient(<Component />);

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
          data-testid="fetch"
        >
          Fetch
        </button>
      </div>
      <div />
    </div>
  `);

    userEvent.click(rendered.getByTestId('fetch'));

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('Fetching...');
    });
    await waitFor(() => {
      expect(rendered.container).not.toHaveTextContent('Fetching...');
    });

    // It should currectly fetch both pages
    expect(rendered.container).toHaveTextContent('first post');
    expect(rendered.container).toHaveTextContent('second post');
  });
});

describe('subscription', () => {
  // TODO: better message?
  it('should successfully subscribe to a path', async () => {
    function Component() {
      const [posts, setPosts] = useState<Post[]>([]);

      const addPosts = (newPosts?: Post[]) => {
        setPosts((currentPosts) => {
          const map: Record<Post['id'], Post> = {};
          for (const post of currentPosts) {
            map[post.id] = post;
          }
          for (const post of newPosts ?? []) {
            map[post.id] = post;
          }
          return Object.values(map);
        });
      };

      const input = posts.reduce(
        (num, post) => Math.max(num, post.createdAt),
        -1,
      );

      trpc.useSubscription(['post.new', input], {
        onNext(post) {
          addPosts([post]);
        },
      });

      const { mutate } = trpc.useMutation('post.add');

      useEffect(() => {
        if (posts.length === 2) {
          mutate({ title: 'third post' });
        }
      }, [posts.length, mutate]);

      return <pre>{JSON.stringify(posts, null, 4)}</pre>;
    }

    const rendered = renderWithClient(<Component />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('first post');
    });
    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('third post');
    });
  });
});

describe('invalidateQueries', () => {
  it('should successfully invalidate a query', async () => {
    function Component() {
      const trpcContext = trpc.useContext();
      const allPostsQuery = trpc.useQuery(['post.all'], {
        staleTime: Infinity,
      });

      return (
        <>
          <pre>
            allPostsQuery:{allPostsQuery.status} allPostsQuery:
            {allPostsQuery.isStale ? 'stale' : 'not-stale'}
          </pre>
          <button
            data-testid="refetch"
            onClick={() => {
              trpcContext.invalidateQueries(['post.all']);
            }}
          />
        </>
      );
    }

    const rendered = renderWithClient(<Component />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('allPostsQuery:success');
      expect(rendered.container).toHaveTextContent('allPostsQuery:not-stale');
    });

    expect(resolverMock).toHaveBeenCalledTimes(1);

    rendered.getByTestId('refetch').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('allPostsQuery:stale');
    });
    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('allPostsQuery:not-stale');
    });

    expect(resolverMock).toHaveBeenCalledTimes(2);
  });

  // TODO: better message?
  it('should successfully invalidate a query with input', async () => {
    function Component() {
      const trpcContext = trpc.useContext();
      const postByIdQuery = trpc.useQuery(['post.byId', '1'], {
        staleTime: Infinity,
      });

      return (
        <>
          <pre>
            postByIdQuery:{postByIdQuery.status} postByIdQuery:
            {postByIdQuery.isStale ? 'stale' : 'not-stale'}
          </pre>
          <button
            data-testid="refetch"
            onClick={() => {
              trpcContext.invalidateQueries(['post.all']);
              trpcContext.invalidateQueries(['post.byId', '1']);
            }}
          />
        </>
      );
    }

    const rendered = renderWithClient(<Component />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:success');
      expect(rendered.container).toHaveTextContent('postByIdQuery:not-stale');
    });

    expect(resolverMock).toHaveBeenCalledTimes(1);

    rendered.getByTestId('refetch').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:stale');
    });
    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:not-stale');
    });

    expect(resolverMock).toHaveBeenCalledTimes(2);
  });

  // TODO: make it better
  test('invalidateQueries() with different args', async () => {
    function MyComponent() {
      const postByIdQuery = trpc.useQuery(['post.byId', '1'], {
        staleTime: Infinity,
      });
      const utils = trpc.useContext();
      return (
        <>
          <pre>
            postByIdQuery:{postByIdQuery.status} postByIdQuery:
            {postByIdQuery.isStale ? 'stale' : 'not-stale'}
          </pre>
          <button
            data-testid="invalidate-1-string"
            onClick={() => {
              utils.invalidateQueries('post.byId');
            }}
          />
          <button
            data-testid="invalidate-2-tuple"
            onClick={() => {
              utils.invalidateQueries(['post.byId']);
            }}
          />
          <button
            data-testid="invalidate-3-exact"
            onClick={() => {
              utils.invalidateQueries(['post.byId', '1']);
            }}
          />
          <button
            data-testid="invalidate-4-all"
            onClick={() => {
              utils.invalidateQueries();
            }}
          />{' '}
          <button
            data-testid="invalidate-5-predicate"
            onClick={() => {
              utils.invalidateQueries({
                predicate(opts) {
                  const { queryKey } = opts;
                  const [path, input] = queryKey;

                  return path === 'post.byId' && input === '1';
                },
              });
            }}
          />
        </>
      );
    }

    const utils = renderWithClient(<MyComponent />);

    await waitFor(() => {
      expect(utils.container).toHaveTextContent('postByIdQuery:success');
      expect(utils.container).toHaveTextContent('postByIdQuery:not-stale');
    });

    for (const testId of [
      'invalidate-1-string',
      'invalidate-2-tuple',
      'invalidate-3-exact',
      'invalidate-4-all',
      'invalidate-5-predicate',
    ]) {
      // click button to invalidate
      utils.getByTestId(testId).click();

      // should become stale straight after the click
      await waitFor(() => {
        expect(utils.container).toHaveTextContent('postByIdQuery:stale');
      });
      // then, eventually be not stale as it's been refetched
      await waitFor(() => {
        expect(utils.container).toHaveTextContent('postByIdQuery:not-stale');
      });
    }

    // 5 clicks + initial load = 6
    expect(resolverMock).toHaveBeenCalledTimes(6);
  });
});

describe('setQueryData', () => {
  it('should set query data with raw data', async () => {
    function Component() {
      const trpcContext = trpc.useContext();
      const allPostsQuery = trpc.useQuery(['post.all'], {
        enabled: false,
      });

      return (
        <>
          <pre>{JSON.stringify(allPostsQuery.data ?? null, null, 4)}</pre>
          <button
            data-testid="setQueryData"
            onClick={async () => {
              trpcContext.setQueryData(
                ['post.all'],
                [
                  {
                    id: 'id',
                    title: 'title',
                    createdAt: Date.now(),
                  },
                ],
              );
            }}
          />
        </>
      );
    }

    const rendered = renderWithClient(<Component />);

    rendered.getByTestId('setQueryData').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('title');
    });
  });

  it('should set query data with updater function', async () => {
    function Component() {
      const trpcContext = trpc.useContext();
      const postByIdQuery = trpc.useQuery(['post.byId', '1'], {
        enabled: false,
      });

      return (
        <>
          <pre>{JSON.stringify(postByIdQuery.data ?? null, null, 4)}</pre>
          <button
            data-testid="setQueryData"
            onClick={async () => {
              const newPost = {
                id: 'id',
                title: 'postById.tmp.title',
                createdAt: Date.now(),
              };
              trpcContext.setQueryData(['post.byId', '1'], (data) => {
                expect(data).toBe(undefined);
                return newPost;
              });
              // now it should be set
              trpcContext.setQueryData(['post.byId', '1'], (data) => {
                expect(data).toEqual(newPost);
                if (!data) {
                  return newPost;
                }
                return {
                  ...data,
                  title: 'postById.title',
                };
              });
            }}
          />
        </>
      );
    }

    const rendered = renderWithClient(<Component />);

    rendered.getByTestId('setQueryData').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postById.title');
    });
  });
});

describe('setInfiniteQueryData', () => {
  it('should set query data with raw data', async () => {
    function Component() {
      const utils = trpc.useContext();

      const allPostsQuery = trpc.useInfiniteQuery(['post.paginated', {}], {
        enabled: false,
        getNextPageParam: (next) => next.nextCursor,
      });

      return (
        <>
          <pre>
            {JSON.stringify(
              allPostsQuery.data?.pages.map((p) => p.items) ?? null,
              null,
              4,
            )}
          </pre>
          <button
            data-testid="setInfiniteQueryData"
            onClick={async () => {
              // Add a new post to the first page (without callback)
              utils.setInfiniteQueryData(['post.paginated', {}], {
                pages: [
                  {
                    items: [
                      {
                        id: 'id',
                        title: 'infinitePosts.title',
                        createdAt: Date.now(),
                      },
                    ],
                    nextCursor: null,
                  },
                ],
                pageParams: [],
              });
            }}
          />
        </>
      );
    }

    const rendered = renderWithClient(<Component />);

    rendered.getByTestId('setInfiniteQueryData').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('infinitePosts.title');
    });
  });

  it('should set query data with updater function', async () => {
    function Component() {
      const utils = trpc.useContext();
      const paginatedPostsQuery = trpc.useInfiniteQuery(
        ['post.paginated', {}],
        {
          enabled: false,
          getNextPageParam: (next) => next.nextCursor,
        },
      );

      return (
        <>
          <pre>
            {JSON.stringify(
              paginatedPostsQuery.data?.pages.map((p) => p.items) ?? null,
              null,
              4,
            )}
          </pre>
          <button
            data-testid="setInfiniteQueryData"
            onClick={async () => {
              const newPost = {
                id: 'id',
                title: 'infinitePosts.title',
                createdAt: Date.now(),
              };

              utils.setInfiniteQueryData(['post.paginated', {}], (data) => {
                expect(data).toBe(undefined);

                return {
                  pages: [{ items: [newPost], nextCursor: null }],
                  pageParams: [],
                };
              });
            }}
          />
        </>
      );
    }

    const rendered = renderWithClient(<Component />);

    rendered.getByTestId('setInfiniteQueryData').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('infinitePosts.title');
    });
  });
});
