import Link from "next/link";
import { ExampleClient, type ExampleSection } from "./ExampleClient";

/**
 * The chrome around the Tokyo example.
 *
 * Shared by every example route so the header, the "nobody here is real" notice
 * and the section body stay in one place. The example is deep-linkable -- the
 * Group screen's "Add or edit people" and the Overview's next action are real
 * links, and a link that 404s in the demo is worse than no link.
 */
export function ExampleShell({ section }: { readonly section: ExampleSection }) {
  return (
    <div className="stack gap-3">
      <header className="trip-header">
        <div className="stack gap-1">
          <p className="eyebrow">
            <Link href="/">Orkestr</Link>
            <span className="pill">Example trip</span>
          </p>
          <h1 className="trip-title">Tokyo</h1>
          <p className="faint">1–8 Dec · a family of seven, none of them real</p>
        </div>
      </header>

      <p className="notice notice-soft">
        An example, so you can see how Orkestr behaves when a real group changes their plans.
        Nobody here is a real person. Your own trips are separate —{" "}
        <Link href="/new">plan one</Link>.
      </p>

      <ExampleClient initialTab={section} />
    </div>
  );
}
