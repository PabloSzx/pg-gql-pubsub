# pg-gql-pubsub

[![https://npm.im/pg-gql-pubsub](https://shields.io/npm/v/pg-gql-pubsub)](https://npm.im/pg-gql-pubsub)

```
pnpm add pg-gql-pubsub
```

```
yarn add pg-gql-pubsub
```

```
npm install pg-gql-pubsub
```

## Usage

```ts
import { CreatePubSub } from "pg-gql-pubsub";


declare module "pg-gql-pubsub" {
  interface Channels {
    notification: string;
  }
}

export const pubSub = CreatePubSub({
  connectionString: process.env.DATABASE_URL,
});

// ...

pubSub.subscribe("notification").then(iterator => {
  for (const data of iterator) {
    // data <=> string
    console.log(data)
  }
})

// ...

pubSub.publish("notification", "Hello World");
```

### With GraphQL Code Generator


```ts
import type { Subscription } from "../generated/graphql.ts";
import { CreatePubSub } from "pg-gql-pubsub";

type PubSubData = { [k in keyof Subscription]: Pick<Subscription, k> };

declare module "pg-gql-pubsub" {
  interface Channels extends PubSubData {}
}

export const pubSub = CreatePubSub({
  connectionString: process.env.DATABASE_URL,
});

// ...

pubSub.subscribe("notification").then(iterator => {
  for (const data of iterator) {
    console.log(data)
  }
})

// ...

pubSub.publish("notification", "Hello World");

```


