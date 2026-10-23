// Полифилл для WebView, которым ещё не хватает Promise.withResolvers (Chrome 119+).
// Нужен PDF.js 6: он вызывает метод и в основном потоке, и в воркере.
// Файл подключается первым в main.tsx и в pdf-worker.ts, поэтому к моменту
// импорта PDF.js метод уже существует.

type WithResolvers = <T>() => {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const target = Promise as unknown as { withResolvers?: WithResolvers };

if (typeof target.withResolvers !== 'function') {
  Object.defineProperty(target, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers<T>() {
      let resolve!: (value: T | PromiseLike<T>) => void;
      let reject!: (reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    } satisfies WithResolvers,
  });
}
