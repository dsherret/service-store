import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { defineStore, type Store, StoreDefinition } from "./mod.ts";

Deno.test("StoreBuilder ctor", () => {
  assertThrows(
    () => new (StoreDefinition as any)(),
    Error,
    "Use the `defineStore` export instead.",
  );
});

Deno.test("adding", () => {
  let aCreatedTimes = 0;
  const store = defineStore()
    .add("A", () => {
      aCreatedTimes++;
      return { value: 5 };
    })
    .add("B", (store) => {
      return { a: store.get("A") };
    })
    .finalize();
  assertEquals(aCreatedTimes, 0);
  const a1 = store.get("A");
  assertEquals(aCreatedTimes, 1);
  const a2 = store.get("A");
  assertEquals(aCreatedTimes, 1);
  a1.value = 123;
  assertEquals(a2.value, 123);
  const b = store.get("B");
  assertEquals(b.a.value, 123);
  assertEquals(aCreatedTimes, 1);

  // @ts-expect-error ensure accessing an unknown property errors
  b.a.value2;
});

Deno.test("key not in store", () => {
  const store = defineStore().finalize();
  assertThrows(
    // @ts-expect-error "something" is not in the store
    () => store.get("something"),
    Error,
    "Store did not contain key: something",
  );
});

Deno.test("service defined multiple times", () => {
  assertThrows(
    () => defineStore().add("a", () => {}).add("a", () => {}),
    Error,
    "Service already defined: a",
  );
  assertThrows(
    () =>
      defineStore()
        .add("a", () => {})
        .finalize()
        .createChild()
        .add("a", () => {}),
    Error,
    "Service already defined: a",
  );
});

Deno.test("async", async () => {
  const store = defineStore()
    .add("A", () => {
      return Promise.resolve({ value: 5 });
    })
    .finalize();

  await assertPromise();
  await assertPromise();

  async function assertPromise() {
    const promise = store.get("A");
    assert(promise instanceof Promise);
    const value = await promise;
    assertEquals(value.value, 5);
  }
});

Deno.test("dispose", () => {
  let disposeCount = 0;
  {
    const disposableFactory = () => {
      return {
        [Symbol.dispose]() {
          disposeCount++;
        },
      };
    };
    using store = defineStore()
      .add("A", disposableFactory)
      .add("B", disposableFactory)
      .finalize();
    store.get("A"); // only create A
  }
  assertEquals(disposeCount, 1);
});

Deno.test("async dispose", async () => {
  let disposeCount = 0;
  const disposableFactory = () => {
    return {
      [Symbol.dispose]() {
        disposeCount++;
      },
    };
  };
  let asyncDisposeCount = 0;
  const asyncDisposableFactory = () => {
    return {
      [Symbol.asyncDispose]() {
        asyncDisposeCount++;
        return Promise.resolve();
      },
    };
  };
  {
    await using store = defineStore()
      .add("A", asyncDisposableFactory)
      .add("B", asyncDisposableFactory) // don't create
      .add("C", disposableFactory)
      .add("D", () => {
        // will prefer async
        return {
          ...disposableFactory(),
          ...asyncDisposableFactory(),
        };
      })
      .finalize();
    store.get("A");
    store.get("C");
    store.get("D");
  }
  assertEquals(asyncDisposeCount, 2);
  assertEquals(disposeCount, 1);
});

Deno.test("async dispose used in using", () => {
  assertThrows(
    () => {
      using store = defineStore()
        .add("A", () => {
          return {
            [Symbol.asyncDispose]() {
              return Promise.resolve();
            },
          };
        })
        .finalize();
      store.get("A");
    },
    Error,
    "Cannot dispose a container containing async disposables. Use `await using` instead of `using`.",
  );
});

Deno.test("transient", () => {
  let aCreatedTimes = 0;
  const store = defineStore()
    .addTransient("A", () => {
      aCreatedTimes++;
      return { value: 5 };
    })
    .add("B", (store) => {
      return store.get("A");
    })
    .finalize();
  assertEquals(aCreatedTimes, 0);
  const a1 = store.get("A");
  const a2 = store.get("A");
  assertEquals(aCreatedTimes, 2);
  a1.value = 123;
  assertEquals(a2.value, 5);
  const b1 = store.get("B");
  const b2 = store.get("B");
  b1.value = 123;
  assertEquals(b2.value, 123);
  assertEquals(aCreatedTimes, 3);
});

Deno.test("branching", () => {
  let aCreatedTimes = 0;
  let bCreatedTimes = 0;
  let cCreatedTimes = 0;
  const storeA = defineStore()
    .add("A", () => {
      aCreatedTimes++;
      return { value: 5 };
    })
    .finalize();

  const childB = storeA.createChild()
    .add("B", (store) => {
      assertEquals(store.get("A").value, 5);
      bCreatedTimes++;
      return 1;
    });
  const childC = storeA.createChild()
    .add("C", () => {
      cCreatedTimes++;
      return 2;
    });

  const storeB1 = childB.finalize();
  const storeB2 = childB.finalize();
  const storeC = childC.finalize();

  assertEquals(storeA.get("A").value, 5);
  assertEquals(storeB1.get("B"), 1);
  assertEquals(storeB2.get("B"), 1);
  assertEquals(storeC.get("C"), 2);

  assertEquals(aCreatedTimes, 1);
  assertEquals(bCreatedTimes, 2);
  assertEquals(cCreatedTimes, 1);
});

Deno.test("error", async () => {
  let i = 0;
  const store = defineStore()
    .add("a", async () => {
      i++;
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (i === 1) {
        throw new Error("Error");
      }
      return 1;
    })
    .finalize();

  const errorPromise1 = store.get("a");
  const errorPromise2 = store.get("a");

  await assertRejects(() => errorPromise1);
  await assertRejects(() => errorPromise2);

  // will succeed after failing
  assertEquals(await store.get("a"), 1);
});

Deno.test("store can be typed easily", () => {
  interface Services {
    a: { value: 1 };
    b: { value: 2 };
  }

  function getDefinition(): StoreDefinition<Services> {
    return defineStore()
      .add("a", () => ({ value: 1 } as const))
      .add("b", () => ({ value: 2 } as const));
  }

  function getStore(): Store<Services> {
    return getDefinition().finalize();
  }

  const store = getStore();
  assertEquals(store.get("a").value, 1);
  assertEquals(store.get("b").value, 2);
});

Deno.test("override service - given original store and a store copy, expect original to be unmodified", () => {
  let originalCreatedTimes = 0;
  let overrideCreatedTimes = 0;
  
  const originalStoreDef = defineStore()
    .add("A", () => {
      originalCreatedTimes++;
      return { value: "original", type: "original" };
    })
    .add("B", (store) => {
      return { a: store.get("A") };
    });

  const overriddenStoreDef = originalStoreDef
    .override("A", () => {
      overrideCreatedTimes++;
      return { value: "overridden", type: "mock" };
    });

  const originalStore = originalStoreDef.finalize();
  const overriddenStore = overriddenStoreDef.finalize();

  // Original store should use original implementation
  const originalA = originalStore.get("A");
  assertEquals(originalA.value, "original");
  assertEquals(originalA.type, "original");
  assertEquals(originalCreatedTimes, 1);
  assertEquals(overrideCreatedTimes, 0);

  // Overridden store should use overridden implementation
  const overriddenA = overriddenStore.get("A");
  assertEquals(overriddenA.value, "overridden");
  assertEquals(overriddenA.type, "mock");
  assertEquals(originalCreatedTimes, 1);
  assertEquals(overrideCreatedTimes, 1);

  // B service should use the overridden A
  const overriddenB = overriddenStore.get("B");
  assertEquals(overriddenB.a.value, "overridden");
  assertEquals(overriddenB.a.type, "mock");
});

Deno.test("override service in child store", () => {
  const parentStore = defineStore()
    .add("shared", () => ({ value: "parent" }))
    .finalize();

  const childDef = parentStore.createChild()
    .add("child", (store) => {
      return { shared: store.get("shared") };
    });

  const overriddenChildDef = childDef
    .override("shared", () => ({ value: "overridden" }));

  const normalChildStore = childDef.finalize();
  const overriddenChildStore = overriddenChildDef.finalize();

  // Normal child should use parent's shared service
  assertEquals(normalChildStore.get("shared").value, "parent");
  assertEquals(normalChildStore.get("child").shared.value, "parent");

  // Overridden child should use overridden shared service
  assertEquals(overriddenChildStore.get("shared").value, "overridden");
  assertEquals(overriddenChildStore.get("child").shared.value, "overridden");
});

Deno.test("override with async service", async () => {
  const storeDef = defineStore()
    .add("async", async () => {
      await new Promise(resolve => setTimeout(resolve, 1));
      return { value: "original" };
    });

  const overriddenStoreDef = storeDef
    .override("async", async () => {
      return Promise.resolve({ value: "mocked" });
    });

  const store = overriddenStoreDef.finalize();
  const result = await store.get("async");
  assertEquals(result.value, "mocked");
});

Deno.test("override should take precedence over memorized values", async () => {
  let syncOriginalCallCount = 0;
  let syncOverrideCallCount = 0;
  let asyncOriginalCallCount = 0;
  let asyncOverrideCallCount = 0;

  const storeDef = defineStore()
    .add("syncService", () => {
      syncOriginalCallCount++;
      return { value: "original", callCount: syncOriginalCallCount };
    })
    .add("asyncService", async () => {
      asyncOriginalCallCount++;
      await new Promise(resolve => setTimeout(resolve, 1));
      return { value: "original", callCount: asyncOriginalCallCount };
    });

  const store = storeDef.finalize();

  // Test sync service memorization
  const firstSyncCall = store.get("syncService");
  assertEquals(firstSyncCall.value, "original");
  assertEquals(firstSyncCall.callCount, 1);
  assertEquals(syncOriginalCallCount, 1);

  // Get it again to confirm memorization is working
  const secondSyncCall = store.get("syncService");
  assertEquals(secondSyncCall.value, "original");
  assertEquals(secondSyncCall.callCount, 1); // Same object reference
  assertEquals(syncOriginalCallCount, 1); // Factory not called again

  // Test async service memorization
  const firstAsyncCall = await store.get("asyncService");
  assertEquals(firstAsyncCall.value, "original");
  assertEquals(firstAsyncCall.callCount, 1);
  assertEquals(asyncOriginalCallCount, 1);

  // Get it again to confirm memorization is working
  const secondAsyncCall = await store.get("asyncService");
  assertEquals(secondAsyncCall.value, "original");
  assertEquals(secondAsyncCall.callCount, 1); // Same object reference
  assertEquals(asyncOriginalCallCount, 1); // Factory not called again

  // Now override both services - these should take precedence over memorized values
  const overriddenStoreDef = storeDef
    .override("syncService", () => {
      syncOverrideCallCount++;
      return { value: "overridden", callCount: syncOverrideCallCount };
    })
    .override("asyncService", async () => {
      asyncOverrideCallCount++;
      await new Promise(resolve => setTimeout(resolve, 1));
      return { value: "overridden", callCount: asyncOverrideCallCount };
    });

  const overriddenStore = overriddenStoreDef.finalize();

  // The overridden store should return the overridden values, not the memorized originals
  const overriddenSyncResult = overriddenStore.get("syncService");
  assertEquals(overriddenSyncResult.value, "overridden");
  assertEquals(overriddenSyncResult.callCount, 1);
  assertEquals(syncOverrideCallCount, 1);
  assertEquals(syncOriginalCallCount, 1); // Original factory should not be called again

  const overriddenAsyncResult = await overriddenStore.get("asyncService");
  assertEquals(overriddenAsyncResult.value, "overridden");
  assertEquals(overriddenAsyncResult.callCount, 1);
  assertEquals(asyncOverrideCallCount, 1);
  assertEquals(asyncOriginalCallCount, 1); // Original factory should not be called again
});

Deno.test("override should work with child stores and memorized values", () => {
  let parentCallCount = 0;
  let overrideCallCount = 0;

  const parentStore = defineStore()
    .add("parentService", () => {
      parentCallCount++;
      return { value: "parent", callCount: parentCallCount };
    })
    .finalize();

  // Access the parent service to memorize it
  const parentResult = parentStore.get("parentService");
  assertEquals(parentResult.value, "parent");
  assertEquals(parentCallCount, 1);

  // Create child store definition and override the parent service
  const childStoreDef = parentStore.createChild()
    .add("childService", (store) => {
      const parent = store.get("parentService");
      return { parentValue: parent.value, childValue: "child" };
    })
    .override("parentService", () => {
      overrideCallCount++;
      return { value: "overridden", callCount: overrideCallCount };
    });

  const childStore = childStoreDef.finalize();

  // The child store should use the overridden parent service, not the memorized one
  const childParentResult = childStore.get("parentService");
  assertEquals(childParentResult.value, "overridden");
  assertEquals(childParentResult.callCount, 1);
  assertEquals(overrideCallCount, 1);
  assertEquals(parentCallCount, 1); // Parent factory should not be called again

  // The child service should also receive the overridden parent service
  const childServiceResult = childStore.get("childService");
  assertEquals(childServiceResult.parentValue, "overridden");
  assertEquals(childServiceResult.childValue, "child");

  // Verify parent store is unaffected and still returns memorized value
  const parentResultAgain = parentStore.get("parentService");
  assertEquals(parentResultAgain.value, "parent");
  assertEquals(parentCallCount, 1); // Still no additional calls
});

