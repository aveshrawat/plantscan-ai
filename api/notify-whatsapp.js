export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  return res.status(200).json({
    ok: true,
    mode: "demo-hook",
    delivered: false,
    provider: "not_configured",
    message: "WhatsApp message prepared only. Connect Meta/Twilio/Interakt credentials for true API delivery."
  });
}
