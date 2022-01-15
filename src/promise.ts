export class PLazy<ValueType> extends Promise<ValueType> {
  private _promise?: Promise<ValueType>;

  constructor(
    private _executor: (resolve: (value: ValueType) => void, reject: (err: unknown) => void) => void
  ) {
    super((resolve: (v?: any) => void) => resolve());
  }

  override then: Promise<ValueType>["then"] = (onFulfilled, onRejected) =>
    (this._promise ||= new Promise(this._executor)).then(onFulfilled, onRejected);

  override catch: Promise<ValueType>["catch"] = (onRejected) =>
    (this._promise ||= new Promise(this._executor)).catch(onRejected);

  override finally: Promise<ValueType>["finally"] = (onFinally) =>
    (this._promise ||= new Promise(this._executor)).finally(onFinally);
}

export function LazyPromise<Value>(fn: () => Value | Promise<Value>): Promise<Value> {
  return new PLazy((resolve, reject) => {
    try {
      Promise.resolve(fn()).then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });
}

export interface PubSubDeferredPromise<T> {
  promise: Promise<void>;
  resolve: () => void;
  isDone: boolean;
  values: Array<T>;
}

export function pubsubDeferredPromise<T = void>(): PubSubDeferredPromise<T> {
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
export type PromiseOrValue<T> = T | Promise<T>;
