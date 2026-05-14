export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { phone, message } = req.body || {};
  const clean = String(phone || "+918799765307").replace(/\D/g, "");
  const waUrl = `https://wa.me/${clean}?text=${encodeURIComponent(message || "")}`;
  return res.status(200).json({ status: "ready", mode: "demo_link", waUrl });
}
