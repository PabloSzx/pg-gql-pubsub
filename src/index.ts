import { createDeferredPromise, DeferredPromise } from "@graphql-ez/utils/promise";
import { PgPubSub } from "@imqueue/pg-pubsub";
import assert from "assert";
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

export interface PubSubChannels {}

const validateChannelLength = (channel: string) => {
  if (channel.length > 63) {
    throw Error(
      `Channel ${JSON.stringify(channel)} exceeded maximum default PostgreSQL identifier length`
    );
  }
};

export type PubSub = {
  subscribe<TKey extends keyof PubSubChannels>(
    ...channelsArg: TKey[]
  ): Promise<AsyncGenerator<PubSubChannels[TKey]>>;
  publish<TKey extends keyof PubSubChannels>(
    channel: TKey,
    data: Required<DeepPartial<PubSubChannels[TKey]>>
  ): Promise<void>;
  close: () => Promise<void>;
  pgPubSub: PgPubSub;
};

export const CreatePubSub = ({
  connectionString,
  prefix,
}: {
  connectionString: string;
  prefix?: string;
}): PubSub => {
  assert(
    typeof connectionString === "string" && connectionString.length,
    "Connection string not specified!"
  );
  const connectionUrl = new URL(connectionString);

  const databaseSchema = connectionUrl.searchParams.get("schema") || "public";

  const channelPrefix = databaseSchema.toUpperCase() + "_" + (prefix ? prefix + "_" : "");

  const imqueuePubSub = new PgPubSub({
    connectionString,
    singleListener: false,
  });

  function resolveConnect(resolve: (value: void | PromiseLike<void>) => void) {
    imqueuePubSub.connect().then(resolve, (err) => {
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

  async function subscribe<TKey extends keyof PubSubChannels>(
    ...channelsArg: TKey[]
  ): Promise<AsyncGenerator<PubSubChannels[TKey]>> {
    if (pubSubPromise) await pubSubPromise;

    const doneSymbol = Symbol("done");

    if (!channelsArg.length) throw Error("No channels specified!");

    const channels = await Promise.all(
      channelsArg.map((channelValue) => {
        const channel = `${channelPrefix}${channelValue}`;
        validateChannelLength(channel);
        return imqueuePubSub.listen(channel).then(() => channel as TKey);
      })
    );

    let valuePromise: DeferredPromise<PubSubChannels[TKey]> | null =
      createDeferredPromise<PubSubChannels[TKey]>();

    let listeners: [TKey, (payload: unknown) => void][] = [];
    for (const channel of channels) {
      const listener = (payload: any) => {
        valuePromise?.resolve(payload);
        valuePromise = createDeferredPromise();
      };
      listeners.push([channel, listener]);
      imqueuePubSub.channels.on(channel, listener);
    }

    function unsubscribe() {
      for (const [channel, listener] of listeners) {
        imqueuePubSub.channels.removeListener(channel, listener);
      }
      for (const channel of channels) {
        if (imqueuePubSub.channels.listenerCount(channel) === 0) {
          imqueuePubSub.unlisten(channel).catch(console.error);
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

  async function publish<TKey extends keyof PubSubChannels>(
    channel: TKey,
    data: Required<DeepPartial<PubSubChannels[TKey]>>
  ) {
    const channelIdentifier = channelPrefix + channel;
    validateChannelLength(channelIdentifier);
    return imqueuePubSub.notify(channelIdentifier, data as any).catch(console.error);
  }

  return {
    subscribe,
    publish,
    close: async () => {
      unsubscribes.forEach((unsub) => unsub());
      await Promise.allSettled([imqueuePubSub.close(), imqueuePubSub.unlistenAll()]);
    },
    pgPubSub: imqueuePubSub,
  };
};
