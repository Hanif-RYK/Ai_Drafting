// Database adapter: the small "collection" interface the Faisla Desk artifact used
// (col.doc(id).set / update / delete, col.onSnapshot) on top of the team-shared
// `docs` table in Supabase (see supabase/schema.sql).
//
// Every document is one row: { team_id, id, kind, section, subtype, stage, title, data }.
// `data` holds the whole document; the other columns are copies for filtering.
// Changes made by other team members arrive through Supabase Realtime; if that
// channel cannot connect, the adapter polls instead.

const POLL_MS = 20000;

export function createCollection(sb, teamId) {
  const rows = new Map();          // id -> row
  const listeners = [];            // { cb, err }
  let channel = null, pollTimer = null, started = false, loaded = false;

  const toDoc = (r) => {
    const d = r.data && typeof r.data === "object" ? r.data : {};
    return {
      ...d,
      id: r.id,
      kind: r.kind,
      updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : Date.parse(r.updated_at) || Date.now(),
      _by: r.updated_by || r.created_by || null,
      _createdBy: r.created_by || null,
    };
  };
  const snapshot = () => ({ docs: [...rows.values()].map((r) => ({ id: r.id, data: () => toDoc(r) })) });
  const emit = () => { const s = snapshot(); listeners.forEach((l) => { try { l.cb(s); } catch (e) { console.error(e); } }); };
  const fail = (e) => listeners.forEach((l) => l.err?.(e));

  async function fetchAll() {
    const { data, error } = await sb.from("docs").select("*").eq("team_id", teamId);
    if (error) throw error;
    rows.clear();
    (data || []).forEach((r) => rows.set(r.id, r));
    loaded = true;
    emit();
  }
  async function fetchOne(id) {
    const { data } = await sb.from("docs").select("*").eq("team_id", teamId).eq("id", id).maybeSingle();
    if (data) { rows.set(id, data); emit(); }
  }

  function rowFrom(id, doc) {
    const prev = rows.get(id);
    return {
      team_id: teamId,
      id,
      kind: doc.kind || prev?.kind || "case",
      section: String(doc.section || ""),
      subtype: String(doc.subtype || ""),
      stage: String(doc.stage || ""),
      title: String(doc.title || doc.f?.title || "").slice(0, 300),
      data: doc,
    };
  }

  function doc(id) {
    return {
      async set(d) {
        const { data, error } = await sb.from("docs").upsert(rowFrom(id, d), { onConflict: "team_id,id" }).select().single();
        if (error) throw error;
        rows.set(id, data); emit();
      },
      async update(partial) {
        let cur = rows.get(id);
        if (!cur) {
          const { data } = await sb.from("docs").select("*").eq("team_id", teamId).eq("id", id).maybeSingle();
          if (!data) throw new Error("Document not found");
          cur = data;
        }
        await this.set({ ...(cur.data || {}), ...partial });
      },
      async delete() {
        const { error, count } = await sb.from("docs").delete({ count: "exact" }).eq("team_id", teamId).eq("id", id);
        if (error) throw error;
        if (count === 0) throw new Error("Not allowed to delete this document");
        rows.delete(id); emit();
      },
    };
  }

  function startPolling() { if (!pollTimer) pollTimer = setInterval(() => fetchAll().catch(() => {}), POLL_MS); }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

  function start() {
    if (started) return;
    started = true;
    fetchAll().catch(fail);
    channel = sb.channel(`docs-${teamId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: `team_id=eq.${teamId}` }, (payload) => {
        if (payload.eventType === "DELETE") { if (payload.old?.id) { rows.delete(payload.old.id); emit(); } return; }
        const r = payload.new;
        if (!r?.id) return;
        // Very large rows can arrive without their jsonb payload; fetch those by id.
        if (!r.data || typeof r.data !== "object") { fetchOne(r.id); return; }
        rows.set(r.id, r); emit();
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { stopPolling(); if (loaded) fetchAll().catch(() => {}); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") startPolling();
      });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") fetchAll().catch(() => {}); });
  }

  function onSnapshot(cb, errCb) {
    const l = { cb, err: errCb };
    listeners.push(l);
    start();
    if (loaded) cb(snapshot());
    return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
  }

  function stop() {
    stopPolling();
    if (channel) { sb.removeChannel(channel); channel = null; }
  }

  return { doc, onSnapshot, refresh: () => fetchAll(), stop };
}
