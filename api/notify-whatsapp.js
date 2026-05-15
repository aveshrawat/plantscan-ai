export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { to = "", message = "" } = req.body || {};
  const digits = String(to || "").replace(/\D/g, "");
  const waUrl = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : "";
  return res.status(200).json({ ok: true, mode: "demo_link", waUrl });
}
