import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { AppProviders, routes } from '@/router';

/** Mounts the REAL route table (gate, shell, lazy-free pages) at a URL, with a fresh cache. */
export function renderConsole(path = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const user = userEvent.setup();
  const utils = render(
    <AppProviders client={client}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...utils, user, router, client };
}

export function capture<T = unknown>() {
  const calls: T[] = [];
  return { calls, last: () => calls[calls.length - 1] as T };
}
