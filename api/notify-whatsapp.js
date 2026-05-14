// Lightweight WhatsApp notification hook for V1 demos.
// Without a WhatsApp Business provider token, this endpoint returns a prefilled wa.me URL.
// For production, wire this to Meta WhatsApp Cloud API, Twilio, Interakt, Gupshup, or 360dialog.

function cleanPhone(phone = "") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.startsWith("91") ? digits : `91${digits.slice(-10)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { to = "+918799765307", message = "GreenOps notification" } = req.body || {};
    const phone = cleanPhone(to);
    if (!phone) return res.status(400).json({ error: "Valid WhatsApp number required" });
    const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    return res.status(200).json({
      ok: true,
      mode: "demo_link",
      status: "ready",
      to,
      waUrl,
      note: "Demo mode only. Add a WhatsApp Business API provider for automatic delivery."
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "WhatsApp notification failed" });
  }
}
