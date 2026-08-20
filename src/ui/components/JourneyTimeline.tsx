import type { JourneyDayModel } from "../view/journey";
import { TruthBadge } from "./TruthBadge";

/**
 * One day of the journey.
 *
 * A day where only part of the group has arrived is visually distinct AND says
 * so in words. The domain already refuses to schedule a group event before
 * everybody lands; this is what makes that visible rather than merely true.
 */
export function JourneyDay({ model }: { readonly model: JourneyDayModel }) {
  return (
    <section className="day" data-partial={model.isPartialGroup} aria-label={`Day ${model.dayNumber}`}>
      <header className="day-head">
        <div>
          <p className="eyebrow">Day {model.dayNumber}</p>
          <h3>{model.date}</h3>
        </div>
        <div style={{ textAlign: "right" }}>
          <p className="faint">{model.presentNames.join(", ")}</p>
          {model.isPartialGroup && (
            <p className="day-partial-note">
              Not everyone has arrived yet ({model.presentNames.length} here)
            </p>
          )}
        </div>
      </header>

      <ul className="timeline">
        {model.items.map((item) => (
          <li key={item.id}>
            <span className="item-time">{item.timeLabel}</span>
            <div>
              <p className="item-title">{item.title}</p>
              <div className="item-meta">
                <span className="faint">{item.typeLabel}</span>
                <TruthBadge model={item.statusBadge} />
                {item.assumptionNote !== undefined && (
                  <span className="assumption">{item.assumptionNote}</span>
                )}
              </div>
              <p className="item-people">
                {item.isWholeGroup ? "Everyone" : item.travellerNames.join(", ")}
                {item.locationLabel !== undefined && ` · ${item.locationLabel}`}
              </p>
              {item.note !== undefined && <p className="faint">{item.note}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
