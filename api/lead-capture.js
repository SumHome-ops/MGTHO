const AC_BASE   = process.env.AC_BASE_URL || "https://eavesrealtygroup.api-us1.com";
const AC_KEY    = process.env.AC_API_KEY;
const AC_LIST_ID = "5";

const TAG_IDS = {
  "book-lead":               18,
  "book-purchased":          19,
  "lead-magnet-checklist":   20,
  "lead-magnet-calculator":  21,
  "lead-magnet-scorecard":   22,
  "lead-magnet-downpayment": 23,
  "lead-magnet-mistakes":    24,
  "nurture-welcome-sent":    25,
  "nurture-complete":        26,
  "reengagement-sent":       27,
  "buyer-ready":             28,
  "dfwlocal":                29,
  "score-cold":              30,
  "score-warm":              31,
  "score-hot":               32,
  "MGTHO":                   11,
};

const FIELD_IDS = {
  leadSource: 1, leadScore: 2, leadMagnet: 3,
  homebuyerStage: 4, dfwResident: 5, bookPurchased: 6,
};

async function acFetch(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Api-Token": AC_KEY, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${AC_BASE}/api/3${path}`, opts);
  return res.json();
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { firstName, lastName = "", email, leadSource, leadMagnet, dfwLocal = false, phone = "" } = req.body || {};

  if (!email || !firstName) return res.status(400).json({ error: "firstName and email are required" });

  try {
    const syncResult = await acFetch("/contact/sync", "POST", {
      contact: {
        email, firstName, lastName, phone,
        fieldValues: [
          { field: String(FIELD_IDS.leadSource),     value: leadSource || "" },
          { field: String(FIELD_IDS.leadMagnet),     value: leadMagnet || "" },
          { field: String(FIELD_IDS.leadScore),      value: "10" },
          { field: String(FIELD_IDS.homebuyerStage), value: "Researching" },
          { field: String(FIELD_IDS.dfwResident),    value: dfwLocal ? "1" : "0" },
          { field: String(FIELD_IDS.bookPurchased),  value: "0" },
        ],
      },
    });

    const contactId = syncResult.contact?.id;
    if (!contactId) return res.status(500).json({ error: "Failed to create contact", detail: syncResult });

    await acFetch("/contactLists", "POST", {
      contactList: { list: AC_LIST_ID, contact: contactId, status: "1" },
    });

    const magnetTagMap = {
      checklist: "lead-magnet-checklist", calculator: "lead-magnet-calculator",
      scorecard: "lead-magnet-scorecard", downpayment: "lead-magnet-downpayment",
      mistakes: "lead-magnet-mistakes",
    };

    const tagsToApply = ["book-lead", "MGTHO", "score-cold"];
    if (leadMagnet && magnetTagMap[leadMagnet]) tagsToApply.push(magnetTagMap[leadMagnet]);
    if (dfwLocal) tagsToApply.push("dfwlocal");

    for (const tagName of tagsToApply) {
      const tagId = TAG_IDS[tagName];
      if (tagId) {
        await acFetch("/contactTags", "POST", {
          contactTag: { contact: contactId, tag: String(tagId) },
        });
      }
    }

    return res.status(200).json({ success: true, contactId, message: "Lead captured successfully" });

  } catch (err) {
    console.error("lead-capture error:", err);
    return res.status(500).json({ error: "Internal error", detail: err.message });
  }
};
