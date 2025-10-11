/** A store which contains memoized instances. */
export class Store<TServices extends object>
  implements Disposable, AsyncDisposable {
  readonly #memoizedValues: {
    [P in keyof TServices]?: {
      promisify?: true;
      value: TServices[P];
    };
  } = {};
  readonly #factories: {
    [K in keyof TServices]: (store: Store<TServices>) => TServices[K];
  };
  readonly #overrides: {
    [K in keyof TServices]?: (store: Store<TServices>) => TServices[K];
  };
  readonly #parent?: Store<object>;

  /** @ignore */
  constructor(
    factories: {
      [K in keyof TServices]: (store: Store<TServices>) => TServices[K];
    },
    parent: Store<object> | undefined,
    overrides: {
      [K in keyof TServices]?: (store: Store<TServices>) => TServices[K];
    },
  ) {
    this.#factories = factories;
    this.#parent = parent;
    this.#overrides = overrides;
  }

  /**
   * Synchronously disposes all disposable services in the store.
   *
   * @remarks This will error if any async disposable services are
   * in the store (unless they're also disposable).
   */
  [Symbol.dispose]() {
    for (const { value } of (Object.values(this.#memoizedValues) as any[])) {
      if (value[Symbol.dispose] instanceof Function) {
        value[Symbol.dispose]();
      } else if (value[Symbol.asyncDispose] instanceof Function) {
        throw new Error(
          "Cannot dispose a container containing async disposables. Use `await using` instead of `using`.",
        );
      }
    }
  }

  /**
   * Asynchronously disposes all disposable and async disposable services
   * in the store.
   */
  async [Symbol.asyncDispose]() {
    const pendingPromises = [];
    for (const { value } of (Object.values(this.#memoizedValues) as any[])) {
      // prefer async
      if (value[Symbol.asyncDispose] instanceof Function) {
        pendingPromises.push(value[Symbol.asyncDispose]());
      } else if (value[Symbol.dispose] instanceof Function) {
        value[Symbol.dispose]();
      }
    }
    await Promise.all(pendingPromises);
  }

  /** Gets if the store has a service with the provided name. */
  has<TName extends keyof TServices>(name: TName): boolean {
    return name in this.#overrides || 
      name in this.#factories ||
      (this.#parent?.has(name as any as never) ?? false);
  }

  /**
   * Gets a service at the provided key.
   *
   * @remarks Throws if the service is not in the store.
   */
  get<TName extends keyof TServices>(
    name: TName,
  ): TServices[TName] {
    // Check for override first - highest priority    
    const overrideFactory = this.#overrides[name];
    if (overrideFactory != null) {
      const value = overrideFactory(this);
      return value as any;
    }

    // Check memorized values next - but only if there's no override
    if (name in this.#memoizedValues) {
      const entry = this.#memoizedValues[name]!;
      if (entry.promisify) {
        return Promise.resolve(entry.value) as any;
      } else {
        return entry.value;
      }
    } else {
      const factory = this.#factories[name];
      if (factory == null) {
        if (this.#parent?.has(name as any as never)) {
          return this.#parent.get(name as any as never);
        } else {
          throw new Error(`Store did not contain key: ${name as any}`);
        }
      }
      const value = factory(this);
      if ((factory as any).transient) {
        return value as any;
      }
      if (value instanceof Promise) {
        value.then((value) => {
          this.#memoizedValues[name] = {
            promisify: true,
            value,
          };
        }).catch((_err) => {
          // remove the promise on error
          delete this.#memoizedValues[name];
        });
      }
      this.#memoizedValues[name] = {
        value: value as any,
      };
      return value as any;
    }
  }

  /**
   * Creates a child store definition from the current store.
   *
   * This is useful for sharing instances in the current store
   * with a child store definition which can then have multiple
   * stores created from it.
   *
   * For example, say you're creating an http server. It can be
   * useful to have certain services alive for the duration of
   * the application and only certain services alive per request.
   * To achieve this, an application store can be made and from
   * that a child "request store definition" with its request-only
   * services. When a request comes in, a store can be created
   * specifically for that request.
   */
  createChild(): StoreDefinition<TServices> {
    return new StoreDefinition({} as any, this as any, {});
  }
}

/** A definition of factory functions which can be used to create a store. */
export class StoreDefinition<TServices extends object> {
  readonly #factories: {
    [K in keyof TServices]: (store: Store<TServices>) => TServices[K];
  };
  readonly #overrides: {
    [K in keyof TServices]?: (store: Store<TServices>) => TServices[K];
  };
  readonly #parentStore: Store<object> | undefined;

  /** @ignore */
  constructor(
    factories: {
      [K in keyof TServices]: (store: Store<TServices>) => TServices[K];
    },
    parentStore: Store<object> | undefined,
    overrides: {
      [K in keyof TServices]?: (store: Store<TServices>) => TServices[K];
    },
  ) {
    if (arguments.length !== 3) {
      throw new Error("Use the `defineStore` export instead.");
    }
    this.#factories = factories;
    this.#parentStore = parentStore;
    this.#overrides = overrides;
  }

  /** Adds a service factory to the store definition at the provided key. */
  add<TName extends string, TType>(
    name: TName,
    value: (services: Store<TServices>) => TType,
  ): StoreDefinition<TServices & { [P in TName]: TType }> {
    if (name in this.#factories || this.#parentStore?.has(name as never)) {
      throw new Error(`Service already defined: ${name}`);
    }
    return new StoreDefinition({
      ...this.#factories,
      [name]: value,
    } as any, this.#parentStore, this.#overrides) as any;
  }

  /**
   * Adds a transient service to the store. These services will
   * be created each time they're requested instead of being
   * memoized.
   */
  addTransient<TName extends string, TType>(
    name: TName,
    value: (services: Store<TServices>) => TType,
  ): StoreDefinition<TServices & { [P in TName]: TType }> {
    (value as any).transient = true;
    return this.add(name, value);
  }

  /**
   * Overrides an existing service factory in the store definition.
   * This is useful for testing where you want to replace a service
   * with a mock or test implementation.
   */
  override<TName extends keyof TServices>(
    name: TName,
    value: (services: Store<TServices>) => TServices[TName],
  ): StoreDefinition<TServices> {
    return new StoreDefinition(
      this.#factories,
      this.#parentStore,
      {
        ...this.#overrides,
        [name]: value,
      }
    ) as any;
  }

  /** Create the store. */
  finalize(): Store<TServices> {
    return new Store(this.#factories, this.#parentStore, this.#overrides);
  }
}

/**
 * Start for defining a store definition and eventually
 * creating a store.
 *
 * ```ts
 * const storeDef = defineStore()
 *   .add("db", () => createDb())
 *   .add("userService", (store) => new UserService(store.get("db")));
 * const store = storeDef.finalize();
 * const userService = store.get("userService");
 * ```
 */
export function defineStore(): StoreDefinition<object> {
  return new StoreDefinition({}, undefined, {});
}