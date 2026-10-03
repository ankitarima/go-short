import { ArrowRight, Check } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cn } from '@go-short/ui/lib/cn';
import { CodeBlock } from '@/features/docs/CodeBlock';
import { NotFoundPage } from '@/features/NotFoundPage';
import { ACCENT, PRODUCTS, SOLUTIONS, productHref, solutionHref } from './data';
import { PRODUCT_CONTENT, SECURITY_PILLARS, SOLUTION_CONTENT } from './content';
import { MOCKS } from './mocks';
import {
  CapabilityStrip,
  Container,
  CtaBand,
  CtaButtons,
  Faq,
  FeatureGrid,
  PageHero,
  Pill,
  Section,
  Split,
} from './sections';
import { usePageMeta } from './usePageMeta';

const CURL = `curl -X POST https://app.example.com/api/v1/links \\
  -H "Authorization: Bearer $GOSHORT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"destinationUrl":"https://example.com/summer-sale","slug":"summer"}'`;

/** The home page: product tabs in the hero, the three products, solutions, developers, trust. */
export function HomePage() {
  usePageMeta(
    'Short links, QR codes and campaign analytics',
    'goShort is an open-source, self-hosted platform for branded short links, QR codes, campaigns and privacy-friendly analytics.',
  );
  const [tab, setTab] = useState(0);
  const product = PRODUCTS[tab]!;
  const Mock = MOCKS[PRODUCT_CONTENT[product.slug]!.heroMock];
  return (
    <>
      <PageHero
        eyebrow={<Pill>Open source · self-hosted</Pill>}
        title={<>The modern platform for links, campaigns and analytics.</>}
        subtitle="Create branded short links and QR codes, run every channel as one campaign, and measure what works, on infrastructure you control."
        actions={
          <CtaButtons secondary={{ label: 'Explore the products', to: '/products/golinks' }} />
        }
      >
        <div
          role="tablist"
          aria-label="Products"
          className="mx-auto mb-6 flex w-fit gap-1 rounded-full border border-border bg-background p-1"
        >
          {PRODUCTS.map((p, i) => (
            <button
              key={p.slug}
              role="tab"
              aria-selected={tab === i}
              onClick={() => setTab(i)}
              className={cn(
                'flex items-center gap-2 rounded-full px-4 py-1.5 text-[13.5px] font-medium transition-colors',
                tab === i
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <p.icon className="size-4" aria-hidden /> {p.name}
            </button>
          ))}
        </div>
        <div className="mx-auto max-w-4xl">
          <Mock />
        </div>
        <p className="mt-4 text-center text-[12.5px] text-subtle-foreground">
          Illustrative interface. {product.tagline}.
        </p>
      </PageHero>
      <CapabilityStrip />

      <Section
        eyebrow="Products"
        title="Three products. One platform."
        body="Start with what you need today. They share one workspace, one team and one set of data."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {PRODUCTS.map((p) => {
            const M = MOCKS[PRODUCT_CONTENT[p.slug]!.heroMock];
            const a = ACCENT[p.accent];
            return (
              <Link
                key={p.slug}
                to={productHref(p)}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-background transition-colors hover:border-border-strong"
              >
                <div className="relative h-52 overflow-hidden border-b border-border bg-surface">
                  <div
                    aria-hidden
                    className="absolute inset-0 opacity-[0.12]"
                    style={{
                      background: `radial-gradient(circle at 70% 0%, ${a.glow}, transparent 60%)`,
                    }}
                  />
                  <div className="absolute left-6 right-[-40px] top-6 origin-top-left scale-[0.78]">
                    <M />
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-6">
                  <span className={cn('grid size-9 place-items-center rounded-lg', a.bg)}>
                    <p.icon className={cn('size-5', a.text)} aria-hidden />
                  </span>
                  <h3 className="heading-20 mt-4">{p.name}</h3>
                  <p className="copy-14 mt-2 flex-1 text-muted-foreground">{p.blurb}</p>
                  <span className="mt-5 inline-flex items-center gap-1 text-[14px] font-medium">
                    Learn more{' '}
                    <ArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </Section>

      <Section
        tone="surface"
        eyebrow="Why goShort"
        title="Built for teams that need control"
        body="Everything you expect from a modern link platform, without handing your data to a third party."
      >
        <FeatureGrid
          items={[
            {
              icon: PRODUCTS[0]!.icon,
              title: 'Your domains',
              body: 'Verify DNS once and every link is on your brand, with automatic HTTPS.',
            },
            {
              icon: PRODUCTS[2]!.icon,
              title: 'Privacy-friendly analytics',
              body: 'No raw IP storage, daily-rotating visitor hashes and retention you control.',
            },
            {
              icon: PRODUCTS[1]!.icon,
              title: 'Campaign-first',
              body: 'Links, QR codes and results grouped the way marketing teams work.',
            },
            {
              icon: SOLUTIONS[0]!.icon,
              title: 'Team access',
              body: 'Owners, admins, members and viewers, with an audit log.',
            },
            {
              icon: SOLUTIONS[2]!.icon,
              title: 'API and webhooks',
              body: 'Scoped keys, a documented API and signed events.',
            },
            {
              icon: SOLUTIONS[1]!.icon,
              title: 'Self-hosted and open source',
              body: 'Run it on your server with Docker. MIT licensed.',
            },
          ]}
        />
      </Section>

      <Section eyebrow="Solutions" title="Made for how you work">
        <div className="grid gap-4 sm:grid-cols-2">
          {SOLUTIONS.map((s) => (
            <Link
              key={s.slug}
              to={solutionHref(s)}
              className="group flex gap-4 rounded-2xl border border-border p-6 transition-colors hover:border-border-strong hover:bg-surface"
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-border bg-background">
                <s.icon className="size-5" aria-hidden />
              </span>
              <span>
                <span className="flex items-center gap-1 text-[16px] font-semibold">
                  {s.name}{' '}
                  <ArrowRight
                    className="size-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
                    aria-hidden
                  />
                </span>
                <span className="copy-14 mt-1 block text-muted-foreground">{s.blurb}</span>
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <Section
        tone="surface"
        eyebrow="For developers"
        title="Everything is an API call"
        align="left"
        body="Create links, read analytics and subscribe to events from your own code. The reference is generated from the API itself, so it is always accurate."
      >
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <ul className="flex flex-col gap-4">
            {[
              'Scoped API keys: read-only or read and write',
              'OpenAPI 3.1 description and a searchable reference',
              'cURL, JavaScript and Python samples on every endpoint',
              'Signed webhooks with retries',
            ].map((t) => (
              <li key={t} className="flex gap-3 text-[15.5px]">
                <Check className="mt-1 size-4 shrink-0 text-green" aria-hidden />
                {t}
              </li>
            ))}
            <li className="mt-2 flex gap-4">
              <Link
                to="/docs/api"
                className="inline-flex items-center gap-1 text-[14px] font-medium hover:underline"
              >
                API reference <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                to="/docs/quickstart"
                className="inline-flex items-center gap-1 text-[14px] font-medium hover:underline"
              >
                Quickstart <ArrowRight className="size-4" aria-hidden />
              </Link>
            </li>
          </ul>
          <CodeBlock lang="bash" code={CURL} />
        </div>
      </Section>

      <Section
        eyebrow="Trust"
        title="Privacy and security, in the open"
        body="A published threat model, tested controls and no tracking of your visitors’ identities."
      >
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          {SECURITY_PILLARS.slice(1, 4).map((p) => (
            <div key={p.title} className="rounded-2xl border border-border p-6">
              <p.icon className="size-5" aria-hidden />
              <h3 className="heading-16 mt-4">{p.title}</h3>
              <p className="copy-14 mt-2 text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center">
          <Link
            to="/security"
            className="inline-flex items-center gap-1 text-[14px] font-medium hover:underline"
          >
            Read about security <ArrowRight className="size-4" aria-hidden />
          </Link>
        </p>
      </Section>
      <CtaBand />
    </>
  );
}

export function ProductPage() {
  const { slug = '' } = useParams();
  const product = PRODUCTS.find((p) => p.slug === slug);
  const c = PRODUCT_CONTENT[slug];
  usePageMeta(product?.name ?? 'Product', product?.blurb);
  if (!product || !c) return <NotFoundPage />;
  const Hero = MOCKS[c.heroMock];
  return (
    <>
      <PageHero
        accent={c.accent}
        eyebrow={
          <Pill accent={c.accent}>
            <product.icon className="size-3.5" aria-hidden /> {product.name}
          </Pill>
        }
        title={c.title}
        subtitle={c.subtitle}
        actions={<CtaButtons secondary={{ label: 'View the docs', to: '/docs/introduction' }} />}
      >
        <div className="mx-auto max-w-4xl">
          <Hero />
        </div>
      </PageHero>
      <CapabilityStrip />
      <section className="border-b border-border">
        <Container className="flex flex-col gap-24 py-24">
          {c.splits.map((s, i) => {
            const M = MOCKS[s.mock];
            return (
              <Split
                key={s.title}
                eyebrow={s.eyebrow}
                title={s.title}
                body={s.body}
                bullets={s.bullets}
                link={s.link}
                reverse={i % 2 === 1}
                accent={c.accent}
                visual={<M />}
              />
            );
          })}
        </Container>
      </section>
      <Section tone="surface" title={c.featuresTitle}>
        <FeatureGrid items={c.features} />
      </Section>
      <Section title="Frequently asked questions">
        <Faq items={c.faq} />
      </Section>
      <Section tone="surface" eyebrow="Keep going" title="Works even better together">
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
          {c.related.map((r) => {
            const p = PRODUCTS.find((x) => x.slug === r)!;
            return (
              <Link
                key={r}
                to={productHref(p)}
                className="group rounded-2xl border border-border bg-background p-6 hover:border-border-strong"
              >
                <span
                  className={cn('grid size-9 place-items-center rounded-lg', ACCENT[p.accent].bg)}
                >
                  <p.icon className={cn('size-5', ACCENT[p.accent].text)} aria-hidden />
                </span>
                <h3 className="heading-16 mt-4">{p.name}</h3>
                <p className="copy-14 mt-1 text-muted-foreground">{p.tagline}</p>
              </Link>
            );
          })}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}

export function SolutionPage() {
  const { slug = '' } = useParams();
  const solution = SOLUTIONS.find((s) => s.slug === slug);
  const c = SOLUTION_CONTENT[slug];
  usePageMeta(solution?.name ?? 'Solution', solution?.blurb);
  if (!solution || !c) return <NotFoundPage />;
  const Hero = MOCKS[c.heroMock];
  return (
    <>
      <PageHero
        eyebrow={
          <Pill>
            <solution.icon className="size-3.5" aria-hidden /> {solution.name}
          </Pill>
        }
        title={c.title}
        subtitle={c.subtitle}
        actions={<CtaButtons />}
      >
        <div className="mx-auto max-w-4xl">
          <Hero />
        </div>
      </PageHero>
      <Section eyebrow="The challenge" title="What gets in the way, and how goShort helps">
        <FeatureGrid items={c.challenges} />
      </Section>
      <Section tone="surface" eyebrow="How it works" title="Up and running in three steps">
        <ol className="grid gap-4 md:grid-cols-3">
          {c.steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-border bg-background p-6">
              <span className="mono-13 text-subtle-foreground">0{i + 1}</span>
              <h3 className="heading-20 mt-3">{s.title}</h3>
              <p className="copy-14 mt-2 text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </Section>
      <Section eyebrow="Products" title="What you will use">
        <div className="grid gap-4 md:grid-cols-3">
          {c.products.map((slug2) => {
            const p = PRODUCTS.find((x) => x.slug === slug2)!;
            return (
              <Link
                key={slug2}
                to={productHref(p)}
                className="group rounded-2xl border border-border p-6 hover:border-border-strong hover:bg-surface"
              >
                <span
                  className={cn('grid size-9 place-items-center rounded-lg', ACCENT[p.accent].bg)}
                >
                  <p.icon className={cn('size-5', ACCENT[p.accent].text)} aria-hidden />
                </span>
                <h3 className="heading-16 mt-4">{p.name}</h3>
                <p className="copy-14 mt-1 text-muted-foreground">{p.blurb}</p>
              </Link>
            );
          })}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}

export function SecurityPage() {
  usePageMeta(
    'Security and privacy',
    'How goShort protects your data: privacy by design, access control, hardened integrations and an open threat model.',
  );
  return (
    <>
      <PageHero
        eyebrow={<Pill>Security and privacy</Pill>}
        title="Secure by design. Transparent by default."
        subtitle="goShort runs on your infrastructure, collects as little personal data as possible, and publishes its threat model and the tests behind every control."
        actions={
          <CtaButtons
            primary="Get started"
            secondary={{ label: 'Privacy and data', to: '/docs/privacy' }}
          />
        }
      />
      <Section eyebrow="Security" title="What protects your data">
        <FeatureGrid items={SECURITY_PILLARS} />
      </Section>
      <Section
        tone="surface"
        eyebrow="Honesty"
        title="What we do not claim"
        body="Security claims should be checkable. These are the current limits."
      >
        <ul className="mx-auto grid max-w-3xl gap-3">
          {[
            'goShort is software you operate. Host-level security (patching, firewalls, access to the server) is your responsibility.',
            'There are no compliance certifications such as SOC 2 or ISO 27001, and no two-factor authentication yet.',
            'Unique visitors, locations and bot detection are approximations, and the product labels them that way.',
            'Operators are responsible for compliance with the privacy laws that apply to them.',
          ].map((t) => (
            <li
              key={t}
              className="flex gap-3 rounded-xl border border-border bg-background p-4 text-[15px] leading-6"
            >
              <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-amber" />
              {t}
            </li>
          ))}
        </ul>
      </Section>
      <Section eyebrow="Learn more" title="Everything is documented">
        <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-3">
          {[
            ['Privacy and data', 'What is stored and what is not', '/docs/privacy'],
            ['Self-hosting', 'Deploy with Docker and Caddy', '/docs/self-hosting'],
            ['API authentication', 'Scoped keys and access levels', '/docs/api/authentication'],
          ].map(([t, b, href]) => (
            <Link
              key={t}
              to={href!}
              className="rounded-2xl border border-border p-5 hover:border-border-strong hover:bg-surface"
            >
              <h3 className="heading-16">{t}</h3>
              <p className="copy-14 mt-1 text-muted-foreground">{b}</p>
            </Link>
          ))}
        </div>
      </Section>
      <CtaBand />
    </>
  );
}
