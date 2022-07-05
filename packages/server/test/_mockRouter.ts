import { trpcServer } from './_packages';
import { OutputWithCursor } from '../../react/src';
import { TRPCError } from '@trpc/server';
import hash from 'hash-sum';
import { z, ZodError } from 'zod';

export type Post = {
  id: string;
  title: string;
  createdAt: number;
};

export type User = {
  id: string;
  name: string;
  isAdmin: boolean;
};

export type Database = {
  posts: Post[];
  users: User[];
};

export type MockContext = {
  user?: User;
};

export function createMockDatabase(): Database {
  return {
    posts: [
      { id: '1', title: 'first post', createdAt: 0 },
      { id: '2', title: 'second post', createdAt: 1 },
    ],
    users: [
      {
        id: '1',
        name: 'KATT',
        isAdmin: true,
      },
    ],
  };
}

export function createRouter<Context = MockContext>() {
  return trpcServer.router<Context>();
}

export function createProtectedRouter() {
  return createRouter().middleware(({ ctx, next }) => {
    if (!ctx.user?.isAdmin) {
      throw new TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next();
  });
}

// interface CreateMockRouterOptions {
//   baseRouter?: AnyRouter;
// }

export function createMockRouter<Context>(/* opts: CreateMockRouterOptions */) {
  const router = createRouter<Context>().formatError(({ shape, error }) => {
    return {
      $test: 'formatted',
      zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      ...shape,
    };
  });
  const resolverMock = jest.fn();

  const mockDatabase = createMockDatabase();

  const root = createRouter<Context>()
    .query('ping', {
      resolve() {
        resolverMock();
        return 'pong';
      },
    })
    .query('hello', {
      input: z.string(),
      resolve({ input }) {
        resolverMock(input);
        return `hello ${input}`;
      },
    })
    .query('withDateInput', {
      input: z.date(),
      resolve({ input }) {
        resolverMock(input);
        return input;
      },
    })
    .query('err', {
      resolve() {
        resolverMock();
        throw new Error('woops');
      },
    })
    .mutation('ping', {
      resolve() {
        resolverMock();
        return 'pong';
      },
    })
    .mutation('err', {
      resolve() {
        resolverMock();
        throw new Error('woops');
      },
    });

  const users = createRouter<Context>().query('byId', {
    input: z.string(),
    resolve({ input }) {
      resolverMock(input);
      return mockDatabase.users?.find((user) => (user.id = input));
    },
  });

  const posts = createRouter<Context>()
    .query('all', {
      resolve() {
        resolverMock();
        return mockDatabase.posts;
      },
    })
    .query('byId', {
      input: z.string(),
      resolve({ input }) {
        resolverMock(input);
        return mockDatabase.posts.find((p) => p.id === input);
      },
    })
    // TODO: refactor
    .query('paginated', {
      input: z.object({
        limit: z.number().min(1).max(100).nullish(),
        cursor: z.number().nullish(),
      }),
      resolve({ input }) {
        resolverMock(input);
        const { cursor } = input;
        const items: Post[] = [];
        const limit = input.limit ?? 50;
        let nextCursor: typeof cursor = null;
        let nextIndex = 1;

        for (let index = 0; index < mockDatabase.posts.length; index++) {
          const post = mockDatabase.posts[index];
          if (cursor != null && post.createdAt < cursor) {
            continue;
          }
          items.push(post);
          if (items.length >= limit) {
            nextIndex = index + 1;
            if (mockDatabase.posts[nextIndex]) {
              nextCursor = mockDatabase.posts[nextIndex].createdAt;
            }
            break;
          }
        }
        return {
          items,
          nextCursor,
        };
      },
    })
    .mutation('add', {
      input: z.object({
        title: z.string(),
      }),
      resolve({ input }) {
        resolverMock(input);
        mockDatabase.posts.push({
          id: `${Math.random()}`,
          createdAt: Date.now(),
          title: input.title,
        });
      },
    })
    .mutation('delete', {
      input: z.array(z.string()).nullish(),
      resolve({ input }) {
        resolverMock(input);
        if (input) {
          mockDatabase.posts = mockDatabase.posts.filter(
            (p) => !input.includes(p.id),
          );
        } else {
          mockDatabase.posts = [];
        }
      },
    })
    .subscription('new', {
      input: z.number(),
      resolve({ input }) {
        resolverMock(input);
        return trpcServer.subscriptionPullFactory<Post>({
          intervalMs: 1,
          pull(emit) {
            mockDatabase.posts
              .filter((p) => p.createdAt > input)
              .forEach(emit.data);
          },
        });
      },
    })
    .subscription('live', {
      input: z.object({
        cursor: z.string().nullable(),
      }),
      resolve({ input }) {
        resolverMock(input);
        const { cursor } = input;

        return trpcServer.subscriptionPullFactory<OutputWithCursor<Post[]>>({
          intervalMs: 10,
          pull(emit) {
            const newCursor = hash(mockDatabase.posts);
            if (newCursor !== cursor) {
              emit.data({ data: mockDatabase.posts, cursor: newCursor });
            }
          },
        });
      },
    });

  const newRouter = router
    .merge(root)
    .merge('user.', users)
    .merge('post.', posts);

  return { router: newRouter, resolverMock, mockDatabase };
}

// function mergeRouter<Router extends AnyRouter>(router: Router) {
//   const router1 = createRouter().middleware(({ next }) => {
//     return next();
//   });
//   const router2 = router1.merge(router);
//   return router2;
// }
//
// const router = createRouter().query('hi', {
//   resolve() {
//     return 'hi';
//   },
// });
