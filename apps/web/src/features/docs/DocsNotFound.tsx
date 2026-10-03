import { Link } from 'react-router-dom';
import { Button } from '@go-short/ui/components/button';

export function DocsNotFound() {
  return (
    <div className="mx-auto max-w-md py-24 text-center">
      <p className="mono-13 text-subtle-foreground">404</p>
      <h1 className="heading-24 mt-2">This page does not exist</h1>
      <p className="copy-14 mt-2 text-muted-foreground">
        It may have moved. Try the search, or start from the beginning.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Button asChild>
          <Link to="/docs/introduction">Guides</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link to="/docs/api">API reference</Link>
        </Button>
      </div>
    </div>
  );
}
