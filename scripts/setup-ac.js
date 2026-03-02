/**
 * MGTHO AC Setup Script — Run Once
 * Creates the MGTHO Queue list + 12 sequence tracking tags in ActiveCampaign.
 * Usage: node scripts/setup-ac.js
 * Output: scripts/ac-ids.json (used by sequence-runner)
 */

require("dotenv").config({ path: require("path").join(__dirname, "../.env.local") });

const AC_BASE = process.env.AC_BASE_URL || "https://eavesrealtygroup.api-us1.com";
const AC_KEY  = process.env.AC_API_KEY;

if (!AC_KEY) { console.error("AC_API_KEY missing"); process.exit(1); }

async function ac(path, method = "GET", body = null) {
  const res = await fetch(`${AC_BASE}/api/3${path}`, {
    method,
    headers: { "Api-Token": AC_KEY, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) { console.error(`AC error [${method} ${path}]:`, JSON.stringify(data)); }
  return data;
}

async function createTag(tag) {
  const existing = await ac(`/tags?search=${encodeURIComponent(tag)}`);
  if (existing.tags?.length) {
    const found = existing.tags.find(t => t.tag === tag);
    if (found) { console.log(`  Tag exists: "${tag}" → ID ${found.id}`); return found.id; }
  }
  const res = await ac("/tags", "POST", { tag: { tag, tagType: "contact", description: "MGTHO sequence tracker" } });
  console.log(`  Created tag: "${tag}" → ID ${res.tag?.id}`);
  return res.tag?.id;
}

async function createList(name) {
  const existing = await ac("/lists?limit=100");
  const found = existing.lists?.find(l => l.name === name);
  if (found) { console.log(`  List exists: "${name}" → ID ${found.id}`); return found.id; }
  const res = await ac("/lists", "POST", {
    list: {
      name,
      stringid: "mgtho-queue",
      sender_url: "https://eavesrealtygroup.com",
      sender_reminder: "You opted in at millennialhomebook.com",
    },
  });
  console.log(`  Created list: "${name}" → ID ${res.list?.id}`);
  return res.list?.id;
}

async function main() {
  console.log("=== MGTHO AC Setup ===\n");

  console.log("Creating queue list...");
  const queueListId = await createList("MGTHO Email Queue");

  console.log("\nCreating sequence tracking tags...");
  const tagNames = [
    "mgtho-email-1-sent",
    "mgtho-email-2-sent",
    "mgtho-email-3-sent",
    "mgtho-email-4-sent",
    "mgtho-email-5-sent",
    "mgtho-email-6-sent",
    "mgtho-email-7-sent",
    "mgtho-re-1-sent",
    "mgtho-re-2-sent",
    "mgtho-re-3-sent",
    "mgtho-re-4-sent",
    "mgtho-re-5-sent",
  ];

  const tagIds = {};
  for (const name of tagNames) {
    tagIds[name] = await createTag(name);
  }

  const output = { queueListId, tagIds };
  require("fs").writeFileSync(
    require("path").join(__dirname, "ac-ids.json"),
    JSON.stringify(output, null, 2)
  );

  console.log("\n✅ Done. IDs saved to scripts/ac-ids.json");
  console.log(JSON.stringify(output, null, 2));
}

main().catch(console.error);
