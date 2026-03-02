const AC_BASE = process.env.AC_BASE_URL || "https://eavesrealtygroup.api-us1.com";
const AC_KEY  = process.env.AC_API_KEY;

const SCORE_VALUES = {
  email_open: 2, email_click: 5, page_visit: 3,
  video_watch: 8, book_purchase: 30, scorecard_complete: 15,
};

const TAG_IDS = { "score-cold": 30, "score-warm": 31, "score-hot": 32, "buyer-ready": 28, "book-purchased": 19 };
const FIELD_IDS = { leadScore: 2, bookPurchased: 6 };

async function acFetch(path, method = "GET", body = null) {
  const opts = { method, headers: { "Api-Token": AC_KEY, "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${AC_BASE}/api/3${path}`, opts);
  return res.json();
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { contactId, action } = req.body || {};
  if (!contactId || !action) return res.status(400).json({ error: "contactId and action required" });

  const delta = SCORE_VALUES[action];
  if (!delta) return res.status(400).json({ error: "Unknown action" });

  const contact = await acFetch(`/contacts/${contactId}`);
  const scoreField = (contact.contact?.fieldValues || []).find(f => f.field === String(FIELD_IDS.leadScore));
  const currentScore = parseInt(scoreField?.value || "0", 10);
  const newScore = currentScore + delta;

  await acFetch(`/contacts/${contactId}`, "PUT", {
    contact: { fieldValues: [{ field: String(FIELD_IDS.leadScore), value: String(newScore) }] },
  });

  const tier = (s) => s >= 61 ? "score-hot" : s >= 26 ? "score-warm" : "score-cold";
  const prevTier = tier(currentScore);
  const newTier  = tier(newScore);

  if (newTier !== prevTier) {
    const contactTagsRes = await acFetch(`/contacts/${contactId}/contactTags`);
    const oldEntry = (contactTagsRes.contactTags || []).find(ct => ct.tag === String(TAG_IDS[prevTier]));
    if (oldEntry) await acFetch(`/contactTags/${oldEntry.id}`, "DELETE");
    await acFetch("/contactTags", "POST", { contactTag: { contact: contactId, tag: String(TAG_IDS[newTier]) } });
  }

  if (newTier === "score-hot") {
    await acFetch("/contactTags", "POST", { contactTag: { contact: contactId, tag: String(TAG_IDS["buyer-ready"]) } });
  }

  if (action === "book_purchase") {
    await acFetch(`/contacts/${contactId}`, "PUT", {
      contact: { fieldValues: [{ field: String(FIELD_IDS.bookPurchased), value: "1" }] },
    });
    await acFetch("/contactTags", "POST", { contactTag: { contact: contactId, tag: String(TAG_IDS["book-purchased"]) } });
  }

  return res.status(200).json({ success: true, contactId, previousScore: currentScore, newScore, tier: newTier });
};
