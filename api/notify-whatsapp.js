export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { to = "+91-8799765307", message = "GreenOps notification" } = req.body || {};
  return res.status(200).json({
    ok: true,
    mode: "demo-prefilled-link",
    to,
    message,
    whatsappLink: `https://wa.me/${String(to).replace(/\D/g, "")}?text=${encodeURIComponent(message)}`,
    providerStatus: "Prepared only - not auto sent",
    note: "Connect Meta/Twilio/Interakt credentials for true WhatsApp Business API delivery."
  });
}
