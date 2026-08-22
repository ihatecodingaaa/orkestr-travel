import Link from "next/link";
import { ExampleClient } from "@/ui/trip/ExampleClient";

/**
 * The Tokyo example.
 *
 * Renders through the SAME components as a trip somebody creates. A separate
 * showcase interface would mean maintaining two products and demonstrating the
 * wrong one.
 */
export default function ExamplePage() {
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

      <ExampleClient />
    </div>
  );
}
