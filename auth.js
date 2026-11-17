import { getDb, json, checkAdmin, dbGetJson, dbPutJson, dbDelete, getUserIds, addUserIdToIndex, removeUserIdFromIndex } from "./_db.js";

export default async function handler(req) {
  const url = new URL(req.url);
  const action = (url.searchParams.get("action") || "").trim();
  const db = getDb();

  if (req.method === "GET") {
    if (action === "health") return json({ ok: true, api: "auth" });
    if (action !== "list") return json({ error: "Invalid action" }, 400);
    if (!checkAdmin(url.searchParams.get("adminKey"))) {
      return json({ error: "管理者権限がありません。" }, 403);
    }
    const ids = await getUserIds(db);
    const users = await Promise.all(ids.map(id => dbGetJson(db, "user:" + id)));
    const validUsers = users.filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return json({ users: validUsers });
  }

  if (req.method === "POST") {
    let body = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "不正なリクエストです。" }, 400);
    }

    if (action === "register") {
      const id = String(body.id || "").trim();
      const password = String(body.password || "").trim();
      if (!/^[a-zA-Z0-9_-]{2,24}$/.test(id)) {
        return json({ error: "IDは半角英数字・ハイフン・アンダースコアで2〜24文字にしてください。" }, 400);
      }
      if (password.length < 3 || password.length > 40) {
        return json({ error: "パスワードは3〜40文字で設定してください。" }, 400);
      }
      if (id.toLowerCase() === "admin") {
        return json({ error: "このIDは使用できません。" }, 400);
      }
      const existing = await dbGetJson(db, "user:" + id);
      if (existing) {
        return json({ error: "このIDはすでに使われています。別のIDにしてください。" }, 409);
      }
      await dbPutJson(db, "user:" + id, { id, password, status: "pending", createdAt: Date.now() });
      await addUserIdToIndex(db, id);
      return json({
        ok: true,
        message: "アカウント申請を送信しました！管理者の許可をお待ちください。",
        status: "pending"
      });
    }

    if (action === "login") {
      const id = String(body.id || "").trim();
      const password = String(body.password || "").trim();
      if (!id || !password) return json({ error: "IDとパスワードを入力してください。" }, 400);
      const user = await dbGetJson(db, "user:" + id);
      if (!user || user.password !== password) {
        return json({ error: "IDまたはパスワードが違います。" }, 401);
      }
      if (user.status !== "approved") {
        const status = user.status === "rejected" ? "rejected" : "pending";
        return json({
          ok: false,
          error: status === "rejected" ? "このアカウントは管理者により拒否されています。" : "このアカウントはまだ管理者の許可待ちです。",
          status
        }, 403);
      }
      return json({ ok: true, id: user.id, status: user.status });
    }

    if (action === "decide") {
      if (!checkAdmin(body.adminKey)) {
        return json({ error: "管理者権限がありません。" }, 403);
      }
      const targetId = String(body.id || "").trim();
      const decision = String(body.decision || "").trim();
      if (!targetId) return json({ error: "対象IDがありません。" }, 400);
      if (!["approved", "rejected", "delete"].includes(decision)) {
        return json({ error: "不正な操作です。" }, 400);
      }
      if (decision === "delete") {
        await dbDelete(db, "user:" + targetId);
        await removeUserIdFromIndex(db, targetId);
        return json({ ok: true });
      }
      const user = await dbGetJson(db, "user:" + targetId);
      if (!user) return json({ error: "ユーザーが見つかりません。" }, 404);
      user.status = decision;
      await dbPutJson(db, "user:" + targetId, user);
      return json({ ok: true, user });
    }

    return json({ error: "Invalid action" }, 400);
  }

  return json({ error: "Method not allowed" }, 405);
}
