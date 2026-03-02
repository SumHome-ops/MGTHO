/**
 * MGTHO Sequence Runner — Daily Cron
 * Fires daily at 9:00 AM CT via Vercel Cron.
 * Finds contacts at each day milestone, sends the right email via AC campaign API.
 *
 * Logic:
 *   1. Get all contacts with tag "book-lead" on List 5
 *   2. For each contact, calculate days since subscribe
 *   3. Determine which email they need (if any) based on milestone + sent tags
 *   4. Group contacts → subscribe to queue list → create campaign → schedule → clean up
 */

const AC_BASE     = process.env.AC_BASE_URL || "https://eavesrealtygroup.api-us1.com";
const AC_KEY      = process.env.AC_API_KEY;
const AC_LIST_ID  = "5";
const BOOK_LEAD_TAG_ID = "18";
const PURCHASED_TAG_ID = "19";

// ── IDs created by setup-ac.js ────────────────────────────────────────────────
// Queue list: a temporary holding list used while a campaign is being sent.
// Tag IDs: mark that a contact has already received a given email.
const QUEUE_LIST_ID = process.env.MGTHO_QUEUE_LIST_ID || "8";
const TAG_IDS = {
  "mgtho-email-1-sent": process.env.TAG_EMAIL_1 || "33",
  "mgtho-email-2-sent": process.env.TAG_EMAIL_2 || "34",
  "mgtho-email-3-sent": process.env.TAG_EMAIL_3 || "35",
  "mgtho-email-4-sent": process.env.TAG_EMAIL_4 || "36",
  "mgtho-email-5-sent": process.env.TAG_EMAIL_5 || "37",
  "mgtho-email-6-sent": process.env.TAG_EMAIL_6 || "38",
  "mgtho-email-7-sent": process.env.TAG_EMAIL_7 || "39",
  "mgtho-re-1-sent":    process.env.TAG_RE_1    || "40",
  "mgtho-re-2-sent":    process.env.TAG_RE_2    || "41",
  "mgtho-re-3-sent":    process.env.TAG_RE_3    || "42",
  "mgtho-re-4-sent":    process.env.TAG_RE_4    || "43",
  "mgtho-re-5-sent":    process.env.TAG_RE_5    || "44",
};

// ── Email Schedule ────────────────────────────────────────────────────────────
// Welcome sequence: Days since subscribe contact joined List 5 (book-lead tag)
// Re-engagement: Days since subscribe, after welcome is complete, no purchase
const WELCOME_SCHEDULE = [
  { day: 0,  sentTag: "mgtho-email-1-sent", email: email1() },
  { day: 1,  sentTag: "mgtho-email-2-sent", email: email2() },
  { day: 3,  sentTag: "mgtho-email-3-sent", email: email3() },
  { day: 5,  sentTag: "mgtho-email-4-sent", email: email4() },
  { day: 7,  sentTag: "mgtho-email-5-sent", email: email5() },
  { day: 10, sentTag: "mgtho-email-6-sent", email: email6() },
  { day: 14, sentTag: "mgtho-email-7-sent", email: email7() },
];

// Re-engagement starts day 21 (1 week after nurture ends on day 14)
const REENGAGE_SCHEDULE = [
  { day: 21, sentTag: "mgtho-re-1-sent", email: re1() },
  { day: 24, sentTag: "mgtho-re-2-sent", email: re2() },
  { day: 28, sentTag: "mgtho-re-3-sent", email: re3() },
  { day: 33, sentTag: "mgtho-re-4-sent", email: re4() },
  { day: 38, sentTag: "mgtho-re-5-sent", email: re5() },
];

// ── AC API Helper ─────────────────────────────────────────────────────────────
async function ac(path, method = "GET", body = null) {
  const res = await fetch(`${AC_BASE}/api/3${path}`, {
    method,
    headers: { "Api-Token": AC_KEY, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

// ── Contact Fetching ──────────────────────────────────────────────────────────
async function getAllBookLeads() {
  let contacts = [], offset = 0, limit = 100;
  while (true) {
    const res = await ac(`/contacts?listid=${AC_LIST_ID}&tagid=${BOOK_LEAD_TAG_ID}&limit=${limit}&offset=${offset}`);
    const batch = res.contacts || [];
    contacts.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return contacts;
}

async function getContactTags(contactId) {
  const res = await ac(`/contacts/${contactId}/tags`);
  return (res.contactTags || []).map(t => String(t.tag));
}

// ── Tag Management ────────────────────────────────────────────────────────────
async function addTag(contactId, tagId) {
  return ac("/contactTags", "POST", { contactTag: { contact: String(contactId), tag: String(tagId) } });
}

async function removeTag(contactId, tagId) {
  // Find the contactTag ID first
  const res = await ac(`/contacts/${contactId}/tags`);
  const ct = (res.contactTags || []).find(t => String(t.tag) === String(tagId));
  if (ct) await ac(`/contactTags/${ct.id}`, "DELETE");
}

// ── List Management ───────────────────────────────────────────────────────────
async function subscribeToQueue(contactId) {
  return ac("/contactLists", "POST", {
    contactList: { list: String(QUEUE_LIST_ID), contact: String(contactId), status: "1" },
  });
}

async function unsubscribeFromQueue(contactId) {
  return ac("/contactLists", "POST", {
    contactList: { list: String(QUEUE_LIST_ID), contact: String(contactId), status: "2" },
  });
}

// ── Campaign Creation & Send ──────────────────────────────────────────────────
async function createAndSendCampaign(emailData, batchLabel) {
  const today = new Date().toISOString().slice(0, 10);
  const campaignName = `MGTHO ${emailData.id} - ${today}`;

  // Create campaign targeting the queue list
  const createRes = await ac("/campaigns", "POST", {
    campaign: {
      name: campaignName,
      type: "single",
      status: 1, // active / ready to send
      public: 0,
      tracklinks: "mime-only",
      trackreads: 1,
      listids: String(QUEUE_LIST_ID),
      fromname: "Thomas Eaves",
      fromemail: "thomas@eavesrealtygroup.com",
      replyto: "thomas@eavesrealtygroup.com",
      subject: emailData.subject,
      htmlconstructor: "editor",
      htmltext: emailData.html,
      textconstructor: "editor",
      textmail: emailData.text,
    },
  });

  const campaignId = createRes.campaign?.id;
  if (!campaignId) {
    console.error(`  Failed to create campaign for ${emailData.id}:`, JSON.stringify(createRes));
    return null;
  }

  console.log(`  Campaign created: ID ${campaignId} — "${campaignName}"`);

  // Schedule for immediate send (2 minutes from now)
  const sendAt = new Date(Date.now() + 2 * 60 * 1000);
  const schedDate = sendAt.toISOString().replace("T", " ").slice(0, 19);

  const schedRes = await ac("/campaignschedules", "POST", {
    campaignschedule: {
      campaignid: String(campaignId),
      scheduleddate: schedDate,
      sendtimezone: "America/Chicago",
    },
  });

  console.log(`  Scheduled at ${schedDate} CT`);
  return campaignId;
}

// ── Queue Cleanup ─────────────────────────────────────────────────────────────
// Called at the start of each run to unsubscribe anyone left over from the
// previous day's queue. Contacts are already tagged as "sent" so this is
// purely a housekeeping step.
async function cleanupQueueList() {
  let removed = 0, offset = 0;
  while (true) {
    const res = await ac(`/contacts?listid=${QUEUE_LIST_ID}&limit=100&offset=${offset}`);
    const batch = res.contacts || [];
    if (batch.length === 0) break;
    for (const c of batch) await unsubscribeFromQueue(c.id);
    removed += batch.length;
    if (batch.length < 100) break;
    offset += 100;
  }
  if (removed) console.log(`  Cleaned ${removed} contact(s) from queue list`);
}

// ── Main Cron Logic ───────────────────────────────────────────────────────────
async function processSequence(contacts, schedule, skipIfPurchased = false) {
  const now = Date.now();

  for (const step of schedule) {
    const windowStart = step.day * 86400000;
    const windowEnd   = (step.day + 1) * 86400000; // 24h window
    const sentTagId   = TAG_IDS[step.sentTag];

    // Find contacts at this day milestone
    const eligible = [];
    for (const contact of contacts) {
      const ageMs = now - new Date(contact.cdate).getTime();
      if (ageMs < windowStart || ageMs >= windowEnd) continue;

      const tags = await getContactTags(contact.id);
      if (tags.includes(String(sentTagId))) continue; // already received this email
      if (skipIfPurchased && tags.includes(PURCHASED_TAG_ID)) continue;

      eligible.push(contact);
    }

    if (eligible.length === 0) {
      console.log(`  ${step.sentTag}: 0 contacts at day ${step.day}`);
      continue;
    }

    console.log(`  ${step.sentTag}: ${eligible.length} contact(s) at day ${step.day}`);

    // Tag as sent FIRST (prevents double-sends even if something fails later)
    for (const c of eligible) {
      if (sentTagId) await addTag(c.id, sentTagId);
    }

    // Subscribe to queue list so campaign can target them
    for (const c of eligible) await subscribeToQueue(c.id);

    // Create campaign targeting queue list and schedule for +2 min
    // No sleep needed — queue list cleanup happens at the TOP of the next run
    await createAndSendCampaign(step.email, step.sentTag);
  }
}

// ── Vercel Cron Handler ───────────────────────────────────────────────────────
module.exports = async (req, res) => {
  // Allow manual trigger via POST for testing, cron trigger via GET
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Basic auth for manual POST triggers (prevents accidental public invocation)
  if (req.method === "POST") {
    const auth = req.headers["x-cron-secret"];
    if (auth !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  console.log(`[sequence-runner] Starting — ${new Date().toISOString()}`);

  try {
    // Clean up queue list from previous run first
    console.log("[sequence-runner] Cleaning up queue list...");
    await cleanupQueueList();

    const contacts = await getAllBookLeads();
    console.log(`[sequence-runner] Found ${contacts.length} book-lead contacts`);

    if (contacts.length === 0) {
      return res.status(200).json({ ok: true, message: "No contacts to process" });
    }

    // Welcome sequence (all contacts)
    console.log("\n── Welcome Sequence ──");
    await processSequence(contacts, WELCOME_SCHEDULE, false);

    // Re-engagement sequence (skip if purchased)
    console.log("\n── Re-Engagement Sequence ──");
    await processSequence(contacts, REENGAGE_SCHEDULE, true);

    console.log("\n[sequence-runner] Done.");
    return res.status(200).json({ ok: true, processed: contacts.length });

  } catch (err) {
    console.error("[sequence-runner] Error:", err);
    return res.status(500).json({ error: err.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// EMAIL CONTENT LIBRARY
// Each function returns { id, subject, html, text }
// HTML uses %FIRSTNAME% and %EMAIL% as merge tags (AC replaces these).
// ═════════════════════════════════════════════════════════════════════════════

const BASE_STYLE = `
  <style>
    body { margin: 0; padding: 0; background: #f4f4f4; font-family: Georgia, serif; }
    .wrap { max-width: 600px; margin: 0 auto; background: #ffffff; padding: 40px 40px 32px; }
    p { font-size: 16px; line-height: 1.7; color: #222222; margin: 0 0 18px; }
    a { color: #1a56db; }
    .cta { display: inline-block; background: #1a56db; color: #ffffff !important;
           text-decoration: none; padding: 14px 28px; border-radius: 4px;
           font-size: 16px; font-family: Arial, sans-serif; margin: 8px 0; }
    .sig { border-top: 1px solid #e5e5e5; padding-top: 20px; margin-top: 28px;
           font-size: 14px; color: #555555; line-height: 1.6; }
    .footer { font-size: 12px; color: #999999; margin-top: 32px; line-height: 1.5; }
  </style>`;

function wrap(bodyContent) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">${BASE_STYLE}</head>
<body><div class="wrap">${bodyContent}
<div class="footer">You're receiving this because you opted in at millennialhomebook.com.<br>
<a href="%UNSUBSCRIBELINK%">Unsubscribe</a> &nbsp;|&nbsp; Eaves Realty Group, Dallas-Fort Worth, TX</div>
</div></body></html>`;
}

function email1() {
  return {
    id: "Welcome-1",
    subject: "Here's what you asked for (+ one thing I want you to know)",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>You asked for it. Here it is.</p>
<p><strong>👉 <a href="https://millennialhomebook.com/download">DOWNLOAD YOUR FREE GUIDE HERE</a></strong></p>
<p>No tricks, no hoops. Just click and it's yours.</p>
<p>Now — quick note before you close this email and never open another one from me:</p>
<p>My name is Thomas Eaves. I've been a licensed real estate agent in the Dallas-Fort Worth area for 12 years. I've helped hundreds of people buy their first home, and I've coached 73 other agents on how to do the same.</p>
<p>I wrote <em>Millennials' Guide to Homeownership</em> because I kept watching smart, capable people get completely overwhelmed by a process that doesn't have to be that complicated.</p>
<p>The banks don't explain it. Your parents couldn't afford to either (different market, different rules). And Google just sends you down a rabbit hole of conflicting advice from people who may or may not have your best interests at heart.</p>
<p>So I wrote the book I wish existed when I was starting out.</p>
<p>Over the next two weeks, I'm going to send you a few emails with no-fluff, straight-talk information about buying a home. Some of it will surprise you. Some of it will make you mad. All of it will be useful.</p>
<p>If at any point you're ready to talk to someone about buying in DFW, just reply to this email. I'm a real person and I actually read these.</p>
<div class="sig">Thomas Eaves<br>Eaves Realty Group | Dallas-Fort Worth<br>
📖 <a href="https://www.amazon.com/dp/B0GG6KZ2HR">Millennials' Guide to Homeownership — Amazon</a></div>
<p style="font-size:14px;color:#555;">P.S. — The download link works for 7 days. Don't wait.</p>`),
    text: `Hey %FIRSTNAME%,\n\nYou asked for it. Here it is.\n\nDOWNLOAD YOUR FREE GUIDE: https://millennialhomebook.com/download\n\nMy name is Thomas Eaves. 12 years in DFW real estate. Over the next two weeks I'll share what I know about buying a home — no fluff, no filler.\n\nReply anytime if you have questions.\n\nThomas\nEaves Realty Group | Dallas-Fort Worth\nhttps://www.amazon.com/dp/B0GG6KZ2HR`,
  };
}

function email2() {
  return {
    id: "Welcome-2",
    subject: "The real reason I wrote this book (it's a little embarrassing)",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>I want to tell you something that doesn't make me look particularly smart.</p>
<p>When I got my real estate license at 23, I had been managing a pizza restaurant making $32,000 a year. My first year in real estate, I made $85,000.</p>
<p>That sounds like a success story. And it was — eventually.</p>
<p>But here's what nobody tells you: I spent my first three years helping other people buy homes without fully understanding what I was doing for them. I knew the <em>process</em>. I knew the <em>paperwork</em>. But the deeper financial picture? I was learning right alongside my clients.</p>
<p>I've watched people make $15,000 mistakes because they didn't know to negotiate closing costs. I've watched people buy in neighborhoods that tanked their commute, their sanity, and eventually their marriage. I've watched people get talked into houses they couldn't actually afford because their agent needed the commission.</p>
<p>I've also watched people — people who thought they'd never be able to buy — close on their first home and cry in the driveway.</p>
<p>The difference wasn't luck or income. The difference was information.</p>
<p><em>Millennials' Guide to Homeownership</em> is the book I wish I could've handed every single one of my clients before we started working together. 289 pages of straight talk — everything you actually need to know.</p>
<p><a class="cta" href="https://www.amazon.com/dp/B0GG6KZ2HR">Get the Book on Amazon — $16.97</a></p>
<div class="sig">Thomas<br>Eaves Realty Group | Dallas-Fort Worth</div>
<p style="font-size:14px;color:#555;">P.S. — Tomorrow I'm going to bust the biggest myth in home buying. Hint: if you think you need 20% down, you've been lied to.</p>`),
    text: `Hey %FIRSTNAME%,\n\nWhen I got my real estate license at 23, I was making $32K managing a pizza restaurant. First year in real estate: $85K.\n\nBut I spent my first three years learning alongside my clients — and watched people make $15,000 mistakes for lack of information.\n\nThe difference between buyers who win and buyers who struggle? Information.\n\nGet the book: https://www.amazon.com/dp/B0GG6KZ2HR ($16.97 paperback / $9.99 Kindle)\n\nThomas`,
  };
}

function email3() {
  return {
    id: "Welcome-3",
    subject: "You do NOT need 20% down. Here's the truth.",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>Let me be blunt: the "you need 20% down" rule is one of the most damaging pieces of financial advice circulating right now — and it's keeping people like you renting years longer than necessary.</p>
<p>Here's what's actually available to you <strong>right now</strong>:</p>
<p>
  <strong>Conventional loans:</strong> As little as 3% down<br>
  <strong>FHA loans:</strong> 3.5% down (more lenient on credit)<br>
  <strong>VA loans:</strong> 0% down (veterans)<br>
  <strong>USDA loans:</strong> 0% down (eligible suburban areas)<br>
  <strong>Texas first-time buyer programs:</strong> Often cover down payment AND closing costs
</p>
<p>On a $300,000 house: 20% down = $60,000. That keeps people renting for 5–10 extra years.<br>
3% down = $9,000. Achievable for most people in under 2 years of focused saving.</p>
<p>Does PMI suck? A little. On a $300K loan, PMI runs roughly $100–$200/month. But once you hit 20% equity — through paying down the loan OR home value going up — you request cancellation. Gone.</p>
<p>I break down the entire down payment decision in Chapter 4 — including exactly how to calculate what YOU should put down based on your situation.</p>
<p><a class="cta" href="https://www.amazon.com/dp/B0GG6KZ2HR">Get Millennials' Guide to Homeownership — $16.97</a></p>
<div class="sig">Thomas<br>Eaves Realty Group | Dallas-Fort Worth</div>
<p style="font-size:14px;color:#555;">P.S. — In a few days I'll tell you about the costs that blindside almost every first-time buyer. The purchase price is just the beginning.</p>`),
    text: `Hey %FIRSTNAME%,\n\nThe "20% down" rule is keeping people renting years longer than necessary.\n\nConventional: 3% down. FHA: 3.5%. VA/USDA: 0%. Texas first-time programs cover down payment AND closing costs.\n\nOn a $300K house: 20% = $60,000. 3% = $9,000. Big difference.\n\nChapter 4 of my book covers the full down payment decision for your situation.\n\nhttps://www.amazon.com/dp/B0GG6KZ2HR\n\nThomas`,
  };
}

function email4() {
  return {
    id: "Welcome-4",
    subject: "The $8,000 surprise that blindsides first-time buyers",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>Let's talk about the stuff that doesn't show up in the Zillow listing.</p>
<p>You find a house for $325,000. You calculate your mortgage. You think you know what you're signing up for. Then closing day hits.</p>
<p>Here's what nobody tells first-time buyers upfront:</p>
<p><strong>Closing costs</strong> — Typically 2–5% of the loan. On a $325K purchase: $6,000–$16,000 at closing. Separate from your down payment.</p>
<p><strong>Home inspection</strong> — $300–$600. You pay this before you even close.</p>
<p><strong>Appraisal fee</strong> — $400–$700, required by your lender.</p>
<p><strong>HOA dues</strong> — A lot of DFW neighborhoods have them. $50–$500+/month, non-negotiable.</p>
<p><strong>Immediate repairs/upgrades</strong> — Even "move-in ready" homes: $1,000–$5,000 in the first 90 days.</p>
<p><strong>Property taxes</strong> — Texas has no income tax. The trade-off: some of the highest property taxes in the country. Budget 1.5–2.5% of home value per year.</p>
<p><strong>Add $10,000–$25,000 to whatever you've been budgeting</strong> just to cover transition costs. Not a reason not to buy — a reason to plan properly.</p>
<p>Chapter 6 of the book walks through a complete first-year budget so you know exactly what you're walking into.</p>
<p><a class="cta" href="https://www.amazon.com/dp/B0GG6KZ2HR">Get the Book — No More Surprises</a></p>
<div class="sig">Thomas<br>Eaves Realty Group | Dallas-Fort Worth</div>`),
    text: `Hey %FIRSTNAME%,\n\nClosing costs: $6,000–$16,000. Inspection: $300–$600. Appraisal: $400–$700. HOA, repairs, property taxes...\n\nAdd $10,000–$25,000 to whatever you've been budgeting. Not a reason not to buy — a reason to plan properly.\n\nChapter 6 of my book has a complete first-year budget breakdown.\n\nhttps://www.amazon.com/dp/B0GG6KZ2HR\n\nThomas`,
  };
}

function email5() {
  return {
    id: "Welcome-5",
    subject: '"We thought we\'d be renting forever." (They closed 6 months later.)',
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>Let me tell you about Marcus and Danielle.</p>
<p>Marcus was 31, working in tech sales in Frisco. Danielle was 29, a physical therapist. Combined income: solid. But they'd been renting in McKinney for four years and convinced themselves homeownership was "just not in the cards right now."</p>
<p>Why?</p>
<p>Marcus had a 638 credit score. They had about $14,000 saved, which felt like "not enough." They weren't sure if they'd stay in DFW. Danielle's student loans made her nervous. And honestly? They just didn't know where to start.</p>
<p>We spent 45 minutes on the phone. By the end of that call, they realized:</p>
<p>
  • Marcus's score qualified for FHA financing<br>
  • $14,000 was enough for their price range<br>
  • Student loans didn't disqualify them — the DTI math still worked<br>
  • They could lock in a rate and stop worrying about the market
</p>
<p>Six months later, they closed on a 3-bedroom in Prosper. Mortgage: $287/month more than their rent. But they got a guest room, a yard for their dog, and they're building equity instead of paying someone else's mortgage.</p>
<p>They weren't special. They weren't uniquely prepared. They just stopped waiting for a perfect moment that was never going to come.</p>
<p><a class="cta" href="https://www.millennialhomebook.com">Take the Homeownership Readiness Scorecard</a></p>
<div class="sig">Thomas<br>Eaves Realty Group | Dallas-Fort Worth</div>
<p style="font-size:14px;color:#555;">P.S. — The resource that helped Marcus and Danielle prepare before our first call costs less than their monthly parking spot.</p>`),
    text: `Hey %FIRSTNAME%,\n\nMarcus and Danielle had every reason to wait. 638 credit score. $14K saved. Student loans. No idea where to start.\n\n6 months after our first call, they closed on a 3-bedroom in Prosper.\n\nThey weren't special. They just stopped waiting.\n\nTake the Homeownership Readiness Scorecard: https://www.millennialhomebook.com\n\nThomas`,
  };
}

function email6() {
  return {
    id: "Welcome-6",
    subject: "Honest question: have you gotten the book yet?",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>I'm going to keep this short.</p>
<p>You opted in a couple of weeks ago. You've been reading these emails. But if you haven't gotten the book yet, I want to ask you why.</p>
<p>Not in a pushy way. Genuinely — what's the holdup?</p>
<p>Because the emails I've sent you are good. They cover real ground. But they're the trailer. The book is the movie.</p>
<p><em>Millennials' Guide to Homeownership</em> covers:</p>
<p>
  ✅ How to calculate what you can actually afford (not the bank's number — YOUR number)<br>
  ✅ The step-by-step process from "thinking about it" to keys in hand<br>
  ✅ How to read a contract without a law degree<br>
  ✅ What to say (and not say) to your lender<br>
  ✅ How to negotiate so you don't leave money on the table<br>
  ✅ DFW-specific advice from 12 years of closed deals here
</p>
<p>289 pages. $16.97 in paperback. Most people read it in a weekend.</p>
<p>The information inside could easily save you $10,000+ in mistakes.</p>
<p><a class="cta" href="https://www.amazon.com/dp/B0GG6KZ2HR">Get the Book — $16.97 Paperback</a>&nbsp;&nbsp;
<a class="cta" style="background:#444;" href="https://www.amazon.com/dp/B0GG6KZ2HR">$9.99 Kindle</a></p>
<p style="font-size:14px;color:#555;">If you've already bought it — thank you. Reply and tell me what you think.</p>
<div class="sig">Thomas<br>Eaves Realty Group | Dallas-Fort Worth</div>`),
    text: `Hey %FIRSTNAME%,\n\nHave you gotten the book yet?\n\n289 pages. $16.97 paperback / $9.99 Kindle. Could save you $10,000+ in mistakes.\n\nhttps://www.amazon.com/dp/B0GG6KZ2HR\n\nIf you've already bought it — reply and tell me what you think.\n\nThomas`,
  };
}

function email7() {
  return {
    id: "Welcome-7",
    subject: "Last email. I mean it.",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>This is the last email in this sequence.</p>
<p>I'm not going to keep emailing you forever. But before I go quiet, I need to say one thing clearly:</p>
<p><strong>I can give you all the information in the world. I can't make the decision for you.</strong></p>
<p>Every year you wait is a year someone else is building equity. A year of rent checks that don't return to you. A year of potential DFW appreciation you're not capturing.</p>
<p>I'm not saying buy a house you can't afford. I'm saying: <strong>know your number</strong>. Understand your options. Make an informed decision — not a fearful one.</p>
<p>The book does that for you.</p>
<p><strong>This week only</strong>, buy the book and email me your Amazon receipt — I'll send you a personal 15-minute video answering your top 3 questions about your specific situation. No sales pitch. No obligation. Just answers.</p>
<p><a class="cta" href="https://www.amazon.com/dp/B0GG6KZ2HR">Get Millennials' Guide to Homeownership</a></p>
<p>Then forward your receipt to <a href="mailto:thomas@eavesrealtygroup.com">thomas@eavesrealtygroup.com</a> with your 3 questions. I'll record your response within 48 hours.</p>
<p>If homeownership is something you want — even someday — don't let another year go by not understanding the process.</p>
<p>You've got this.</p>
<div class="sig">Thomas Eaves<br>Eaves Realty Group | Dallas-Fort Worth<br>
📱 940-536-3076 &nbsp;|&nbsp; 📧 thomas@eavesrealtygroup.com<br>
📖 <a href="https://www.millennialhomebook.com">millennialhomebook.com</a></div>`),
    text: `Hey %FIRSTNAME%,\n\nLast email. I mean it.\n\nBuy the book this week, email me your Amazon receipt, and I'll send you a personal 15-minute video answering your top 3 questions. No pitch. Just answers.\n\nGet it: https://www.amazon.com/dp/B0GG6KZ2HR\nSend receipt to: thomas@eavesrealtygroup.com\n\nThomas\n940-536-3076`,
  };
}

function re1() {
  return {
    id: "ReEngage-1",
    subject: "Still thinking about it?",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>Not going to pretend I don't know you haven't gotten the book yet.</p>
<p>That's fine. I get it. Life gets busy.</p>
<p>I just want to ask one honest question: <strong>Is homeownership still on your radar?</strong></p>
<p>Because if it is — even in a "someday, maybe, I'm not sure" kind of way — I'd love to know what's actually holding you back.</p>
<p>Is it the down payment? Credit score? Not sure DFW is permanent? Rates feel scary? Just haven't had time to dig in?</p>
<p>Reply and tell me. One sentence is enough. I read every reply.</p>
<p>No pitch. Just curious.</p>
<div class="sig">Thomas<br>Eaves Realty Group | Dallas-Fort Worth</div>
<p style="font-size:14px;color:#555;">P.S. — If you've already bought a home or decided it's not for you, reply "not right now" and I'll stop emailing. No hard feelings.</p>`),
    text: `Hey %FIRSTNAME%,\n\nIs homeownership still on your radar?\n\nReply and tell me what's holding you back. One sentence is enough. I read every reply.\n\nNo pitch. Just curious.\n\nThomas`,
  };
}

function re2() {
  return {
    id: "ReEngage-2",
    subject: "Here's what I know about you (based on no data, just experience)",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>I've been doing this for 12 years. I've talked to thousands of people thinking about buying a home.</p>
<p>Let me make some educated guesses about you. Stop me if I'm wrong:</p>
<p><strong>You're smart.</strong> You've done research. You know more than most — maybe too much. You've seen enough conflicting advice online that you're not sure what to believe.</p>
<p><strong>You want to buy.</strong> Not necessarily today, but the desire is real. The apartment lease renewal comes up and you feel a little sick.</p>
<p><strong>You're not sure if you're "ready."</strong> So you're in a holding pattern. Waiting for your credit to be perfect. Waiting for rates to drop. Waiting for the right moment that never quite arrives.</p>
<p><strong>The thing actually stopping you isn't money or credit.</strong> It's that you don't have a clear enough picture of what the process actually looks like.</p>
<p>How'd I do?</p>
<p>If I'm even close — that's not a readiness problem. It's an information problem. And information problems are solvable.</p>
<p><a class="cta" href="https://www.amazon.com/dp/B0GG6KZ2HR">Get the Book — $16.97</a></p>
<div class="sig">Thomas<br>Eaves Realty Group | Dallas-Fort Worth</div>`),
    text: `Hey %FIRSTNAME%,\n\nYou're smart. You want to buy. You're waiting for the perfect moment. And the thing actually stopping you isn't money — it's that the process feels unclear.\n\nThat's an information problem. Solvable.\n\nhttps://www.amazon.com/dp/B0GG6KZ2HR\n\nThomas`,
  };
}

function re3() {
  return {
    id: "ReEngage-3",
    subject: "One thing you can do today that actually matters",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>No pitch today. Just something useful.</p>
<p>Here's one thing you can do <strong>today</strong> that will improve your homebuying position — whether you're ready in 3 months or 3 years:</p>
<p><strong>Pull your credit report and dispute any errors.</strong></p>
<ol>
  <li>Go to <a href="https://www.annualcreditreport.com">AnnualCreditReport.com</a> (the official, free, government-mandated one)</li>
  <li>Pull all three bureaus: Experian, Equifax, TransUnion</li>
  <li>Look for accounts that aren't yours, disputed late payments, wrong balances</li>
  <li>Dispute them directly on each bureau's website</li>
</ol>
<p>Why it matters: about 1 in 5 credit reports has an error significant enough to affect your score. A 30-point swing can mean the difference between qualifying and being denied — or between a 6.5% rate and a 7.2% rate.</p>
<p>On a $300K loan, 0.7% in rate difference = <strong>$1,400/year</strong> in extra interest. For a mistake on a document you've never looked at.</p>
<p>Take 10 minutes. It's worth it.</p>
<p>The full credit optimization strategy for mortgage qualification is in Chapter 3.</p>
<p><a class="cta" href="https://www.amazon.com/dp/B0GG6KZ2HR">Get Millennials' Guide — $16.97</a></p>
<div class="sig">Thomas<br>Eaves Realty Group | Dallas-Fort Worth</div>`),
    text: `Hey %FIRSTNAME%,\n\nNo pitch. Just one useful thing:\n\nPull your credit report and dispute any errors. Go to AnnualCreditReport.com. 1 in 5 reports has an error significant enough to affect your score. 0.7% rate difference = $1,400/year in extra interest.\n\n10 minutes. Worth it.\n\nFull credit strategy for mortgage qualification: https://www.amazon.com/dp/B0GG6KZ2HR\n\nThomas`,
  };
}

function re4() {
  return {
    id: "ReEngage-4",
    subject: "It's $16. So why haven't you gotten it?",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>I want to address something directly. The book is $16.97. That's not a lot of money. So if price isn't the barrier, what is?</p>
<p>In my experience, when someone doesn't pull the trigger on a $16 purchase they know is useful — it's never really about the $16.</p>
<p><strong>"I'm not ready yet, so it doesn't feel relevant."</strong><br>
→ The earlier you read it, the better positioned you'll be when you are ready. This information has a shelf life of years.</p>
<p><strong>"I can find this online for free."</strong><br>
→ You can find sushi ingredients online for free too. The problem isn't access — it's knowing which information is accurate, in what order, and how it applies to your situation.</p>
<p><strong>"I'm worried it'll tell me I can't afford to buy."</strong><br>
→ That's the most interesting fear. And the most common. The book won't tell you that. It'll tell you exactly what you need to get where you want to go — in 6 months or 3 years.</p>
<p>Knowledge doesn't trap you. Ignorance does.</p>
<p><a class="cta" href="https://www.amazon.com/dp/B0GG6KZ2HR">Get It on Amazon — $16.97</a></p>
<div class="sig">Thomas<br>Eaves Realty Group | Dallas-Fort Worth</div>
<p style="font-size:14px;color:#555;">P.S. — One more email after this one. And it's the last.</p>`),
    text: `Hey %FIRSTNAME%,\n\nThe book is $16.97. If price isn't the barrier, what is?\n\n"Not ready" — the earlier you read it, the better. "Can find it online" — 289 organized pages > 47 browser tabs. "Worried it'll say I can't afford it" — it won't. It tells you exactly what you need to get there.\n\nKnowledge doesn't trap you. Ignorance does.\n\nhttps://www.amazon.com/dp/B0GG6KZ2HR\n\nThomas`,
  };
}

function re5() {
  return {
    id: "ReEngage-5",
    subject: "Removing you from my list tomorrow",
    html: wrap(`
<p>Hey %FIRSTNAME%,</p>
<p>Tomorrow I'm removing you from this list.</p>
<p>Not because I'm frustrated. Not fake urgency. I just believe in keeping my list full of people who actually want to be there — and if you haven't engaged by now, you probably don't. That's completely okay.</p>
<p>But before I go, I want to leave you with something real.</p>
<p>I started in real estate at 23. Pizza restaurant manager to $85K my first year. I've had years where everything worked and years where the market turned and I wondered if I'd made a catastrophic mistake.</p>
<p>I wrote this book during a period when the market was doing things nobody could fully predict. Rates were up. Inventory was weird. Buyers were scared. And agents — including me — were watching smart, qualified people talk themselves out of the biggest wealth-building tool available to them.</p>
<p><em>Millennials' Guide to Homeownership</em> is my attempt to hand you the playbook.</p>
<p>$16.97. 289 pages. Could change your financial trajectory. Or sit on your shelf. Either way — you'll know you made an informed choice.</p>
<p><a class="cta" href="https://www.amazon.com/dp/B0GG6KZ2HR">One Last Time — Amazon</a></p>
<p>If you're ever ready to buy in DFW and want someone who actually gives a damn, you know where to find me.</p>
<p>It's been good talking to you.</p>
<div class="sig">Thomas Eaves<br>Eaves Realty Group | Dallas-Fort Worth<br>
📱 940-536-3076 &nbsp;|&nbsp; 📧 thomas@eavesrealtygroup.com<br>
📺 <a href="https://www.youtube.com/channel/UCgiVd1wxHy-yPP132LEECoA">YouTube</a> &nbsp;|&nbsp; 📖 <a href="https://www.millennialhomebook.com">millennialhomebook.com</a></div>`),
    text: `Hey %FIRSTNAME%,\n\nTomorrow I'm removing you from this list. Not frustration — just respect for your inbox.\n\nBefore I go: $16.97. 289 pages. Everything I know about buying a home. Could change your financial trajectory.\n\nhttps://www.amazon.com/dp/B0GG6KZ2HR\n\nIf you're ever ready to buy in DFW, you know where to find me.\n\nIt's been good talking to you.\n\nThomas\n940-536-3076 | thomas@eavesrealtygroup.com`,
  };
}
