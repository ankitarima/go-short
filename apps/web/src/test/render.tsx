import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { AppProviders, routes } from '@/router';

/** Mounts the REAL route table (guards, shell, lazy screens) at a URL, with a fresh query cache. */
export function renderApp(path = '/dashboard') {
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

/** Captures JSON request bodies for a mocked endpoint. */
export function capture<T = unknown>() {
  const calls: T[] = [];
  return { calls, last: () => calls[calls.length - 1] as T };
}
