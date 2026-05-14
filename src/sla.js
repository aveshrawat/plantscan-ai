import { SLA_RULES, STATUS } from "./config.js";
import { fmtHours, hoursBetween } from "./utils.js";

export const slaRule = priority => SLA_RULES[priority] || SLA_RULES.P3;
export function slaState(ticket, at = new Date().toISOString()) {
  const rule = slaRule(ticket.priority);
  const paused = ticket.status === STATUS.PAUSED || ticket.slaPaused || ticket.slaPausedAt;
  const effectiveAt = ticket.closedAt || (paused && ticket.slaPausedAt) || at;
  const age = hoursBetween(ticket.createdAt, effectiveAt);
  const responseAge = ticket.startedAt ? hoursBetween(ticket.createdAt, ticket.startedAt) : age;
  if (paused && ticket.status !== STATUS.CLOSED) {
    return { label: "SLA Paused", ageHours: age, responseHours: rule.responseHours, closureHours: rule.closureHours, ageLabel: fmtHours(age), breached: false, paused: true, pausedLabel: ticket.slaPausedAt ? fmtHours(hoursBetween(ticket.slaPausedAt, at)) : "—" };
  }
  const responseBreached = responseAge > rule.responseHours && !ticket.startedAt;
  const closureBreached = age > rule.closureHours && ticket.status !== STATUS.CLOSED;
  const closedBreached = ticket.status === STATUS.CLOSED && age > rule.closureHours;
  let label = "Within SLA";
  if (ticket.status === STATUS.CLOSED) label = closedBreached ? "Closed After Breach" : "Closed Within SLA";
  else if (closureBreached) label = "Closure Breached";
  else if (responseBreached) label = "Response Breached";
  else if (age > rule.closureHours * .75) label = "At Risk";
  return { label, ageHours: age, responseHours: rule.responseHours, closureHours: rule.closureHours, ageLabel: fmtHours(age), breached: label.includes("Breached") || label.includes("After"), paused: false };
}
export const resolutionTime = ticket => ticket.closedAt ? fmtHours(hoursBetween(ticket.createdAt, ticket.closedAt)) : "—";
