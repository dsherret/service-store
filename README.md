# `@david/service-store`

[![JSR](https://jsr.io/badges/@david/service-store)](https://jsr.io/@david/service-store)

Lightweight dependency injection.

Goals:

1. No magic, static analysis, `reflect-metadata`, build step, or decorators.
1. Child stores.
1. Type checking.

Services are created lazily and memoized.

## Example

```ts
import { defineStore } from "@david/service-store";

const store = defineStore()
  .add("db", () => {
    return new Database();
  })
  .add("imageCache", (store) => {
    return new ImageCache(store.get("db"));
  })
  .add("userService", (store) => {
    return new UserService(
      store.get("imageCache"),
      store.get("db"),
    );
  })
  .finalize();

const userService = store.get("userService");
// use userService here...
```

## Child Stores Example

```ts
import { defineStore } from "@david/service-store";

// services here will be shared amongst the requests
const singletonStore = defineStore()
  .add("dbPool", () => {
    return new DatabasePool();
  })
  .add("imageCache", () => {
    return new ImageCache();
  })
  .finalize();

// now create a child definition off the singleton
// store that will be used per request
const requestScopedDef = singletonStore
  .createChild()
  .add("db", async (store) => {
    // grab an instance from the pool to be used for
    // the duration of the request
    const pool = store.get("dbPool");
    return await pool.getItem();
  })
  .add("userService", async (store) => {
    return new UserService(
      await store.get("db"),
      store.get("imageCache"),
    );
  });

Deno.serve(async (req) => {
  // create the request specific store from the definition
  // and optionally use `await using` or `using` in order
  // to dispose any services in the store when the request
  // finishes
  await using store = requestScopedDef.finalize();
  // do whatever to handle the request using the store here
  return handleRequest(store, req);
});
```

## Overriding Services for Testing Example

```ts
import { defineStore } from "@david/service-store";

// in the app, define the store that is used when the app runs. 
const appStore = defineStore()
  .add("db", async (store) => {    
    const pool = store.get("dbPool");
    return await pool.getItem();
  })
  .add("userService", async (store) => {
    return new UserService(
      await store.get("db"),
      store.get("imageCache"),
    );
  });

// in tests, reference the app store and override dependencies you want 
// replaced with mocks, stubs, or fakes.
Deno.test("user service test", async () => {
  const store = appStore
    // override the db service with a mock
    .override("db", () => {
      return new MockDatabase();
    })
    .finalize();

  // get instance of user service without overriding it. It will use the mock db. 
  const userService = store.get("userService");
  const user = await userService.getUser(1);
  assertEquals(user.id, 1);
  assertEquals(user.name, "Test User");
});
```
