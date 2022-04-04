/* eslint-disable @typescript-eslint/no-empty-function */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/ban-types */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */

import { trpcServer } from './_packages';
import '@testing-library/jest-dom';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { httpBatchLink } from '@trpc/client/links/httpBatchLink';
import { expectTypeOf } from 'expect-type';
import hash from 'hash-sum';
import React, { Fragment, ReactElement, useEffect, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  setLogger,
  useQueryClient,
} from 'react-query';
import { z, ZodError } from 'zod';
import { createReactQueryHooks, OutputWithCursor } from '../../react/src';
import { DefaultErrorShape } from '../src';
import { routerToServerAndClient } from './_testHelpers';
import {
  wsLink,
  createWSClient,
  TRPCWebSocketClient,
} from '../../client/src/links/wsLink';
import { splitLink } from '../../client/src/links/splitLink';
import { TRPCError } from '../src/TRPCError';

setLogger({
  log() {},
  warn() {},
  error() {},
});

type Context = {};
type Post = {
  id: string;
  title: string;
  createdAt: number;
};
type Database = {
  posts: Post[];
};

function createAppRouter() {
  const db: Database = {
    posts: [
      { id: '1', title: 'first post', createdAt: 0 },
      { id: '2', title: 'second post', createdAt: 1 },
    ],
  };
  const postLiveInputs: unknown[] = [];
  const createContext = jest.fn(() => ({}));
  const allPosts = jest.fn();
  const postById = jest.fn();
  let wsClient: TRPCWebSocketClient = null as any;
  const appRouter = trpcServer
    .router<Context>()
    .formatError(({ shape, error }) => {
      return {
        $test: 'formatted',
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
        ...shape,
      };
    })
    .query('allPosts', {
      resolve() {
        allPosts();
        return db.posts;
      },
    })
    .query('postById', {
      input: z.string(),
      resolve({ input }) {
        postById(input);
        const post = db.posts.find((p) => p.id === input);
        if (!post) {
          throw new TRPCError({ code: 'NOT_FOUND' });
        }
        return post;
      },
    })
    // TODO: refactor
    .query('paginatedPosts', {
      input: z.object({
        limit: z.number().min(1).max(100).nullish(),
        cursor: z.number().nullish(),
      }),
      resolve({ input }) {
        const items: typeof db.posts = [];
        const limit = input.limit ?? 50;
        const { cursor } = input;
        let nextCursor: typeof cursor = null;
        for (let index = 0; index < db.posts.length; index++) {
          const element = db.posts[index];
          if (cursor != null && element.createdAt < cursor) {
            continue;
          }
          items.push(element);
          if (items.length >= limit) {
            break;
          }
        }
        const last = items[items.length - 1];
        const nextIndex = db.posts.findIndex((item) => item === last) + 1;
        if (db.posts[nextIndex]) {
          nextCursor = db.posts[nextIndex].createdAt;
        }
        return {
          items,
          nextCursor,
        };
      },
    })
    .mutation('addPost', {
      input: z.object({
        title: z.string(),
      }),
      resolve({ input }) {
        db.posts.push({
          id: `${Math.random()}`,
          createdAt: Date.now(),
          title: input.title,
        });
      },
    })
    .mutation('deletePosts', {
      input: z.array(z.string()).nullish(),
      resolve({ input }) {
        if (input) {
          db.posts = db.posts.filter((p) => !input.includes(p.id));
        } else {
          db.posts = [];
        }
      },
    })
    .mutation('PING', {
      resolve() {
        return 'PONG' as const;
      },
    })
    .subscription('newPosts', {
      input: z.number(),
      resolve({ input }) {
        return trpcServer.subscriptionPullFactory<Post>({
          intervalMs: 1,
          pull(emit) {
            db.posts.filter((p) => p.createdAt > input).forEach(emit.data);
          },
        });
      },
    })
    .subscription('postsLive', {
      input: z.object({
        cursor: z.string().nullable(),
      }),
      resolve({ input }) {
        const { cursor } = input;
        postLiveInputs.push(input);

        return trpcServer.subscriptionPullFactory<OutputWithCursor<Post[]>>({
          intervalMs: 10,
          pull(emit) {
            const newCursor = hash(db.posts);
            if (newCursor !== cursor) {
              emit.data({ data: db.posts, cursor: newCursor });
            }
          },
        });
      },
    });

  const linkSpy = {
    up: jest.fn(),
    down: jest.fn(),
  };
  const { client, trpcClientOptions, close } = routerToServerAndClient(
    appRouter,
    {
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
    },
  );
  const queryClient = new QueryClient();
  const trpc = createReactQueryHooks<typeof appRouter>();

  function trpcRender(component: ReactElement) {
    return render(
      <trpc.Provider {...{ queryClient, client }}>
        <QueryClientProvider client={queryClient}>
          {component}
        </QueryClientProvider>
      </trpc.Provider>,
    );
  }

  return {
    trpcRender,
    appRouter,
    trpc,
    close,
    db,
    client,
    trpcClientOptions,
    postLiveInputs,
    resolvers: {
      postById,
      allPosts,
    },
    queryClient,
    createContext,
    linkSpy,
  };
}

let factory: ReturnType<typeof createAppRouter>;
beforeEach(() => {
  factory = createAppRouter();
});

afterEach(() => {
  factory.close();
});

export const expectType = <T,>(_: T): void => undefined;

describe('useQuery', () => {
  it('should infer the return type currectly', () => {});
  test('no input', async () => {
    const { trpc, trpcRender } = factory;

    function MyComponent() {
      const allPostsQuery = trpc.useQuery(['allPosts']);

      expectType<Post[]>(allPostsQuery.data!);
      // expectTypeOf(allPostsQuery.data!).toMatchTypeOf<Post[]>();
      return <pre>{JSON.stringify(allPostsQuery.data ?? 'n/a', null, 4)}</pre>;
    }

    const rendered = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('first post');
    });
  });

  it('should allow to specify context', async () => {
    const { trpc, linkSpy, trpcRender } = factory;

    function MyComponent() {
      const allPostsQuery = trpc.useQuery(['allPosts'], {
        context: {
          test: '1',
        },
      });

      expectTypeOf(allPostsQuery.data!).toMatchTypeOf<Post[]>();
      return <pre>{JSON.stringify(allPostsQuery.data ?? 'n/a', null, 4)}</pre>;
    }

    const rendered = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('first post');
    });

    expect(linkSpy.up).toHaveBeenCalledTimes(1);
    expect(linkSpy.down).toHaveBeenCalledTimes(1);
    expect(linkSpy.up.mock.calls[0][0].context).toMatchObject({
      test: '1',
    });
  });

  test('with input', async () => {
    const { trpc, trpcRender } = factory;

    function MyComponent() {
      const allPostsQuery = trpc.useQuery(['paginatedPosts', { limit: 1 }]);
      return <pre>{JSON.stringify(allPostsQuery.data ?? 'n/a', null, 4)}</pre>;
    }

    const rendered = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('first post');
    });

    expect(rendered.container).not.toHaveTextContent('second post');
  });
});

describe('useMutation', () => {
  test('call procedure with no input with null/undefined', async () => {
    const { trpc, trpcRender } = factory;

    const results: unknown[] = [];
    function MyComponent() {
      const mutation = trpc.useMutation('PING');
      const [finished, setFinished] = useState(false);

      useEffect(() => {
        (async () => {
          await new Promise((resolve) =>
            mutation.mutate(null, {
              onSettled: resolve,
            }),
          );
          await new Promise((resolve) =>
            mutation.mutate(undefined, {
              onSettled: resolve,
            }),
          );

          await mutation.mutateAsync(null);
          await mutation.mutateAsync(undefined);

          setFinished(true);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      useEffect(() => {
        results.push(mutation.data);
      }, [mutation.data]);

      return (
        <pre>
          {JSON.stringify(mutation.data ?? {}, null, 4)}
          {finished && '__IS_FINISHED__'}
        </pre>
      );
    }

    const rendered = trpcRender(<MyComponent />);
    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('__IS_FINISHED__');
    });

    // expect(results).toMatchInlineSnapshot();
  });

  test('nullish input called with no input', async () => {
    const { trpc, trpcRender } = factory;

    function MyComponent() {
      const allPostsQuery = trpc.useQuery(['allPosts']);
      const deletePostsMutation = trpc.useMutation('deletePosts');

      useEffect(() => {
        allPostsQuery.refetch().then(async (allPosts) => {
          expect(allPosts.data).toHaveLength(2);
          await deletePostsMutation.mutateAsync();
          const newAllPost = await allPostsQuery.refetch();
          expect(newAllPost.data).toHaveLength(0);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      return <pre>{JSON.stringify(allPostsQuery.data ?? {}, null, 4)}</pre>;
    }

    const rendered = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('first post');
    });

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('[]');
    });
  });

  // TODO: i think it shouldn't exist
  test('useMutation([path]) tuple', async () => {
    const { trpc, trpcRender } = factory;

    function MyComponent() {
      const allPostsQuery = trpc.useQuery(['allPosts']);
      const deletePostsMutation = trpc.useMutation(['deletePosts']);

      useEffect(() => {
        allPostsQuery.refetch().then(async (allPosts) => {
          expect(allPosts.data).toHaveLength(2);
          await deletePostsMutation.mutateAsync();
          const newAllPost = await allPostsQuery.refetch();
          expect(newAllPost.data).toHaveLength(0);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      return <pre>{JSON.stringify(allPostsQuery.data ?? {}, null, 4)}</pre>;
    }

    const utils = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(utils.container).toHaveTextContent('first post');
    });
    await waitFor(() => {
      expect(utils.container).toHaveTextContent('[]');
    });
  });

  // TODO: better message
  test('nullish input called with input', async () => {
    const { trpc, trpcRender } = factory;

    function MyComponent() {
      const allPostsQuery = trpc.useQuery(['allPosts']);
      const deletePostsMutation = trpc.useMutation('deletePosts');

      useEffect(() => {
        allPostsQuery.refetch().then(async (allPosts) => {
          expect(allPosts.data).toHaveLength(2);
          await deletePostsMutation.mutateAsync(['1']);
          const newAllPost = await allPostsQuery.refetch();
          expect(newAllPost.data).toHaveLength(1);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      return <pre>{JSON.stringify(allPostsQuery.data ?? {}, null, 4)}</pre>;
    }

    const utils = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(utils.container).toHaveTextContent('first post');
      expect(utils.container).toHaveTextContent('second post');
    });
    await waitFor(() => {
      expect(utils.container).not.toHaveTextContent('first post');
      expect(utils.container).toHaveTextContent('second post');
    });
  });

  test('useMutation with context', async () => {
    const { trpc, linkSpy, trpcRender } = factory;

    function MyComponent() {
      const deletePostsMutation = trpc.useMutation(['deletePosts'], {
        context: {
          test: '1',
        },
      });

      useEffect(() => {
        deletePostsMutation.mutate();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);

      return <pre>{deletePostsMutation.isSuccess && '___FINISHED___'}</pre>;
    }

    const utils = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(utils.container).toHaveTextContent('___FINISHED___');
    });

    // TODO: double check
    expect(linkSpy.up).toHaveBeenCalledTimes(1);
    expect(linkSpy.down).toHaveBeenCalledTimes(1);
    expect(linkSpy.up.mock.calls[0][0].context).toMatchObject({
      test: '1',
    });
  });

  test('mutation on mount + subscribe for it', async () => {
    const { trpc, trpcRender } = factory;

    function MyComponent() {
      const [posts, setPosts] = useState<Post[]>([]);

      const addPosts = (newPosts?: Post[]) => {
        setPosts((currentPosts) => {
          const map: Record<Post['id'], Post> = {};
          for (const msg of currentPosts ?? []) {
            map[msg.id] = msg;
          }
          for (const msg of newPosts ?? []) {
            map[msg.id] = msg;
          }
          return Object.values(map);
        });
      };
      const input = posts.reduce(
        (num, post) => Math.max(num, post.createdAt),
        -1,
      );

      trpc.useSubscription(['newPosts', input], {
        onNext(post) {
          addPosts([post]);
        },
      });

      const mutation = trpc.useMutation('addPost');
      const mutate = mutation.mutate;
      useEffect(() => {
        if (posts.length === 2) {
          mutate({ title: 'third post' });
        }
      }, [posts.length, mutate]);

      return <pre>{JSON.stringify(posts, null, 4)}</pre>;
    }

    const rendered = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('first post');
    });
    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('third post');
    });
  });
});

describe('useInfiniteQuery', () => {
  // TODO: better message?
  test('useInfiniteQuery()', async () => {
    const { trpc, trpcRender } = factory;

    function MyComponent() {
      const q = trpc.useInfiniteQuery(
        [
          'paginatedPosts',
          {
            limit: 1,
          },
        ],
        {
          getNextPageParam: (lastPage) => lastPage.nextCursor,
        },
      );
      expectTypeOf(q.data?.pages[0].items).toMatchTypeOf<undefined | Post[]>();

      return q.status === 'loading' ? (
        <p>Loading...</p>
      ) : q.status === 'error' ? (
        <p>Error: {q.error.message}</p>
      ) : (
        <>
          {q.data?.pages.map((group, i) => (
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
              onClick={() => q.fetchNextPage()}
              disabled={!q.hasNextPage || q.isFetchingNextPage}
              data-testid="loadMore"
            >
              {q.isFetchingNextPage
                ? 'Loading more...'
                : q.hasNextPage
                ? 'Load More'
                : 'Nothing more to load'}
            </button>
          </div>
          <div>
            {q.isFetching && !q.isFetchingNextPage ? 'Fetching...' : null}
          </div>
        </>
      );
    }

    const rendered = trpcRender(<MyComponent />);
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
      <div />
    </div>
  `);
  });
});

test('useInfiniteQuery and fetchInfiniteQuery', async () => {
  const { trpc, trpcRender } = factory;

  function MyComponent() {
    const trpcContext = trpc.useContext();
    const paginatedPostsQuery = trpc.useInfiniteQuery(
      [
        'paginatedPosts',
        {
          limit: 1,
        },
      ],
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    );

    expectTypeOf(paginatedPostsQuery.data?.pages[0].items).toMatchTypeOf<
      undefined | Post[]
    >();

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
              trpcContext.fetchInfiniteQuery(['paginatedPosts', { limit: 1 }])
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

  const rendered = trpcRender(<MyComponent />);

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

  // It should correctly fetch both pages
  expect(rendered.container).toHaveTextContent('first post');
  expect(rendered.container).toHaveTextContent('second post');
});

describe('Query Invalidation', () => {
  test('invalidateQueries()', async () => {
    const { trpc, resolvers, trpcRender } = factory;
    function MyComponent() {
      const queryClient = useQueryClient();

      const allPostsQuery = trpc.useQuery(['allPosts'], {
        staleTime: Infinity,
      });
      const postByIdQuery = trpc.useQuery(['postById', '1'], {
        staleTime: Infinity,
      });

      return (
        <>
          <pre>
            allPostsQuery:{allPostsQuery.status} allPostsQuery:
            {allPostsQuery.isStale ? 'stale' : 'not-stale'}{' '}
          </pre>
          <pre>
            postByIdQuery:{postByIdQuery.status} postByIdQuery:
            {postByIdQuery.isStale ? 'stale' : 'not-stale'}
          </pre>
          <button
            data-testid="refetch"
            onClick={() => {
              queryClient.invalidateQueries(['allPosts']);
              queryClient.invalidateQueries(['postById']);
            }}
          />
        </>
      );
    }

    const rendered = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:success');
      expect(rendered.container).toHaveTextContent('allPostsQuery:success');

      expect(rendered.container).toHaveTextContent('postByIdQuery:not-stale');
      expect(rendered.container).toHaveTextContent('allPostsQuery:not-stale');
    });

    expect(resolvers.allPosts).toHaveBeenCalledTimes(1);
    expect(resolvers.postById).toHaveBeenCalledTimes(1);

    rendered.getByTestId('refetch').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:stale');
      expect(rendered.container).toHaveTextContent('allPostsQuery:stale');
    });
    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:not-stale');
      expect(rendered.container).toHaveTextContent('allPostsQuery:not-stale');
    });

    expect(resolvers.allPosts).toHaveBeenCalledTimes(2);
    expect(resolvers.postById).toHaveBeenCalledTimes(2);
  });

  test('invalidateQuery()', async () => {
    const { trpc, resolvers, trpcRender } = factory;
    function MyComponent() {
      const allPostsQuery = trpc.useQuery(['allPosts'], {
        staleTime: Infinity,
      });
      const postByIdQuery = trpc.useQuery(['postById', '1'], {
        staleTime: Infinity,
      });
      const utils = trpc.useContext();
      return (
        <>
          <pre>
            allPostsQuery:{allPostsQuery.status} allPostsQuery:
            {allPostsQuery.isStale ? 'stale' : 'not-stale'}{' '}
          </pre>
          <pre>
            postByIdQuery:{postByIdQuery.status} postByIdQuery:
            {postByIdQuery.isStale ? 'stale' : 'not-stale'}
          </pre>
          <button
            data-testid="refetch"
            onClick={() => {
              utils.invalidateQueries(['allPosts']);
              utils.invalidateQueries(['postById', '1']);
            }}
          />
        </>
      );
    }

    const rendered = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:success');
      expect(rendered.container).toHaveTextContent('allPostsQuery:success');

      expect(rendered.container).toHaveTextContent('postByIdQuery:not-stale');
      expect(rendered.container).toHaveTextContent('allPostsQuery:not-stale');
    });

    expect(resolvers.allPosts).toHaveBeenCalledTimes(1);
    expect(resolvers.postById).toHaveBeenCalledTimes(1);

    rendered.getByTestId('refetch').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:stale');
      expect(rendered.container).toHaveTextContent('allPostsQuery:stale');
    });
    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:not-stale');
      expect(rendered.container).toHaveTextContent('allPostsQuery:not-stale');
    });

    expect(resolvers.allPosts).toHaveBeenCalledTimes(2);
    expect(resolvers.postById).toHaveBeenCalledTimes(2);
  });

  test('invalidateQueries()', async () => {
    const { trpc, resolvers, trpcRender } = factory;
    function MyComponent() {
      const allPostsQuery = trpc.useQuery(['allPosts'], {
        staleTime: Infinity,
      });
      const postByIdQuery = trpc.useQuery(['postById', '1'], {
        staleTime: Infinity,
      });

      const utils = trpc.useContext();

      return (
        <>
          <pre>
            allPostsQuery:{allPostsQuery.status} allPostsQuery:
            {allPostsQuery.isStale ? 'stale' : 'not-stale'}{' '}
          </pre>
          <pre>
            postByIdQuery:{postByIdQuery.status} postByIdQuery:
            {postByIdQuery.isStale ? 'stale' : 'not-stale'}
          </pre>
          <button
            data-testid="refetch"
            onClick={() => {
              utils.invalidateQueries(['allPosts']);
              utils.invalidateQueries(['postById', '1']);
            }}
          />
        </>
      );
    }

    const rendered = trpcRender(<MyComponent />);

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:success');
      expect(rendered.container).toHaveTextContent('allPostsQuery:success');

      expect(rendered.container).toHaveTextContent('postByIdQuery:not-stale');
      expect(rendered.container).toHaveTextContent('allPostsQuery:not-stale');
    });

    expect(resolvers.allPosts).toHaveBeenCalledTimes(1);
    expect(resolvers.postById).toHaveBeenCalledTimes(1);

    rendered.getByTestId('refetch').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:stale');
      expect(rendered.container).toHaveTextContent('allPostsQuery:stale');
    });
    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('postByIdQuery:not-stale');
      expect(rendered.container).toHaveTextContent('allPostsQuery:not-stale');
    });

    expect(resolvers.allPosts).toHaveBeenCalledTimes(2);
    expect(resolvers.postById).toHaveBeenCalledTimes(2);
  });

  test('invalidateQueries() with different args', async () => {
    // ref  https://github.com/trpc/trpc/issues/1383
    const { trpc, resolvers, trpcRender } = factory;

    function MyComponent() {
      const postByIdQuery = trpc.useQuery(['postById', '1'], {
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
              utils.invalidateQueries('postById');
            }}
          />
          <button
            data-testid="invalidate-2-tuple"
            onClick={() => {
              utils.invalidateQueries(['postById']);
            }}
          />
          <button
            data-testid="invalidate-3-exact"
            onClick={() => {
              utils.invalidateQueries(['postById', '1']);
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

                  return path === 'postById' && input === '1';
                },
              });
            }}
          />
        </>
      );
    }

    const utils = trpcRender(<MyComponent />);

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
    expect(resolvers.postById).toHaveBeenCalledTimes(6);
  });
});

// TODO: better place, double check
test('formatError() react types test', async () => {
  const { trpc, trpcRender } = factory;

  function MyComponent() {
    const mutation = trpc.useMutation('addPost');

    useEffect(() => {
      mutation.mutate({ title: 123 as any });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (mutation.error && mutation.error && mutation.error.shape) {
      expectTypeOf(mutation.error.shape).toMatchTypeOf<
        DefaultErrorShape & {
          $test: string;
        }
      >();
      expectTypeOf(mutation.error.shape).toMatchTypeOf<
        DefaultErrorShape & {
          $test: string;
        }
      >();

      return (
        <pre data-testid="err">
          {JSON.stringify(mutation.error.shape.zodError, null, 2)}
        </pre>
      );
    }
    return <></>;
  }

  const rendered = trpcRender(<MyComponent />);

  await waitFor(() => {
    expect(rendered.container).toHaveTextContent('fieldErrors');
    expect(rendered.getByTestId('err').innerText).toMatchInlineSnapshot(
      `undefined`,
    );
  });
});

describe('setQueryData()', () => {
  test('without & without callback', async () => {
    const { trpc, trpcRender } = factory;

    function MyComponent() {
      const utils = trpc.useContext();
      const allPostsQuery = trpc.useQuery(['allPosts'], {
        enabled: false,
      });
      const postByIdQuery = trpc.useQuery(['postById', '1'], {
        enabled: false,
      });
      return (
        <>
          <pre>{JSON.stringify(allPostsQuery.data ?? null, null, 4)}</pre>
          <pre>{JSON.stringify(postByIdQuery.data ?? null, null, 4)}</pre>
          <button
            data-testid="setQueryData"
            onClick={async () => {
              utils.setQueryData(
                ['allPosts'],
                [
                  {
                    id: 'id',
                    title: 'allPost.title',
                    createdAt: Date.now(),
                  },
                ],
              );
              const newPost = {
                id: 'id',
                title: 'postById.tmp.title',
                createdAt: Date.now(),
              };
              utils.setQueryData(['postById', '1'], (data) => {
                expect(data).toBe(undefined);
                return newPost;
              });
              // now it should be set
              utils.setQueryData(['postById', '1'], (data) => {
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

    const rendered = trpcRender(<MyComponent />);

    rendered.getByTestId('setQueryData').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('allPost.title');
      expect(rendered.container).toHaveTextContent('postById.title');
    });
  });
});

describe('setInfiniteQueryData()', () => {
  test('with & without callback', async () => {
    const { trpc, trpcRender } = factory;

    function MyComponent() {
      const utils = trpc.useContext();
      const allPostsQuery = trpc.useInfiniteQuery(['paginatedPosts', {}], {
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
              utils.setInfiniteQueryData(['paginatedPosts', {}], {
                pages: [
                  {
                    items: [
                      {
                        id: 'id',
                        title: 'infinitePosts.title1',
                        createdAt: Date.now(),
                      },
                    ],
                    nextCursor: null,
                  },
                ],
                pageParams: [],
              });

              const newPost = {
                id: 'id',
                title: 'infinitePosts.title2',
                createdAt: Date.now(),
              };

              // Add a new post to the first page (with callback)
              utils.setInfiniteQueryData(['paginatedPosts', {}], (data) => {
                expect(data).not.toBe(undefined);

                if (!data) {
                  return {
                    pages: [],
                    pageParams: [],
                  };
                }

                return {
                  ...data,
                  pages: data.pages.map((page) => {
                    return {
                      ...page,
                      items: [...page.items, newPost],
                    };
                  }),
                };
              });
            }}
          />
        </>
      );
    }

    const rendered = trpcRender(<MyComponent />);

    rendered.getByTestId('setInfiniteQueryData').click();

    await waitFor(() => {
      expect(rendered.container).toHaveTextContent('infinitePosts.title1');
      expect(rendered.container).toHaveTextContent('infinitePosts.title2');
    });
  });
});
