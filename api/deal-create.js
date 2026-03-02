const HS_TOKEN = process.env.HUBSPOT_API_KEY;
const HS_BASE  = "https://api.hubapi.com";
const DEAL_STAGE = "appointmentscheduled";

async function hsFetch(path, method = "GET", body = null) {
  const opts = {
    method,
    headers: { "Authorization": `Bearer ${HS_TOKEN}`, "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${HS_BASE}${path}`, opts);
  return res.json();
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { firstName = "", lastName = "", email, phone = "", leadSource = "", leadMagnet = "", leadScore = 0, acContactId = "" } = req.body || {};
  if (!email) return res.status(400).json({ error: "email is required" });

  try {
    let contactRes = await hsFetch("/crm/v3/objects/contacts", "POST", {
      properties: { email, firstname: firstName, lastname: lastName, phone, hs_lead_status: "IN_PROGRESS" },
    });

    let contactId = contactRes.id;
    if (!contactId) {
      const searchRes = await hsFetch("/crm/v3/objects/contacts/search", "POST", {
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      });
      contactId = searchRes.results?.[0]?.id;
    }

    if (!contactId) return res.status(500).json({ error: "Could not create or find HubSpot contact" });

    const dealName = `${firstName} ${lastName} — Book Lead (Score: ${leadScore})`.trim();
    const dealRes = await hsFetch("/crm/v3/objects/deals", "POST", {
      properties: {
        dealname: dealName,
        dealstage: DEAL_STAGE,
        pipeline: "default",
        description: `Lead magnet: ${leadMagnet} | AC ID: ${acContactId} | Score: ${leadScore} | Source: ${leadSource}`,
        amount: "16.97",
        closedate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      },
    });

    const dealId = dealRes.id;
    if (!dealId) return res.status(500).json({ error: "Could not create HubSpot deal", detail: dealRes });

    await hsFetch(`/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/deal_to_contact`, "PUT");

    return res.status(200).json({ success: true, contactId, dealId, dealName });

  } catch (err) {
    console.error("deal-create error:", err);
    return res.status(500).json({ error: "Internal error", detail: err.message });
  }
};
