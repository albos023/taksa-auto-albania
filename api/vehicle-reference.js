export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const market = String(req.query.market || "germany").toLowerCase();
  const isKorea = market === "korea";
  const apiKey = isKorea ? process.env.ENCAR_API_KEY : process.env.APISH_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: isKorea ? "Lidhja me tregun e Korese se Jugut nuk eshte aktivizuar ende." : "Lidhja me mobile.de nuk eshte aktivizuar ende." });
  }

  const make = String(req.query.make || "").trim().slice(0, 60);
  const model = String(req.query.model || "").trim().slice(0, 80);
  const year = Number(req.query.year);
  const cc = Number(req.query.cc);
  const mileage = Number(req.query.mileage || 0);
  const fuel = String(req.query.fuel || "").toUpperCase();

  if (!make || !model || !Number.isInteger(year) || year < 1980 || year > new Date().getFullYear() ||
      !Number.isFinite(cc) || cc < 500 || cc > 10000 ||
      !["DIESEL", "PETROL", "HYBRID", "ELECTRICITY", "LPG"].includes(fuel) ||
      !Number.isFinite(mileage) || mileage < 0 || mileage > 1000000) {
    return res.status(400).json({ error: "Te dhenat e automjetit nuk jane te vlefshme." });
  }

  if (isKorea) {
    const params = new URLSearchParams({
      q: make + " " + model,
      yearFrom: String(Math.max(1980, year - 1)),
      yearTo: String(Math.min(new Date().getFullYear(), year + 1)),
      fuel: ({ DIESEL: "diesel", PETROL: "gasoline", HYBRID: "hybrid", ELECTRICITY: "electric", LPG: "lpg" })[fuel],
      count: "100",
      sort: "priceAsc"
    });
    if (mileage > 0) {
      params.set("mileageFrom", String(Math.max(0, mileage - 60000)));
      params.set("mileageTo", String(mileage + 60000));
    }
    try {
      const upstream = await fetch("https://api.encar-api.com/api/cars?" + params.toString(), {
        headers: { "x-api-key": apiKey, "Accept": "application/json" }
      });
      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).json({
        error: upstream.status === 429 ? "U arrit kufiri ditor i kerkimeve ne Encar API." : "Burimi Encar nuk ktheu rezultat. Kontrollo te dhenat ose provo perseri."
      });
      const rows = Array.isArray(payload.results) ? payload.results : [];
      const parsed = rows.map((x) => {
        const raw = x.Price ?? x.price ?? x.price_eur ?? x.priceEur;
        const rawNum = Number(String(raw ?? "").replace(/[^0-9.]/g, ""));
        const price = x.price_eur != null ? Number(x.price_eur) : x.priceEur != null ? Number(x.priceEur) : rawNum * 6.7;
        const rawYear = x.FormYear ?? x.formYear ?? x.Year ?? x.year;
        const yearMatch = String(rawYear ?? "").match(/(19|20)\\d{2}/);
        const listingYear = yearMatch ? Number(yearMatch[0]) : null;
        const listingMileage = Number(x.Mileage ?? x.mileage ?? 0);
        const title = String(x.en?.manufacturer || x.Manufacturer || make) + " " + String(x.en?.model || x.Model || model) + " " + String(x.en?.badge || x.Badge || "");
        return { title: title.trim(), price_eur: price, year: listingYear, mileage: listingMileage, url: x.url || x.detailUrl || "" };
      }).filter(x => Number.isFinite(x.price_eur) && x.price_eur > 500 && (!x.year || Math.abs(x.year-year)<=1) && (!mileage || !x.mileage || Math.abs(x.mileage-mileage)<=70000));
      if (!parsed.length) return res.status(404).json({ error: "Nuk u gjeten njoftime te krahasueshme ne Encar per kete marke/model/vit." });
      const prices=parsed.map(x=>x.price_eur).sort((a,b)=>a-b);
      const median=prices.length%2?prices[(prices.length-1)/2]:(prices[prices.length/2-1]+prices[prices.length/2])/2;
      return res.status(200).json({source:"Encar API",market:"South Korea",currency:"EUR",sample_count:prices.length,median_eur:Math.round(median),min_eur:Math.round(prices[0]),max_eur:Math.round(prices[prices.length-1]),listings:parsed.slice(0,5)});
    } catch (error) {
      return res.status(502).json({ error: "Gabim gjate lidhjes me tregun e Korese se Jugut." });
    }
  }

  const params = new URLSearchParams({
    make,
    model,
    min_year: String(Math.max(1980, year - 1)),
    max_year: String(Math.min(new Date().getFullYear(), year + 1)),
    min_cubic_capacity: String(Math.max(500, cc - 250)),
    max_cubic_capacity: String(Math.min(10000, cc + 250)),
    fuel,
    condition: "USED",
    sort: "relevance",
    page: "1"
  });
  if (mileage > 0) {
    params.set("min_mileage", String(Math.max(0, mileage - 50000)));
    params.set("max_mileage", String(mileage + 50000));
  }

  try {
    const upstream = await fetch("https://api.api.sh/mobilede/v1/search?" + params.toString(), {
      headers: { "x-api-key": apiKey, "Accept": "application/json" }
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({
        error: payload.error || "Burimi i çmimeve nuk ktheu rezultat."
      });
    }

    const rows = Array.isArray(payload.listings) ? payload.listings : [];
    const parsed = rows.map((x) => {
      const rawPrice = x.price_eur ?? x.price_value ?? x.price ?? x.consumer_price_gross ?? x.consumerPriceGross;
      const price = typeof rawPrice === "number" ? rawPrice :
        (typeof rawPrice === "string" ? Number(rawPrice.replace(/[^0-9,.]/g, "").replace(",", ".")) :
        Number(rawPrice?.consumerPriceGross ?? rawPrice?.consumer_price_amount ?? rawPrice?.amount ?? rawPrice?.value));
      const rawYear = x.year ?? x.first_registration_year ?? x.first_registration ?? x.firstRegistration;
      const matchYear = String(rawYear || "").match(/(19|20)\d{2}/);
      const listingYear = matchYear ? Number(matchYear[0]) : null;
      const listingCc = Number(x.cubic_capacity ?? x.cubicCapacity ?? x.engine_size_cc ?? x.engine_cc ?? 0);
      const listingMileage = Number(x.mileage_km ?? x.mileage ?? 0);
      const url = x.url ?? x.detail_url ?? x.detailPageUrl ?? "";
      return { title: String(x.title || x.name || (make + " " + model)), price_eur: price, year: listingYear, cc: listingCc, mileage: listingMileage, url };
    }).filter(x => Number.isFinite(x.price_eur) && x.price_eur > 500 &&
      (!x.year || Math.abs(x.year - year) <= 1) &&
      (!x.cc || Math.abs(x.cc - cc) <= 300) &&
      (!mileage || !x.mileage || Math.abs(x.mileage - mileage) <= 60000));

    if (!parsed.length) {
      return res.status(404).json({ error: "Nuk u gjetën njoftime të mjaftueshme për këtë konfigurim. Provo një model/version më të përgjithshëm ose vendos çmimin manualisht." });
    }

    const prices = parsed.map(x => x.price_eur).sort((a, b) => a - b);
    const median = prices.length % 2
      ? prices[(prices.length - 1) / 2]
      : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2;
    return res.status(200).json({
      source: "mobile.de",
      market: "Germany",
      currency: "EUR",
      sample_count: prices.length,
      median_eur: Math.round(median),
      min_eur: Math.round(prices[0]),
      max_eur: Math.round(prices[prices.length - 1]),
      credits_used: payload.credits_used ?? null,
      listings: parsed.slice(0, 5)
    });
  } catch (error) {
    return res.status(502).json({ error: "Gabim gjatë lidhjes me burimin e çmimeve." });
  }
}
