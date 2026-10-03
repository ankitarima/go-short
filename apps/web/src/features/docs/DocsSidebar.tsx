import { NavLink } from 'react-router-dom';
import { cn } from '@go-short/ui/lib/cn';
import { MethodBadge } from './MethodBadge';
import { sections, type Area } from './lib/content';
import { operationPath } from './lib/openapi';
import { useSpec } from './useSpec';

const item = (active: boolean) =>
  cn(
    'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[13.5px] leading-5 transition-colors',
    active
      ? 'bg-hover font-medium text-foreground'
      : 'text-muted-foreground hover:bg-hover hover:text-foreground',
  );

export function DocsSidebar({ area }: { area: Area }) {
  const spec = useSpec();
  return (
    <nav aria-label={area === 'api' ? 'API reference' : 'Guides'} className="flex flex-col gap-7">
      {sections(area).map((s) => (
        <div key={s.name}>
          <h3 className="label-12 mb-2 px-2.5 uppercase tracking-wider text-subtle-foreground">
            {s.name}
          </h3>
          <ul className="flex flex-col gap-0.5">
            {s.pages.map((p) => (
              <li key={p.path}>
                <NavLink to={p.path} end className={({ isActive }) => item(isActive)}>
                  {p.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {area === 'api' && (
        <>
          {spec.isPending && (
            <div className="px-2.5" aria-busy>
              <div className="skeleton h-4 w-24 rounded" />
              <div className="mt-3 flex flex-col gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="skeleton h-5 rounded" />
                ))}
              </div>
            </div>
          )}
          {spec.isError && (
            <p className="px-2.5 text-[13px] text-muted-foreground">
              The endpoint list could not be loaded.
            </p>
          )}
          {spec.data?.tags.map((t) => (
            <div key={t.slug}>
              <h3 className="mb-2 px-2.5">
                <NavLink
                  to={`/docs/api/${t.slug}`}
                  end
                  className="label-12 uppercase tracking-wider text-subtle-foreground hover:text-foreground"
                >
                  {t.name}
                </NavLink>
              </h3>
              <ul className="flex flex-col gap-0.5">
                {t.operations.map((o) => (
                  <li key={o.id}>
                    <NavLink to={operationPath(o)} className={({ isActive }) => item(isActive)}>
                      <MethodBadge
                        method={o.method}
                        className="h-[18px] min-w-[2.4rem] text-[9px]"
                      />
                      <span className="min-w-0 truncate">
                        {o.summary.replace(/\s*\([^)]*\)\s*$/, '')}
                      </span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </nav>
  );
}
