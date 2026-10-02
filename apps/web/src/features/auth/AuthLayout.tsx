import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Logo } from '@/components/layout/Logo';
import { ThemeToggle } from '@/components/layout/ThemeToggle';

/** Centered, minimal sign-in surface: logo, a narrow card, quiet footer. */
export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-surface">
      <header className="flex h-14 items-center justify-between px-6">
        <Link to="/" aria-label="goShort home">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-[400px]">
          <div className="rounded-xl border border-border bg-background p-8">
            <h1 className="heading-24 text-center">{title}</h1>
            {description && (
              <p className="copy-14 mt-2 text-center text-muted-foreground">{description}</p>
            )}
            <div className="mt-7">{children}</div>
          </div>
          {footer && <div className="copy-14 mt-5 text-center text-muted-foreground">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
