import { PgPubSub, PgPubSubOptions } from "@imqueue/pg-pubsub";

export type PromiseOrValue<T> = T | Promise<T>;

export type DeepPartial<T> = T extends Function
  ? T
  : T extends Array<infer U>
  ? DeepPartialArray<U>
  : T extends object
  ? DeepPartialObject<T>
  : T | undefined;
interface DeepPartialArray<T> extends Array<PromiseOrValue<DeepPartial<PromiseOrValue<T>>>> {}
type DeepPartialObject<T> = {
  [P in keyof T]?: PromiseOrValue<DeepPartial<PromiseOrValue<T[P]>>>;
};

interface PubSubDeferredPromise<T> {
  promise: Promise<void>;
  resolve: () => void;
  isDone: boolean;
  values: Array<T>;
}

function pubsubDeferredPromise<T = void>(): PubSubDeferredPromise<T> {
  let resolve!: () => void;
  const promise = new Promise<void>((resolveFn) => {
    resolve = resolveFn;
  });

  return {
    promise,
    resolve,
    values: [],
    isDone: false,
  };
}

export interface Channels {}

const validateChannelLength = (channel: string) => {
  if (channel.length > 63) {
    throw Error(
      `Channel ${JSON.stringify(channel)} exceeded maximum default PostgreSQL identifier length`
    );
  }
};

export interface PubSubOptions extends Partial<PgPubSubOptions> {
  /**
   * Prefix to be added before every channel
   */
  prefix?: string;

  /**
   * Add Database Schema as prefix in every channel.
   *
   * By default it reuses the "schema" query paramemter in the `connectionString`.
   *
   * Set as `false` to not re-use "schema" of `connectionstring`
   */
  databaseSchema?: string | false;

  /**
   * Boolean flag, which turns off/on single listener mode. By default is
   * set to false, so instantiated PgPubSub connections won't act using
   * inter-process locking mechanism.
   *
   * @default false
   */
  singleListener?: boolean;
}

export declare type PubSub = {
  subscribe<TChannel extends keyof Channels>(
    ...channels: [TChannel, ...TChannel[]]
  ): AsyncGenerator<Channels[TChannel]>;
  publish<TChannel extends keyof Channels>(
    channel: TChannel,
    data: Required<DeepPartial<Channels[TChannel]>>
  ): Promise<void>;
  close: () => Promise<void>;
  pgPubSub: PgPubSub;
  withFilter: typeof withFilter;
};

export const CreatePubSub = (options: PubSubOptions): PubSub => {
  const {
    connectionString,
    prefix,
    databaseSchema,
    singleListener = false,
    ...restOptions
  } = options;

  const databaseSchemaName =
    databaseSchema ||
    (databaseSchema !== false && connectionString
      ? new URL(connectionString).searchParams.get("schema")
      : null);
  const channelPrefix =
    (prefix ? prefix + "_" : "") + (databaseSchemaName ? databaseSchemaName + "_" : "");

  const pgPubSub = new PgPubSub({
    connectionString,
    singleListener,
    ...restOptions,
  });

  function resolveConnect(resolve: (value: void | PromiseLike<void>) => void) {
    pgPubSub.connect().then(resolve, (err) => {
      console.error(err);
      setTimeout(() => {
        connectPubSub(resolve);
      }, 3000);
    });
  }

  function connectPubSub(): Promise<void>;
  function connectPubSub(resolveFn: (value: void | PromiseLike<void>) => void): void;
  function connectPubSub(resolveFn?: (value: void | PromiseLike<void>) => void) {
    if (resolveFn) return resolveConnect(resolveFn);

    return new Promise<void>((resolve) => resolveConnect(resolve));
  }

  let pubSubPromise: Promise<void> | false = new Promise<void>((resolve) => {
    connectPubSub().then(() => {
      pubSubPromise = false;
      resolve();
    });
  });

  const unsubscribes = new Set<() => void>();

  async function* subscribe<TChannel extends keyof Channels>(
    ...channelsArg: [TChannel, ...TChannel[]]
  ): AsyncGenerator<Channels[TChannel]> {
    if (pubSubPromise) await pubSubPromise;

    if (!channelsArg.length) throw Error("No channels specified!");

    const channels = await Promise.all(
      channelsArg.map(async (channelValue) => {
        const channel = `${channelPrefix}${channelValue}`;
        validateChannelLength(channel);
        await pgPubSub.listen(channel);

        return channel;
      })
    );

    let valuePromise: PubSubDeferredPromise<Channels[TChannel]> | null =
      pubsubDeferredPromise<Channels[TChannel]>();

    let listeners: [string, (payload: unknown) => void][] = [];
    for (const channel of channels) {
      const listener = (payload: any) => {
        if (valuePromise == null) return;

        valuePromise.values.push(payload);
        valuePromise.resolve();
      };
      listeners.push([channel, listener]);
      pgPubSub.channels.on(channel, listener);
    }

    function unsubscribe() {
      for (const [channel, listener] of listeners) {
        pgPubSub.channels.removeListener(channel, listener);
      }
      for (const channel of channels) {
        if (pgPubSub.channels.listenerCount(channel) === 0) {
          pgPubSub.unlisten(channel).catch(console.error);
        }
      }

      if (valuePromise) {
        valuePromise.resolve();
        valuePromise.isDone = true;

        valuePromise = null;
      }

      unsubscribes.delete(unsubscribe);
    }

    unsubscribes.add(unsubscribe);

    while (valuePromise) {
      await valuePromise.promise;

      for (const value of valuePromise.values) yield value;

      if (valuePromise.isDone) {
        valuePromise = null;
      } else {
        valuePromise = pubsubDeferredPromise();
      }
    }

    unsubscribe();
  }

  async function publish<TChannel extends keyof Channels>(
    channel: TChannel,
    data: Required<DeepPartial<Channels[TChannel]>>
  ) {
    const channelIdentifier = channelPrefix + channel;
    validateChannelLength(channelIdentifier);
    return pgPubSub
      .notify(
        channelIdentifier,
        //@ts-expect-error
        data
      )
      .catch(console.error);
  }

  return {
    subscribe,
    publish,
    close: async () => {
      unsubscribes.forEach((unsub) => unsub());
      await Promise.allSettled([pgPubSub.close(), pgPubSub.unlistenAll()]);
    },
    pgPubSub,
    withFilter,
  };
};

export function withFilter<TData, TFilteredData extends TData>(
  iterator: PromiseOrValue<AsyncGenerator<TData>>,
  filter: (data: TData) => data is TFilteredData
): AsyncGenerator<TFilteredData>;
export function withFilter<TData>(
  iterator: PromiseOrValue<AsyncGenerator<TData>>,
  filter: (data: TData) => boolean
): AsyncGenerator<TData>;
export async function* withFilter<TData>(
  iterator: PromiseOrValue<AsyncGenerator<TData>>,
  filter: (data: TData) => boolean
) {
  for await (const value of await iterator) {
    if (filter(value)) yield value;
  }
}
