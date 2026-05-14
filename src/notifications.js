import { uid, nowIso } from "./utils.js";

export const WHATSAPP_DEMO_NUMBER = "918799765307";

export function whatsappLink(message = "", phone = WHATSAPP_DEMO_NUMBER) {
  const cleanPhone = String(phone || WHATSAPP_DEMO_NUMBER).replace(/\D/g, "") || WHATSAPP_DEMO_NUMBER;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}

function ticketLabel(ticket = {}) {
  return ticket.ticketNo ? `#${String(ticket.ticketNo).padStart(6, "0").slice(-6)}` : ticket.id || "ticket";
}

function safeSiteName(d, siteId) {
  return d.sites?.find(site => site.id === siteId)?.name || "site";
}

export function addNotification(d, notification = {}) {
  d.notifications ||= [];
  const message = notification.message || notification.title || "GreenOps notification";
  const item = {
    id: uid("ntf"),
    ticketId: notification.ticketId || "",
    siteId: notification.siteId || "",
    type: notification.type || "info",
    audience: notification.audience || "operations",
    title: notification.title || "GreenOps update",
    message,
    channel: notification.channel || "WhatsApp demo link",
    providerStatus: notification.providerStatus || "Prepared only - not auto sent",
    whatsappLink: notification.whatsappLink || whatsappLink(message, notification.phone),
    createdAt: notification.createdAt || nowIso(),
    read: false
  };
  d.notifications.push(item);
  return item;
}

export function logClientTicketNotifications(d, ticket = {}) {
  if (!ticket?.id) return [];
  const siteName = safeSiteName(d, ticket.siteId);
  const label = ticketLabel(ticket);
  return [
    addNotification(d, {
      ticketId: ticket.id,
      siteId: ticket.siteId,
      type: "client_ticket_confirmation",
      audience: "client",
      title: `Ticket ${label} raised`,
      message: `GreenOps confirmation: Priority ${ticket.priority || "P1"} ticket ${label} has been raised for ${siteName}. Issue: ${ticket.issue || "Client concern"}. The operations team will review it as per SLA.`
    }),
    addNotification(d, {
      ticketId: ticket.id,
      siteId: ticket.siteId,
      type: "supervisor_p1_alert",
      audience: "supervisor",
      title: `P1 alert ${label}`,
      message: `GreenOps alert: Client-raised ${ticket.priority || "P1"} ticket ${label} for ${siteName}. Issue: ${ticket.issue || "Client concern"}. Please assign, start, and close with evidence.`
    })
  ];
}

export function logTicketProgressNotification(d, ticket = {}) {
  if (!ticket?.id) return null;
  const siteName = safeSiteName(d, ticket.siteId);
  const label = ticketLabel(ticket);
  return addNotification(d, {
    ticketId: ticket.id,
    siteId: ticket.siteId,
    type: "ticket_in_progress",
    audience: ticket.source === "Client" ? "client" : "operations",
    title: `Ticket ${label} in progress`,
    message: `GreenOps update: Ticket ${label} for ${siteName} has moved to In Progress.`
  });
}

export function logTicketClosureNotification(d, ticket = {}) {
  if (!ticket?.id) return null;
  const siteName = safeSiteName(d, ticket.siteId);
  const label = ticketLabel(ticket);
  return addNotification(d, {
    ticketId: ticket.id,
    siteId: ticket.siteId,
    type: "ticket_closed",
    audience: ticket.source === "Client" ? "client" : "operations",
    title: `Ticket ${label} closed`,
    message: `GreenOps closure: Ticket ${label} for ${siteName} has been closed with evidence.`
  });
}

export function visibleNotifications(db = {}, siteIds = [], audience = "all") {
  const allowed = Array.isArray(siteIds) && siteIds.length ? new Set(siteIds) : null;
  return (db.notifications || [])
    .filter(n => (!allowed || allowed.has(n.siteId)) && (audience === "all" || n.audience === audience))
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
