import { ExampleShell } from "@/ui/trip/ExampleShell";

/**
 * The Tokyo example.
 *
 * Renders through the SAME components as a trip somebody creates. A separate
 * showcase interface would mean maintaining two products and demonstrating the
 * wrong one.
 */
export default function ExamplePage() {
  return <ExampleShell section="overview" />;
}
