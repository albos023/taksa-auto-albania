export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.XAPI_KOREA_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Lidhja me XAPI Korea nuk eshte konfiguruar." });
  }

  const id = String(req.query.id || "").trim();
  if (!/^\d{6,10}$/.test(id)) {
    return res.status(400).json({ error: "ID e njoftimit Encar nuk eshte e vlefshme." });
  }

  const headers = { "X-API-Key": apiKey, "Accept": "application/json" };
  const base = "https://api.xapikorea.com/v1/cars/" + encodeURIComponent(id);
  try {
    const [inspectionResponse, insuranceResponse] = await Promise.all([
      fetch(base + "/inspection?lang=en", { headers }),
      fetch(base + "/insurance", { headers })
    ]);

    const [inspection, insurance] = await Promise.all([
      inspectionResponse.json().catch(() => ({})),
      insuranceResponse.json().catch(() => ({}))
    ]);

    if (inspectionResponse.status === 401 || inspectionResponse.status === 403 ||
        insuranceResponse.status === 401 || insuranceResponse.status === 403) {
      return res.status(502).json({ error: "XAPI Korea refuzoi autentikimin. Kontrollo API key ose statusin e llogarise." });
    }
    if (inspectionResponse.status === 429 || insuranceResponse.status === 429) {
      return res.status(429).json({ error: "U arrit limiti i kerkimeve XAPI Korea. Provo me vone." });
    }
    if (inspectionResponse.status === 404 && insuranceResponse.status === 404) {
      return res.status(404).json({ error: "Njoftimi Encar nuk u gjet ose eshte hequr nga platforma." });
    }

    return res.status(200).json({
      source: "XAPI Korea / Encar",
      listing_id: id,
      inspection: inspectionResponse.ok ? inspection : { available: false, error: "Raporti i inspektimit nuk u gjet." },
      insurance: insuranceResponse.ok ? insurance : { available: false, error: "Raporti i sigurimit nuk u gjet." },
      partial: !inspectionResponse.ok || !insuranceResponse.ok
    });
  } catch (error) {
    return res.status(502).json({ error: "Gabim gjate lidhjes me XAPI Korea. Provo perseri." });
  }
}
