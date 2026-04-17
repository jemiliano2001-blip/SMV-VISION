export async function runWithConcurrencyLimit<TInput, TResult>(
  items: readonly TInput[],
  maxConcurrency: number,
  worker: (item: TInput, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  const safeConcurrency = Math.max(1, Math.floor(maxConcurrency));
  const results: TResult[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workers: Promise<void>[] = [];
  const workerCount = Math.min(safeConcurrency, items.length);
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(runWorker());
  }

  await Promise.all(workers);
  return results;
}
