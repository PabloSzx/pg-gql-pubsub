# pg-gql-pubsub

Full type-safe PostgreSQL PubSub (using NOTIFY and LISTEN) with smart reconnection and specially designed for GraphQL API Usage, powered mainly by the great library: [@imqueue/pg-pubsub](https://github.com/imqueue/pg-pubsub)

[![https://npm.im/pg-gql-pubsub](https://shields.io/npm/v/pg-gql-pubsub)](https://npm.im/pg-gql-pubsub)

Check [graphql-ez](https://www.graphql-ez.com/) 💯

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

pubSub.subscribe("notification").then(async iterator => {
  for await (const data of iterator) {
    // data <=> string
    console.log(data)
  }
})

// ...

pubSub.publish("notification", "Hello World");
```

### With GraphQL Code Generator


```ts

// Assumming `type Subscription { notification: String! }`

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


const resolvers = {
  Subscription: {
    notification: {
      subscribe(_root, _args, { pubSub }) {
        // Assumming you already added the pubSub to your context
        return pubSub.subscribe("notification");
      },
    },
  },
}

pubSub.subscribe("notification").then(async iterator => {
  for await (const data of iterator) {
    // data <=> { notification: "Hello World" } 
    console.log(data)
  }
})

// ...

pubSub.publish("notification", { notification: "Hello World" });

```


