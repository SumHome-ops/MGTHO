const AC_BASE = process.env.AC_BASE_URL || "https://eavesrealtygroup.api-us1.com";
const AC_KEY  = process.env.AC_API_KEY;

const SCORE_VALUES = {
  email_open: 2, email_click: 5, page_visit: 3,
  video_watch: 8, book_purchase: 30, scorecard_complete: 15,
};

const TAG_IDS = { "score-cold": 30, "score-warm": 31, "score-hot": 32, "buyer-ready": 28, "book-purchased": 19 };
const SCORE_FIELD_ID = "2";
const BOOK_PURCHASED_FIELD_ID = "6";

async function acFetch(path, method = "GET", body = null) {
  const opts = { method, headers: { "Api-Token": AC_KEY, "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${AC_BASE}/api/3${path}`, opts);
  return res.json();
}

const tier = (s) => s >= 61 ? "score-hot" : s >= 26 ? "score-warm" : "score-cold";

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { contactId, action } = req.body || {};
  if (!contactId || !action) return res.status(400).json({ error: "contactId and action required" });

  const delta = SCORE_VALUES[action];
  if (!delta) return res.status(400).json({ error: "Unknown action" });

  // Read field values from the correct AC endpoint
  const fvRes = await acFetch(`/contacts/${contactId}/fieldValues`);
  const fieldValues = fvRes.fieldValues || [];

  const scoreFV       = fieldValues.find(f => f.field === SCORE_FIELD_ID);
  const bookFV        = fieldValues.find(f => f.field === BOOK_PURCHASED_FIELD_ID);
  const currentScore  = parseInt(scoreFV?.value || "0", 10);
  const newScore      = currentScore + delta;

  // Update score — use PUT /fieldValues/:id if record exists, else create via contact sync
  if (scoreFV?.id) {
    await acFetch(`/fieldValues/${scoreFV.id}`, "PUT", {
      fieldValue: { contact: String(contactId), field: SCORE_FIELD_ID, value: String(newScore) },
    });
  } else {
    await acFetch("/contact/sync", "POST", {
      contact: { id: contactId, fieldValues: [{ field: SCORE_FIELD_ID, value: String(newScore) }] },
    });
  }

  const prevTier = tier(currentScore);
  const newTier  = tier(newScore);

  // Swap score tier tags if tier changed
  if (newTier !== prevTier) {
    const contactTagsRes = await acFetch(`/contacts/${contactId}/contactTags`);
    const oldEntry = (contactTagsRes.contactTags || []).find(ct => ct.tag === String(TAG_IDS[prevTier]));
    if (oldEntry) await acFetch(`/contactTags/${oldEntry.id}`, "DELETE");
    await acFetch("/contactTags", "POST", { contactTag: { contact: contactId, tag: String(TAG_IDS[newTier]) } });
  }

  // Tag buyer-ready when hot
  if (newTier === "score-hot" && prevTier !== "score-hot") {
    await acFetch("/contactTags", "POST", { contactTag: { contact: contactId, tag: String(TAG_IDS["buyer-ready"]) } });
  }

  // Handle book purchase
  if (action === "book_purchase") {
    if (bookFV?.id) {
      await acFetch(`/fieldValues/${bookFV.id}`, "PUT", { fieldValue: { value: "1" } });
    }
    await acFetch("/contactTags", "POST", { contactTag: { contact: contactId, tag: String(TAG_IDS["book-purchased"]) } });
  }

  return res.status(200).json({ success: true, contactId, previousScore: currentScore, newScore, tier: newTier });
};
