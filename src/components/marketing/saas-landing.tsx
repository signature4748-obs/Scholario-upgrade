'use client'

import { useEffect, useState } from 'react'
import {
  Globe2,
  Palette,
  LogIn,
  LayoutDashboard,
  GraduationCap,
  ShieldCheck,
  Building2,
  ArrowRight,
  Cloud,
  Server,
  Users,
  Check,
} from 'lucide-react'

/**
 * PRODUCT-DIRECTION RESET (Parts 2 & 11) — the SCHOLARIO SaaS website.
 *
 * Rendered at the root when NO tenant resolves (bare platform domain /
 * sandbox root). This is the PLATFORM's own product surface:
 * Features · How onboarding works · Plans · For Schools · Contact.
 * There is deliberately NO school directory here — each school is a
 * separate tenant reached through its own domain (or, during
 * development, an explicit ?tenant= link), never through a
 * platform-wide school list.
 *
 * Honesty rules (same as the school CMS): no invented customer counts,
 * no testimonials, no fake pricing numbers, no fabricated contact
 * channels. Only what the platform actually is and actually does.
 */

export function SaasLanding({ notFoundForSlug }: { notFoundForSlug?: string | null }) {
  const [year] = useState(() => new Date().getFullYear())

  useEffect(() => {
    document.title = 'SCHOLARIO — The multi-school platform'
    return () => {
      document.title = 'SCHOLARIO'
    }
  }, [])

  return (
    <div className="min-h-screen bg-white text-slate-900 flex flex-col">
      {/* Header — platform brand + platform login only */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white" aria-hidden="true">
              <Cloud className="h-4 w-4" />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-bold tracking-tight">SCHOLARIO</span>
              <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">
                School platform
              </span>
            </div>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex" aria-label="Platform">
            <a href="#features" className="transition-colors hover:text-slate-900">Features</a>
            <a href="#how-it-works" className="transition-colors hover:text-slate-900">How it works</a>
            <a href="#plans" className="transition-colors hover:text-slate-900">Plans</a>
            <a href="#for-schools" className="transition-colors hover:text-slate-900">For schools</a>
            <a href="#contact" className="transition-colors hover:text-slate-900">Contact</a>
          </nav>
          <a
            href="/platform/login"
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            Platform login
          </a>
        </div>
      </header>

      <main className="flex-1">
        {/* Honest notice when an explicitly requested tenant did not resolve */}
        {notFoundForSlug ? (
          <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
            <div
              role="status"
              className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              No school website was found for{' '}
              <span className="font-semibold">“{notFoundForSlug}”</span>.
            </div>
          </div>
        ) : null}

        {/* Hero */}
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="max-w-3xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-teal-200 bg-teal-50 px-3.5 py-1.5 text-xs font-semibold text-teal-700">
              <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
              One platform · One deployment · Every school its own tenant
            </p>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Every school gets its own website, login and ERP — from one onboarding.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-slate-600">
              SCHOLARIO is a multi-tenant school platform. The operator onboards a school once;
              the school receives its public website, its branding, its own login, its principal,
              teachers and students — each operating independently on shared infrastructure.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#contact"
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-teal-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              >
                Request a demo
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>
              <a
                href="#how-it-works"
                className="inline-flex h-11 items-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
              >
                See how onboarding works
              </a>
            </div>
          </div>
        </section>

        {/* How it works — the real product flow */}
        <section id="how-it-works" className="border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Add a school → website + domain + principal + ERP
            </h2>
            <p className="mt-3 max-w-2xl text-slate-600">
              One simple operator workflow configures the school&rsquo;s whole ecosystem.
              The school never needs a developer.
            </p>
            <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: Building2,
                  title: '1 · Onboard the school',
                  text: 'Basics, branding, domain, founding principal and initial classes — one reviewed wizard, one transactional create.',
                },
                {
                  icon: Globe2,
                  title: '2 · Its own website',
                  text: 'A public, data-driven school website on the school\u2019s own domain — home, about, academics, admissions, contact.',
                },
                {
                  icon: LogIn,
                  title: '3 · Its own login',
                  text: 'The school website\u2019s login is that school\u2019s door. No platform-wide school list, no tenant guessing.',
                },
                {
                  icon: LayoutDashboard,
                  title: '4 · Its own ERP',
                  text: 'Principal, teachers and students land in this school\u2019s workspace — classes, subjects, notices, fees, exams.',
                },
              ].map((s) => (
                <li key={s.title} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-600/10 text-teal-700" aria-hidden="true">
                    <s.icon className="h-4.5 w-4.5" />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-slate-900">{s.title}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            What the platform runs for each school
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Globe2,
                title: 'Tenant public website',
                text: 'Home, about, academics, admissions, faculty, events, gallery and contact — driven by each school\u2019s own content, with honest empty states until configured.',
              },
              {
                icon: Palette,
                title: 'School branding',
                text: 'Logo, colors and identity per tenant — applied to the website, the login and the workspace without any code change.',
              },
              {
                icon: ShieldCheck,
                title: 'Tenant isolation',
                text: 'Every query is tenant-scoped from the server-side session. School data never crosses tenants — structurally, not by convention.',
              },
              {
                icon: Users,
                title: 'Roles per school',
                text: 'Principal, teacher, student and parent portals per tenant, each scoped to that school\u2019s data only.',
              },
              {
                icon: LayoutDashboard,
                title: 'School ERP workspace',
                text: 'Classes, sections, subjects, attendance, exams, fees, library, notices and more — configured by the school, not the platform.',
              },
              {
                icon: Server,
                title: 'One deployment',
                text: 'One repository, one deployment, one database. Adding a school is data, not infrastructure — domains resolve per tenant.',
              },
            ].map((f) => (
              <div key={f.title} className="rounded-2xl border border-slate-200 bg-white p-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-teal-700" aria-hidden="true">
                  <f.icon className="h-4.5 w-4.5" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">{f.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Plans — names only, honest about pricing */}
        <section id="plans" className="border-y border-slate-200 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Plans</h2>
            <p className="mt-3 max-w-2xl text-slate-600">
              Schools run on a platform plan selected at onboarding. Plan levels gate the
              modules available to each tenant.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { name: 'Free', note: 'The essentials for a school website and basic workspace.' },
                { name: 'Standard', note: 'The full school ERP workspace with all core modules.' },
                { name: 'Pro', note: 'Advanced modules and priority platform support.' },
                { name: 'Enterprise', note: 'Custom domain management and platform-level guarantees.' },
              ].map((p, i) => (
                <div
                  key={p.name}
                  className={`rounded-2xl border p-5 ${
                    i === 1 ? 'border-teal-300 bg-white ring-1 ring-teal-200' : 'border-slate-200 bg-white'
                  }`}
                >
                  {i === 1 ? (
                    <span className="inline-flex rounded-full bg-teal-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-700">
                      Typical
                    </span>
                  ) : null}
                  <h3 className="mt-2 text-sm font-semibold text-slate-900">{p.name}</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{p.note}</p>
                  <p className="mt-4 text-xs font-medium text-slate-500">Pricing set by the platform operator</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* For schools */}
        <section id="for-schools" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                For schools
              </h2>
              <p className="mt-3 text-slate-600">
                Your school keeps its own identity — your website, your domain, your login —
                while the operation runs on shared, maintained infrastructure. You configure
                classes, subjects, staff and students; the platform keeps them yours alone.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  'Your own public website and domain',
                  'Your own login — staff and students never pick from a school list',
                  'Principal, teacher, student and parent workspaces',
                  'Your data stays scoped to your school',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
                The flow your school gets
              </p>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <p className="flex items-center gap-2.5">
                  <Globe2 className="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                  your-school-domain.com
                </p>
                <p className="pl-7 text-slate-400" aria-hidden="true">↓</p>
                <p className="flex items-center gap-2.5">
                  <GraduationCap className="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                  Your school&rsquo;s website
                </p>
                <p className="pl-7 text-slate-400" aria-hidden="true">↓</p>
                <p className="flex items-center gap-2.5">
                  <LogIn className="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                  School login (your school only)
                </p>
                <p className="pl-7 text-slate-400" aria-hidden="true">↓</p>
                <p className="flex items-center gap-2.5">
                  <LayoutDashboard className="h-4 w-4 shrink-0 text-teal-600" aria-hidden="true" />
                  Your school&rsquo;s ERP workspace
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Contact / demo */}
        <section id="contact" className="border-t border-slate-200 bg-slate-900">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
                Get your school on SCHOLARIO
              </h2>
              <p className="mt-3 text-slate-300">
                Schools are onboarded by the platform operator — reach out to your SCHOLARIO
                platform contact to start. Onboarding takes minutes, and your school runs
                independently from day one.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href="/platform/login"
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-slate-900 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Platform login
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer — sticky to bottom on short content */}
      <footer className="mt-auto border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:px-6">
          <span>© {year} SCHOLARIO</span>
          <span className="flex items-center gap-1.5">
            <Cloud className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            One platform · Many schools
          </span>
          <a
            href="/platform/login"
            className="font-semibold text-slate-600 transition-colors hover:text-teal-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
          >
            Platform sign-in
          </a>
        </div>
      </footer>
    </div>
  )
}
