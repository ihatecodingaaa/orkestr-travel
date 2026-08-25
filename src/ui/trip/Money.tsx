"use client";

import { useState } from "react";
import type { ConsumerTrip } from "@/domain/consumerTrip";
import { BUDGET_CATEGORIES, budgetLabel } from "@/domain/livingTrip";
import { summariseBudget } from "@/core/trips/living";
import type { TripActions } from "./actions";

/**
 * Money, and what Orkestr does on its own.
 *
 * THE BUDGET IS ENTIRELY HAND-ENTERED. There is no pricing data in this build,
 * and a number Orkestr produced for "food in Tokyo" would be a confident,
 * precise, unverifiable fabrication -- the exact thing this codebase refuses
 * everywhere else. Every figure here was typed by a person and the screen says
 * so, and a category nobody has estimated shows as unestimated rather than
 * being quietly filled in.
 *
 * The group total is per-person multiplied by however many people are on the
 * trip. That is arithmetic somebody can check, not a model.
 */
export function Money({
  trip,
  actions,
  viewerId,
}: {
  readonly trip: ConsumerTrip;
  readonly actions: TripActions;
  readonly viewerId: string;
}) {
  const summary = summariseBudget(trip);
  const [currency, setCurrency] = useState(trip.budget.currency ?? "");

  const viewer = trip.travellers.find((t) => t.id === viewerId);
  const privateBudgets = trip.travellers.filter((traveller) =>
    traveller.requirements.some((r) => r.private),
  );

  const money = (value: number): string =>
    summary.currency === undefined
      ? String(value)
      : `${summary.currency} ${value.toLocaleString("en-GB")}`;

  return (
    <div className="stack gap-3">
      <div className="stack gap-1">
        <h2>What this might cost</h2>
        <p className="faint">
          Orkestr has no pricing data, so nothing here is a quote. These are your group&rsquo;s own
          estimates.
        </p>
      </div>

      <section className="panel stack gap-2">
        <div className="field-row">
          <div className="field">
            <label htmlFor="currency">Currency</label>
            <input
              id="currency"
              className="input input-small"
              placeholder="SGD"
              maxLength={3}
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value.toUpperCase());
                if (/^[A-Za-z]{3}$/.test(e.target.value)) {
                  void actions.setCurrency(e.target.value);
                }
              }}
            />
          </div>
        </div>

        <ul className="budget-list">
          {BUDGET_CATEGORIES.map((category) => {
            const current = lineFor(trip, category);
            return (
              <li key={category} className="budget-row">
                <label htmlFor={`b-${category}`}>{budgetLabel(category)}</label>
                <input
                  id={`b-${category}`}
                  className="input input-small"
                  inputMode="numeric"
                  placeholder="—"
                  value={current === undefined ? "" : String(current)}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const parsed = raw === "" ? undefined : Number(raw);
                    /**
                     * An empty box CLEARS the estimate rather than setting zero.
                     * Zero claims a category is free; absent admits nobody has
                     * worked it out.
                     */
                    if (raw !== "" && (!Number.isFinite(parsed) || (parsed ?? -1) < 0)) return;
                    void actions.setBudgetLine(category, parsed);
                  }}
                />
                <span className="faint">
                  {current === undefined ? "not estimated" : "per person"}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="budget-total">
          <div>
            <span className="stat-value">{money(summary.perPerson)}</span>
            <span className="stat-label">each</span>
          </div>
          <div>
            <span className="stat-value">{money(summary.groupTotal)}</span>
            <span className="stat-label">
              for {summary.travellerCount}{" "}
              {summary.travellerCount === 1 ? "person" : "people"}
            </span>
          </div>
        </div>

        <p className="faint">
          {summary.estimatedCategories} of {BUDGET_CATEGORIES.length} categories estimated.{" "}
          {summary.estimatedCategories < BUDGET_CATEGORIES.length &&
            "The rest are blank — Orkestr will not guess them."}
        </p>
      </section>

      {privateBudgets.length > 0 && (
        <section className="panel stack gap-1">
          <h3>Private limits</h3>
          {/*
            The group is told a limit exists and never what it is. Only its
            owner sees the number, and only when they are the one looking.
          */}
          <p>
            {privateBudgets.length}{" "}
            {privateBudgets.length === 1 ? "person has" : "people have"} something private about
            money or how they travel. Orkestr checks the plan against{" "}
            {privateBudgets.length === 1 ? "it" : "them"} without showing anyone the details.
          </p>
          {viewer !== undefined &&
            viewer.requirements
              .filter((r) => r.private)
              .map((requirement) => (
                <p key={requirement.id} className="requirement private">
                  🔒 Yours: {requirement.text}
                </p>
              ))}
        </section>
      )}

      {/* ------------------------------------------------------- autopilot */}
      <section className="panel stack gap-2">
        <div className="stack gap-1">
          <h2>What Orkestr does on its own</h2>
          <p className="faint">
            How Orkestr handles changes to this trip. It works these out when you open the trip,
            not while you are away.
          </p>
        </div>

        <ul className="switch-list">
          <Switch
            label="Point out facts that have gone stale"
            detail="Flight prices and availability go out of date quickly."
            on={trip.autopilot.flagStaleFacts}
            onChange={(value) => void actions.setAutopilot({ flagStaleFacts: value })}
          />
          <Switch
            label="Suggest a repair when something changes"
            detail="Rather than waiting to be asked."
            on={trip.autopilot.suggestRepairs}
            onChange={(value) => void actions.setAutopilot({ suggestRepairs: value })}
          />
          <Switch
            label="Never move things you have fixed"
            detail="Anything marked fixed stays put unless nothing else works."
            on={trip.autopilot.preserveFixedItems}
            onChange={(value) => void actions.setAutopilot({ preserveFixedItems: value })}
          />
        </ul>

        {/*
          Two rules that are not switches, because offering to turn them off
          would be offering to break the product's central promise.
        */}
        <div className="locked-rules">
          <p>
            <strong>Always on, and not adjustable:</strong>
          </p>
          <ul className="tick-list">
            <li>A required constraint is never relaxed to make a plan work.</li>
            <li>Only the person a compromise belongs to can accept it.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function lineFor(trip: ConsumerTrip, category: (typeof BUDGET_CATEGORIES)[number]): number | undefined {
  return trip.budget.lines.find((line) => line.category === category)?.perPerson;
}

function Switch({
  label,
  detail,
  on,
  onChange,
}: {
  readonly label: string;
  readonly detail: string;
  readonly on: boolean;
  readonly onChange: (value: boolean) => void;
}) {
  return (
    <li className="switch-row">
      <label>
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <strong>{label}</strong>
          <span className="faint"> {detail}</span>
        </span>
      </label>
    </li>
  );
}
