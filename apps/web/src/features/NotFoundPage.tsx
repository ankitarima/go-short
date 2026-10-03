import { Link } from 'react-router-dom';
import { Button } from '@go-short/ui/components/button';

export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <p className="mono-13 text-muted-foreground">404</p>
      <h1 className="heading-32">This page could not be found</h1>
      <p className="copy-14 max-w-sm text-muted-foreground">
        It may have moved, or the link you followed is wrong.
      </p>
      <Button asChild>
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </div>
  );
}
