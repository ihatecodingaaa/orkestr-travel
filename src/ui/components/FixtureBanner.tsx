import { CURRENT_DATA_SOURCE, dataSourceBanner } from "../view/truth";

/**
 * The persistent data-source banner.
 *
 * Always visible, never a tooltip. Somebody watching a demo has to be able to
 * see at any moment that the flights and prices are not real, without hovering
 * anything or being told.
 *
 * It renders whichever mode the build is in. Today only LOCAL_FIXTURE is
 * reachable; the other modes exist in the model so that connecting a real
 * provider later changes one constant rather than the layout.
 */
export function FixtureBanner() {
  const banner = dataSourceBanner(CURRENT_DATA_SOURCE);
  return (
    <div className="fixture-banner" role="note" aria-label="Data source notice">
      <strong>{banner.label}</strong>
      <span>{banner.detail}</span>
    </div>
  );
}
