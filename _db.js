import { getStore } from "@netlify/blobs";

export function getDb() {
  return getStore({ name: "kabirunrun-db", consistency: "strong" });
}

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

export function checkAdmin(key) {
  const clean = String(key || "").trim().replace(/[×x]/g, "*").replace(/\s/g, "");
  return clean === "115638" || clean === "114514+810+314";
}

export async function dbGetJson(db, key) {
  try {
    return await db.get(key, { type: "json" });
  } catch {
    return null;
  }
}

export async function dbPutJson(db, key, val) {
  await db.setJSON(key, val);
}

export async function dbDelete(db, key) {
  await db.delete(key);
}

// Maintain a compact user index to avoid expensive list() + N*get() calls
export async function getUserIds(db) {
  const idx = await dbGetJson(db, "users:index:v1");
  if (idx && Array.isArray(idx.ids)) {
    return [...new Set(idx.ids.filter(x => typeof x === "string" && x))];
  }
  const { blobs } = await db.list({ prefix: "user:" });
  const ids = (blobs || []).map(b => b.key.slice(5)).filter(Boolean);
  await dbPutJson(db, "users:index:v1", { ids });
  return ids;
}

export async function addUserIdToIndex(db, id) {
  const ids = await getUserIds(db);
  if (!ids.includes(id)) {
    ids.push(id);
    await dbPutJson(db, "users:index:v1", { ids });
  }
}

export async function removeUserIdFromIndex(db, id) {
  const ids = await getUserIds(db);
  const next = ids.filter(x => x !== id);
  await dbPutJson(db, "users:index:v1", { ids: next });
}

export async function verifyUser(db, id, password) {
  if (id === "admin" && checkAdmin(password)) {
    return { id: "admin", status: "approved" };
  }
  const user = await dbGetJson(db, "user:" + id);
  if (!user || user.password !== password) return null;
  if (user.status !== "approved") return null;
  return user;
}
