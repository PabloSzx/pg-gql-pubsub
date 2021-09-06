import { createDeferredPromise, DeferredPromise } from "@graphql-ez/utils/promise";
import { PgPubSub, PgPubSubOptions } from "@imqueue/pg-pubsub";

type PromiseOrValue<T> = T | Promise<T>;

type DeepPartial<T> = T extends Function
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
  ): Promise<AsyncGenerator<Channels[TChannel]>>;
  publish<TChannel extends keyof Channels>(
    channel: TChannel,
    data: Required<DeepPartial<Channels[TChannel]>>
  ): Promise<void>;
  close: () => Promise<void>;
  pgPubSub: PgPubSub;
};

export const CreatePubSub = ({
  connectionString,
  prefix,
  databaseSchema,
  singleListener = false,
  ...options
}: PubSubOptions): PubSub => {
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
    ...options,
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

  async function subscribe<TChannel extends keyof Channels>(
    ...channelsArg: [TChannel, ...TChannel[]]
  ): Promise<AsyncGenerator<Channels[TChannel]>> {
    if (pubSubPromise) await pubSubPromise;

    const doneSymbol = Symbol("done");

    if (!channelsArg.length) throw Error("No channels specified!");

    const channels = await Promise.all(
      channelsArg.map((channelValue) => {
        const channel = `${channelPrefix}${channelValue}`;
        validateChannelLength(channel);
        return pgPubSub.listen(channel).then(() => channel as TChannel);
      })
    );

    let valuePromise: DeferredPromise<Channels[TChannel]> | null =
      createDeferredPromise<Channels[TChannel]>();

    let listeners: [TChannel, (payload: unknown) => void][] = [];
    for (const channel of channels) {
      const listener = (payload: any) => {
        valuePromise?.resolve(payload);
        valuePromise = createDeferredPromise();
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

      valuePromise?.resolve(doneSymbol as any);
      valuePromise = null;

      unsubscribes.delete(unsubscribe);
    }

    unsubscribes.add(unsubscribe);

    async function* iteratorGenerator() {
      while (valuePromise?.promise) {
        const value = await valuePromise.promise;

        if (value != doneSymbol) {
          yield value;
        }
      }

      unsubscribe();
    }

    return iteratorGenerator();
  }

  async function publish<TChannel extends keyof Channels>(
    channel: TChannel,
    data: Required<DeepPartial<Channels[TChannel]>>
  ) {
    const channelIdentifier = channelPrefix + channel;
    validateChannelLength(channelIdentifier);
    return pgPubSub.notify(channelIdentifier, data as any).catch(console.error);
  }

  return {
    subscribe,
    publish,
    close: async () => {
      unsubscribes.forEach((unsub) => unsub());
      await Promise.allSettled([pgPubSub.close(), pgPubSub.unlistenAll()]);
    },
    pgPubSub,
  };
};
