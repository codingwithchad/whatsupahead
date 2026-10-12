import { AsyncLocalStorage } from 'node:async_hooks';

// Who a request is for (their address, as the rate limits count it), available to code deep inside a page's
// loading, such as the Azure Maps calls, so one visitor can't use up what everyone shares.

const store = new AsyncLocalStorage<string>();

export const withVisitor = <T>(who: string, fn: () => T): T => store.run(who, fn);

/** The visitor this work is for, or undefined outside a request (background jobs). */
export const currentVisitor = (): string | undefined => store.getStore();
