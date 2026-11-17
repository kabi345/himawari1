import { getDb, json, dbGetJson, dbPutJson, dbDelete, getUserIds, verifyUser } from "./_db.js";

function dmKey(a, b) {
  const sorted = [String(a), String(b)].sort();
  return "dm:" + sorted[0] + ":" + sorted[1];
}

async function getApprovedPartners(db, me) {
  const partners = new Set();
  if (me !== "admin") partners.add("admin");
  const ids = await getUserIds(db);
  const users = await Promise.all(ids.filter(id => id !== me).map(id => dbGetJson(db, "user:" + id)));
  for (const u of users) {
    if (u && u.status === "approved" && u.id && u.id !== me) {
      partners.add(u.id);
    }
  }
  return Array.from(partners);
}

async function getUserGroups(db, me) {
  const { blobs } = await db.list({ prefix: "group:" });
  const rawGroups = await Promise.all((blobs || []).map(b => dbGetJson(db, b.key)));
  const groups = [];
  for (const g of rawGroups) {
    if (g && Array.isArray(g.members) && (g.members.includes(me) || me === "admin")) {
      groups.push({ id: g.id, name: g.name, owner: g.owner, members: g.members });
    }
  }
  groups.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  return groups;
}

export default async function handler(req) {
  const db = getDb();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const me = (url.searchParams.get("me") || "").trim();
    const password = (url.searchParams.get("password") || "").trim();
    const peer = (url.searchParams.get("peer") || "").trim();
    const groupId = (url.searchParams.get("groupId") || "").trim();
    const pollOnly = url.searchParams.get("poll") === "1";
    const since = Number(url.searchParams.get("since") || 0);

    const auth = await verifyUser(db, me, password);
    if (!auth) return json({ error: "認証に失敗しました。" }, 403);

    // Lightweight polling mode: skip fetching full partner/group lists on every background tick
    const partners = pollOnly ? undefined : await getApprovedPartners(db, me);
    const groups = pollOnly ? undefined : await getUserGroups(db, me);

    if (groupId) {
      const g = await dbGetJson(db, "group:" + groupId);
      if (!g || (!g.members.includes(me) && me !== "admin")) {
        return json({ error: "このグループへのアクセス権がありません。" }, 403);
      }
      const messages = ((await dbGetJson(db, "groupmsg:" + groupId)) || []).slice(-80);
      const latestAt = messages.length ? (messages[messages.length - 1].at || 0) : 0;
      if (pollOnly && since > 0 && latestAt <= since) {
        return json({ ok: true, unchanged: true, latestAt });
      }
      return json({
        ok: true,
        ...(partners ? { partners } : {}),
        ...(groups ? { groups } : {}),
        group: g,
        messages,
        latestAt
      });
    }

    let messages = [];
    if (peer) {
      messages = ((await dbGetJson(db, dmKey(me, peer))) || []).slice(-80);
    }
    const latestAt = messages.length ? (messages[messages.length - 1].at || 0) : 0;
    if (pollOnly && since > 0 && latestAt <= since) {
      return json({ ok: true, unchanged: true, latestAt });
    }

    return json({
      ok: true,
      ...(partners ? { partners } : {}),
      ...(groups ? { groups } : {}),
      messages,
      latestAt
    });
  }

  if (req.method === "POST") {
    let body = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: "不正なリクエストです。" }, 400);
    }

    const me = String(body.me || "").trim();
    const password = String(body.password || "").trim();
    const action = String(body.action || "send").trim();

    const auth = await verifyUser(db, me, password);
    if (!auth) return json({ error: "認証に失敗しました。" }, 403);

    if (action === "create_group") {
      const name = String(body.name || "").trim().slice(0, 30);
      const rawMembers = Array.isArray(body.members) ? body.members : [];
      if (!name) return json({ error: "グループ名を入力してください。" }, 400);

      const memberSet = new Set([me]);
      for (const m of rawMembers) {
        const mid = String(m || "").trim();
        if (!mid) continue;
        if (mid === "admin") memberSet.add("admin");
        else {
          const u = await dbGetJson(db, "user:" + mid);
          if (u && u.status === "approved") memberSet.add(mid);
        }
      }

      const groupId = "grp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
      const groupObj = { id: groupId, name, owner: me, members: Array.from(memberSet), createdAt: Date.now() };
      await dbPutJson(db, "group:" + groupId, groupObj);
      await dbPutJson(db, "groupmsg:" + groupId, [
        { from: "SYSTEM", text: `${me} がグループ「${name}」を作成しました`, at: Date.now() }
      ]);

      const groups = await getUserGroups(db, me);
      return json({ ok: true, group: groupObj, groups });
    }

    if (action === "add_member") {
      const groupId = String(body.groupId || "").trim();
      const newMember = String(body.memberId || "").trim();
      const g = await dbGetJson(db, "group:" + groupId);
      if (!g || (!g.members.includes(me) && me !== "admin")) {
        return json({ error: "グループが見つからないか権限がありません。" }, 403);
      }
      if (!newMember) return json({ error: "追加するIDを入力してください。" }, 400);
      if (newMember !== "admin") {
        const u = await dbGetJson(db, "user:" + newMember);
        if (!u || u.status !== "approved") {
          return json({ error: "そのIDは存在しないか、まだ承認されていません。" }, 404);
        }
      }
      if (!g.members.includes(newMember)) {
        g.members.push(newMember);
        await dbPutJson(db, "group:" + groupId, g);
        const msgs = (await dbGetJson(db, "groupmsg:" + groupId)) || [];
        msgs.push({ from: "SYSTEM", text: `${me} が ${newMember} をグループに追加しました`, at: Date.now() });
        await dbPutJson(db, "groupmsg:" + groupId, msgs.slice(-120));
      }
      const messages = ((await dbGetJson(db, "groupmsg:" + groupId)) || []).slice(-80);
      return json({ ok: true, group: g, messages });
    }

    if (action === "leave_group") {
      const groupId = String(body.groupId || "").trim();
      const g = await dbGetJson(db, "group:" + groupId);
      if (!g || !g.members.includes(me)) return json({ error: "グループに参加していません。" }, 400);
      g.members = g.members.filter(m => m !== me);
      if (g.members.length === 0) {
        await dbDelete(db, "group:" + groupId);
        await dbDelete(db, "groupmsg:" + groupId);
      } else {
        await dbPutJson(db, "group:" + groupId, g);
        const msgs = (await dbGetJson(db, "groupmsg:" + groupId)) || [];
        msgs.push({ from: "SYSTEM", text: `${me} がグループから退出しました`, at: Date.now() });
        await dbPutJson(db, "groupmsg:" + groupId, msgs.slice(-120));
      }
      const groups = await getUserGroups(db, me);
      return json({ ok: true, groups });
    }

    const text = String(body.text || "").trim().slice(0, 1000);
    if (!text) return json({ error: "メッセージを入力してください。" }, 400);

    const groupId = String(body.groupId || "").trim();
    if (groupId) {
      const g = await dbGetJson(db, "group:" + groupId);
      if (!g || (!g.members.includes(me) && me !== "admin")) {
        return json({ error: "このグループに送信する権限がありません。" }, 403);
      }
      const key = "groupmsg:" + groupId;
      const msgs = (await dbGetJson(db, key)) || [];
      msgs.push({ from: me, text, at: Date.now() });
      const trimmed = msgs.slice(-120);
      await dbPutJson(db, key, trimmed);
      return json({ ok: true, messages: trimmed.slice(-80) });
    }

    const peer = String(body.peer || "").trim();
    if (!peer) return json({ error: "送信先が指定されていません。" }, 400);
    if (peer !== "admin") {
      const peerUser = await dbGetJson(db, "user:" + peer);
      if (!peerUser || peerUser.status !== "approved") {
        return json({ error: "送信先のIDが見つからないか、まだ許可されていません。" }, 404);
      }
    }

    const key = dmKey(me, peer);
    const msgs = (await dbGetJson(db, key)) || [];
    msgs.push({ from: me, text, at: Date.now() });
    const trimmed = msgs.slice(-120);
    await dbPutJson(db, key, trimmed);

    return json({ ok: true, messages: trimmed.slice(-80) });
  }

  return json({ error: "Method not allowed" }, 405);
}
