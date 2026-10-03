import * as NavigationMenu from '@radix-ui/react-navigation-menu';
import { ChevronDown, ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@go-short/ui/lib/cn';
import {
  ACCENT,
  PLATFORM,
  PRODUCTS,
  RESOURCES,
  SOLUTIONS,
  productHref,
  solutionHref,
} from './data';

const trigger =
  'group inline-flex h-9 items-center gap-1 rounded-md px-3 text-[14px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground data-[state=open]:text-foreground';

function Caret() {
  return (
    <ChevronDown
      className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180"
      aria-hidden
    />
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <NavigationMenu.Content className="absolute left-0 top-0 data-[motion=from-end]:animate-fade-in data-[motion=from-start]:animate-fade-in">
      <div className={cn('p-3', className)}>{children}</div>
    </NavigationMenu.Content>
  );
}

function Item({
  to,
  icon: Icon,
  title,
  body,
  accentClass,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  accentClass?: string;
}) {
  return (
    <NavigationMenu.Link asChild>
      <Link
        to={to}
        className="group/item flex gap-3 rounded-lg p-3 outline-none transition-colors hover:bg-hover focus-visible:bg-hover"
      >
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background',
            accentClass,
          )}
        >
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-[14px] font-medium">
            {title}
            <ArrowRight
              className="size-3 -translate-x-1 opacity-0 transition-all group-hover/item:translate-x-0 group-hover/item:opacity-100"
              aria-hidden
            />
          </span>
          <span className="mt-0.5 block text-[13px] leading-5 text-muted-foreground">{body}</span>
        </span>
      </Link>
    </NavigationMenu.Link>
  );
}

/** Desktop mega menu: Products, Solutions, Resources (Radix handles hover, focus and keyboard). */
export function MegaNav() {
  return (
    <NavigationMenu.Root className="relative hidden lg:block" delayDuration={80} aria-label="Main">
      <NavigationMenu.List className="flex items-center gap-0.5">
        <NavigationMenu.Item>
          <NavigationMenu.Trigger className={trigger}>
            Products <Caret />
          </NavigationMenu.Trigger>
          <Panel className="grid w-[640px] grid-cols-[1fr_200px] gap-2">
            <div className="flex flex-col">
              {PRODUCTS.map((p) => (
                <Item
                  key={p.slug}
                  to={productHref(p)}
                  icon={p.icon}
                  title={p.name}
                  body={p.tagline}
                  accentClass={ACCENT[p.accent].text}
                />
              ))}
            </div>
            <div className="rounded-lg bg-surface p-4">
              <p className="label-12 uppercase tracking-wider text-subtle-foreground">Platform</p>
              <ul className="mt-3 flex flex-col gap-1">
                {PLATFORM.map((x) => (
                  <li key={x.name}>
                    <NavigationMenu.Link asChild>
                      <Link
                        to={x.href}
                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] text-muted-foreground hover:bg-hover hover:text-foreground"
                      >
                        <x.icon className="size-4" aria-hidden /> {x.name}
                      </Link>
                    </NavigationMenu.Link>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </NavigationMenu.Item>

        <NavigationMenu.Item>
          <NavigationMenu.Trigger className={trigger}>
            Solutions <Caret />
          </NavigationMenu.Trigger>
          <Panel className="grid w-[600px] grid-cols-2 gap-1">
            {SOLUTIONS.map((s) => (
              <Item
                key={s.slug}
                to={solutionHref(s)}
                icon={s.icon}
                title={s.name}
                body={s.tagline}
              />
            ))}
          </Panel>
        </NavigationMenu.Item>

        <NavigationMenu.Item>
          <NavigationMenu.Trigger className={trigger}>
            Resources <Caret />
          </NavigationMenu.Trigger>
          <Panel className="grid w-[640px] grid-cols-2 gap-1">
            {RESOURCES.map((r) => (
              <Item key={r.name} to={r.href} icon={r.icon} title={r.name} body={r.blurb} />
            ))}
          </Panel>
        </NavigationMenu.Item>

        <NavigationMenu.Item>
          <NavigationMenu.Link asChild>
            <Link to="/security" className={trigger}>
              Security
            </Link>
          </NavigationMenu.Link>
        </NavigationMenu.Item>
        <NavigationMenu.Item>
          <NavigationMenu.Link asChild>
            <Link to="/docs/introduction" className={trigger}>
              Docs
            </Link>
          </NavigationMenu.Link>
        </NavigationMenu.Item>
      </NavigationMenu.List>

      <div className="absolute left-1/2 top-full flex -translate-x-1/2 justify-center pt-2">
        <NavigationMenu.Viewport className="relative h-[var(--radix-navigation-menu-viewport-height)] w-[var(--radix-navigation-menu-viewport-width)] origin-top animate-pop-in overflow-hidden rounded-xl border border-border bg-background shadow-menu transition-[width,height] duration-200 data-[state=closed]:hidden" />
      </div>
    </NavigationMenu.Root>
  );
}
