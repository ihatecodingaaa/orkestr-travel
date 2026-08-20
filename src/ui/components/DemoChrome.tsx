import type { ReactNode } from "react";
import Link from "next/link";
import type { DemoState } from "../demo/scenario";
import { demoHref } from "../demo/params";
import { FixtureBanner } from "./FixtureBanner";

/**
 * The demo shell: banner, navigation and the demo controls.
 *
 * The controls are plain links, so every step is a real navigation. That keeps
 * the sequence reproducible, makes the browser's back button work as an undo,
 * and means RESET genuinely returns to the baseline rather than to something
 * that merely resembles it.
 */
export function DemoChrome({
  state,
  current,
  children,
}: {
  readonly state: DemoState;
  readonly current: string;
  readonly children: ReactNode;
}) {
  const nav = [
    { href: "/demo", label: "The group", key: "group" },
    { href: "/demo/waves", label: "Travel groups", key: "waves" },
    { href: "/demo/journey", label: "The journey", key: "journey" },
    { href: "/demo/decisions", label: "Needs attention", key: "decisions" },
  ];

  return (
    <>
      <FixtureBanner />
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/">
            Orkestr<span>.</span>
          </Link>
          <nav className="nav" aria-label="Journey sections">
            {nav.map((item) => (
              <Link
                key={item.key}
                href={demoHref(item.href, state)}
                {...(current === item.key ? { "aria-current": "page" as const } : {})}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="shell">{children}</main>
    </>
  );
}

/** Deterministic demo controls. Same sequence, same result, every time. */
export function DemoControls({ state, path }: { readonly state: DemoState; readonly path: string }) {
  return (
    <div className="demobar" role="group" aria-label="Demo controls">
      <p className="eyebrow">Demo controls</p>

      <Link className="btn btn-secondary btn-small" href={path}>
        Reset
      </Link>

      {state.stage === "BASELINE" ? (
        <Link className="btn btn-small" href={demoHref(path, state, { stage: "RYAN_JOINED" })}>
          Ryan joins
        </Link>
      ) : (
        <Link
          className="btn btn-secondary btn-small"
          href={demoHref(path, state, { stage: "BASELINE" })}
        >
          Before Ryan joined
        </Link>
      )}

      <Link
        className="btn btn-secondary btn-small"
        href={demoHref("/demo/journey", state, { fareScenario: "SOFT_BREACH" })}
      >
        Check the fares
      </Link>
    </div>
  );
}
