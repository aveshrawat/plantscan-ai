export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, message, ticketId = "", type = "greenops_update" } = req.body || {};
  const cleanTo = String(to || "").replace(/[^0-9]/g, "");
  const body = String(message || "GreenOps ITSM notification").slice(0, 4000);
  if (!cleanTo) return res.status(400).json({ ok: false, delivered: false, error: "Missing WhatsApp recipient number" });

  const token = process.env.META_WHATSAPP_TOKEN || process.env.WHATSAPP_TOKEN || "";
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || "";

  if (!token || !phoneNumberId) {
    return res.status(200).json({
      ok: true,
      delivered: false,
      mode: "provider_not_configured",
      provider: "meta_whatsapp_cloud_api",
      to: `+${cleanTo}`,
      ticketId,
      type,
      message: "WhatsApp dispatch was triggered by the app, but provider credentials are not configured in Vercel. Add META_WHATSAPP_TOKEN and META_WHATSAPP_PHONE_NUMBER_ID for real automatic delivery."
    });
  }

  try {
    const response = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanTo,
        type: "text",
        text: { preview_url: false, body }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) return res.status(200).json({ ok: false, delivered: false, mode: "provider_error", provider: "meta_whatsapp_cloud_api", error: data.error?.message || "WhatsApp provider failed", providerResponse: data });
    return res.status(200).json({ ok: true, delivered: true, mode: "sent", provider: "meta_whatsapp_cloud_api", providerResponse: data });
  } catch (error) {
    return res.status(200).json({ ok: false, delivered: false, mode: "provider_error", provider: "meta_whatsapp_cloud_api", error: error?.message || "WhatsApp dispatch failed" });
  }
}
