import { notFound } from "next/navigation";
import { ExampleShell } from "@/ui/trip/ExampleShell";
import type { ExampleSection } from "@/ui/trip/ExampleClient";

/**
 * One example section, at its own URL.
 *
 * The example's screens link to each other the same way a real trip's do, so
 * those links have to resolve. Unknown sections are a 404 rather than a silent
 * fall back to the overview -- quietly showing a different screen than the URL
 * asked for is how a demo appears to work and does not.
 */
const SECTIONS: readonly ExampleSection[] = [
  "overview",
  "explore",
  "plan",
  "group",
  "inbox",
  "whatif",
  "money",
  "activity",
  "people",
];

export function generateStaticParams() {
  return SECTIONS.map((section) => ({ section }));
}

export default async function ExampleSectionPage({
  params,
}: {
  readonly params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const known = SECTIONS.find((candidate) => candidate === section);
  if (known === undefined) notFound();
  return <ExampleShell section={known} />;
}
