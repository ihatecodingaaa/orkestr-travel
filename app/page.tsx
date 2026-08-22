import { HomeClient } from "@/ui/trip/HomeClient";

/**
 * Home.
 *
 * A client component, because the trips it lists live in the browser. The
 * previous home page -- the subsystem provenance board -- moved to `/sources`.
 * It was honest and it was the wrong thing to lead with: it taught the engine
 * before showing the product.
 */
export default function HomePage() {
  return <HomeClient />;
}
