import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Album, Group, Privacy, QueueItem } from "../types";

type Tab = "setup" | "queue" | "schedule" | "logs";

const PRIVACY_LABEL: Record<Privacy, string> = {
  public: "Public",
  friends: "Friends only",
  family: "Family only",
  friends_family: "Friends & Family",
  private: "Private",
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function formatLocal(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function TriCheck(props: {
  state: "all" | "none" | "some";
  onToggle: (next: "all" | "none") => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.indeterminate = props.state === "some";
  }, [props.state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={props.state === "all"}
      onChange={(e) => props.onToggle(e.target.checked ? "all" : "none")}
    />
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("queue");
  const [cfg, setCfg] = useState<any>(null);

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [verifier, setVerifier] = useState("");
  const [showSetupAdvanced, setShowSetupAdvanced] = useState(false);

  const [groups, setGroups] = useState<Group[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [groupsFilter, setGroupsFilter] = useState("");
  const [albumsFilter, setAlbumsFilter] = useState("");
  const [appVersion, setAppVersion] = useState<string>("");
  const [isUploadingNow, setIsUploadingNow] = useState(false);

    const [showSetup, setShowSetup] = useState(true);
const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  const active = useMemo(() => queue.find(q => q.id === activeId) || null, [queue, activeId]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const [intervalHours, setIntervalHours] = useState<number>(24);
  const [timeWindowEnabled, setTimeWindowEnabled] = useState<boolean>(false);
  const [windowStart, setWindowStart] = useState<string>("07:00");
  const [windowEnd, setWindowEnd] = useState<string>("22:00");
  const [daysEnabled, setDaysEnabled] = useState<boolean>(false);
  const [allowedDays, setAllowedDays] = useState<number[]>([1,2,3,4,5]);
  const [resumeOnLaunch, setResumeOnLaunch] = useState<boolean>(false);
  const [skipOvernight, setSkipOvernight] = useState<boolean>(false);
  const [sched, setSched] = useState<any>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800); };

  const refreshAll = async () => {
    const c = await window.sq.getConfig();
    setCfg(c);
    const le = String(c.lastError || "");
    const authish = /oauth_problem|(95|96|97|98|99|100)/i.test(le);
    if (authish) setShowSetupAdvanced(true);
    else if (c.authed) setShowSetupAdvanced(false);
    setIntervalHours(Number(c.intervalHours || 24));
    setTimeWindowEnabled(Boolean(c.timeWindowEnabled));
    setWindowStart(String(c.windowStart || "07:00"));
    setWindowEnd(String(c.windowEnd || "22:00"));
    setDaysEnabled(Boolean(c.daysEnabled));
    setAllowedDays(Array.isArray(c.allowedDays) ? c.allowedDays : [1,2,3,4,5]);
    setResumeOnLaunch(Boolean(c.resumeOnLaunch));

    // scheduler defaults (only set once if missing)
    if (typeof c.timeWindowEnabled !== "boolean") setTimeWindowEnabled(false);
    if (typeof c.daysEnabled !== "boolean") setDaysEnabled(false);

    // hide setup UI if already authed
    if (c.authed) setShowSetup(false);
    setSkipOvernight(Boolean(c.skipOvernight));
    setApiKey(c.apiKey || "");
    setApiSecret("");
    const q = await window.sq.queueGet();
    setQueue(q);
    if (!activeId && q.length) setActiveId(q[0].id);
    setSched(await window.sq.schedulerStatus());
    try { setLogs(await window.sq.logGet()); } catch { /* ignore */ }

  };


  useEffect(() => {
    (async () => {
      try {
        const v = await window.sq.appVersion();
        setAppVersion(v || "");
      } catch {
        // ignore
      }
    })();
  }, []);
  useEffect(() => { refreshAll(); }, []);

  useEffect(() => {
    (async () => {
      for (const it of queue.slice(0, 120)) {
        if (thumbs[it.photoPath] !== undefined) continue;
        const dataUrl = await window.sq.getThumbDataUrl(it.photoPath);
        setThumbs(t => ({ ...t, [it.photoPath]: dataUrl }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  const saveKeys = async () => {
    await window.sq.setApiKeySecret(apiKey, apiSecret);
    await refreshAll();
    showToast("Saved API key/secret.");
  };

  const startOAuth = async () => {
    await saveKeys();
    await window.sq.startOAuth();
    showToast("Browser opened. Authorize, then paste verifier and click Finish.");
  };

  const finishOAuth = async () => {
    await window.sq.finishOAuth(verifier);
    setVerifier("");
    await refreshAll();
    showToast("Authorization complete.");
  };

  const loadGroups = async () => {
    const g = await window.sq.fetchGroups();
    setGroups(g);
    showToast(`Loaded ${g.length} groups.`);
  };

  const loadAlbums = async () => {
    const a = await window.sq.fetchAlbums();
    setAlbums(a);
    showToast(`Loaded ${a.length} albums.`);
  };

  const addPhotos = async () => {
    const paths = await window.sq.pickPhotos();
    if (!paths.length) return;
    const q = await window.sq.queueAdd(paths);
    setQueue(q);
    if (!activeId && q.length) setActiveId(q[0].id);
    showToast(`Added ${paths.length} photo(s).`);
  };

  const selectAll = () => setSelectedIds(queue.map(q => q.id));
  const clearSelection = () => setSelectedIds([]);

  const removeSelected = async () => {
    const ids = selectedIds.length ? selectedIds : (activeId ? [activeId] : []);
    if (!ids.length) return;
    const q = await window.sq.queueRemove(ids);
    setQueue(q);
    setSelectedIds([]);
    setActiveId(q[0]?.id || null);
  };

  const updateItems = async (items: QueueItem[]) => {
    const q = await window.sq.queueUpdate(items);
    setQueue(q);
  };

  const updateActive = async (patch: Partial<QueueItem>) => {
    if (!active) return;
    const updated: QueueItem = { ...active, ...patch };
    setQueue(prev => prev.map(it => it.id === updated.id ? updated : it));
    await updateItems([updated]);
  };

  const handleRowClick = (id: string, e: React.MouseEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

    setActiveId(id);

    if (isShift && anchorId) {
      const a = queue.findIndex(x => x.id === anchorId);
      const b = queue.findIndex(x => x.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = queue.slice(lo, hi + 1).map(x => x.id);
        setSelectedIds(prev => uniq([...prev, ...range]));
        return;
      }
    }

    if (isMeta) {
      setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : uniq([...prev, id]));
      setAnchorId(id);
      return;
    }

    setSelectedIds([id]);
    setAnchorId(id);
  };

  const [dragOver, setDragOver] = useState<{ id: string; pos: "top" | "bottom" } | null>(null);

  const onDropReorder = async (fromId: string, toId: string, pos: "top" | "bottom") => {
    const from = queue.findIndex(x => x.id === fromId);
    const to = queue.findIndex(x => x.id === toId);
    if (from < 0 || to < 0 || from === to) return;

    const copy = [...queue];
    const [it] = copy.splice(from, 1);

    let insertAt = to;
    if (from < to) insertAt -= 1;
    if (pos === "bottom") insertAt += 1;

    insertAt = Math.max(0, Math.min(copy.length, insertAt));
    copy.splice(insertAt, 0, it);

    setQueue(copy);
    setDragOver(null);
    await window.sq.queueReorder(copy.map(x => x.id));
  };

  const uploadNext = async () => {
    const res = await window.sq.uploadNowOne();
    await refreshAll();
    showToast(res.ok ? "Uploaded next item." : `Upload failed: ${res.error || "unknown error"}`);
  };

  const startSched = async () => {
    const h = Math.max(1, Math.min(168, Math.round(Number(intervalHours || 24))));
    const uploadImmediately = window.confirm(
      "Start scheduler now?\n\nOK = upload the next item immediately\nCancel = wait the full interval before the first upload"
    );
    await window.sq.schedulerStart(h, uploadImmediately, {
      timeWindowEnabled,
      windowStart,
      windowEnd,
      daysEnabled,
      allowedDays,
      resumeOnLaunch,
    });
    await refreshAll();
    showToast("Scheduler started.");
  };

  const stopSched = async () => {
    await window.sq.schedulerStop();
    await refreshAll();
    showToast("Scheduler stopped.");
  };

  const [batchTitle, setBatchTitle] = useState("");
  const [batchTags, setBatchTags] = useState("");
  const [batchDescription, setBatchDescription] = useState("");
  const [batchPrivacy, setBatchPrivacy] = useState<Privacy | "">( "" );
  const [batchCreateAlbums, setBatchCreateAlbums] = useState("");

  const applyBatch = async () => {
    if (!selectedIds.length) return;
    const byId = new Map(queue.map(it => [it.id, it]));
    const changed: QueueItem[] = [];
    for (const id of selectedIds) {
      const it = byId.get(id);
      if (!it) continue;
      const next: QueueItem = { ...it };
      if (batchTitle.trim()) next.title = batchTitle.trim();
      if (batchTags.trim()) next.tags = batchTags.trim();
      if (batchDescription.trim()) next.description = batchDescription;
      if (batchCreateAlbums.trim()) next.createAlbums = batchCreateAlbums.split(",").map(s => s.trim()).filter(Boolean);
      if (batchPrivacy) next.privacy = batchPrivacy as Privacy;
      changed.push(next);
    }
    if (!changed.length) return;
    setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
    await updateItems(changed);
    showToast(`Applied to ${changed.length} item(s).`);
  };

  const toggleIds = (ids: string[], id: string, mode: "add" | "remove") => {
    const set = new Set(ids);
    if (mode === "add") set.add(id); else set.delete(id);
    return Array.from(set);
  };

  const triState = (kind: "group" | "album", id: string) => {
    if (!selectedIds.length) return "none" as const;
    let on = 0;
    for (const sid of selectedIds) {
      const it = queue.find(x => x.id === sid);
      const list = kind === "group" ? it?.groupIds : it?.albumIds;
      if (list?.includes(id)) on += 1;
    }
    if (on === 0) return "none" as const;
    if (on === selectedIds.length) return "all" as const;
    return "some" as const;
  };

  const setForSelected = async (kind: "group" | "album", id: string, next: "all" | "none") => {
    if (!selectedIds.length) return;
    const changed: QueueItem[] = [];
    for (const sid of selectedIds) {
      const it = queue.find(x => x.id === sid);
      if (!it) continue;
      if (kind === "group") changed.push({ ...it, groupIds: toggleIds(it.groupIds || [], id, next === "all" ? "add" : "remove") });
      else changed.push({ ...it, albumIds: toggleIds(it.albumIds || [], id, next === "all" ? "add" : "remove") });
    }
    setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
    await updateItems(changed);
  };

  const scheduledMap = useMemo(() => {
    const out: Record<string, string> = {};
    if (!sched?.schedulerOn) return out;

    const h = Number(sched?.intervalHours || intervalHours || 24);
    let t = sched?.nextRunAt ? new Date(sched.nextRunAt).getTime() : Date.now();

    const pending = queue.filter(it => it.status === "pending");
    for (const it of pending) {
      out[it.id] = new Date(t).toISOString();
      t += h * 3600 * 1000;
    }
    return out;
  }, [queue, sched, intervalHours]);

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="h1">ShutterQueue</div>
          <div className="sub">A paced uploader for Flickr. Build a queue, reorder on the fly, and upload every 1–168 hours.</div>
        </div>
        <div className="row">
          {cfg?.authed ? <span className="badge good">Authorized</span> : <span className="badge warn">Not authorized</span>}
          <span className="badge">{queue.length} in queue</span>
          {sched?.schedulerOn ? <span className="badge good">Scheduler ON</span> : <span className="badge">Scheduler OFF</span>}
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className={`btn ${tab==="setup"?"primary":""}`} onClick={() => setTab("setup")}>Setup</button>
        <button className={`btn ${tab==="queue"?"primary":""}`} onClick={() => setTab("queue")}>Queue</button>
        <button className={`btn ${tab==="schedule"?"primary":""}`} onClick={() => setTab("schedule")}>Schedule</button>
        <button className={`btn ${tab==="logs"?"primary":""}`} onClick={() => setTab("logs")}>Logs</button>
      </div>

      {toast && <div className="badge" style={{ borderColor: "rgba(139,211,255,0.35)", color: "var(--accent)", marginBottom: 12 }}>{toast}</div>}
      {cfg?.lastError ? <div className="badge bad" style={{ marginBottom: 12 }}> {cfg.lastError}</div> : null}

      {tab === "setup" && (
        <div className="grid">
          <div className="card">
            <h2>Flickr API + OAuth</h2>
            <div className="content">
{cfg?.authed && !showSetupAdvanced ? (
  <>
    <div className="badge good" style={{ marginBottom: 10 }}>Already authorized.</div>
    <div className="small" style={{ marginBottom: 12 }}>
      Setup is hidden to keep things simple. If authorization fails later, we’ll show setup again automatically.
    </div>
    <div className="row">
      <button className="btn" onClick={() => setShowSetupAdvanced(true)}>Show API + Reauthorize</button>
      <button className="btn danger" onClick={async () => { await window.sq.logout(); await refreshAll(); showToast("Logged out."); }}>Logout</button>
    </div>
  </>
) : (
  <>
    <div className="small">OAuth is done in your browser (no Flickr password stored by ShutterQueue). Keys + tokens are saved between versions.</div>
    <div style={{ height: 12 }} />
    <label className="small">API Key</label>
    <input className="input" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste API Key" />
    <div style={{ height: 10 }} />
    <label className="small">API Secret</label>
    <input className="input" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="Paste API Secret" type="password" />
    <div style={{ height: 12 }} />
    <div className="row">
      <button className="btn" onClick={saveKeys}>Save</button>
      <button className="btn primary" onClick={startOAuth} disabled={!apiKey || (!apiSecret && !cfg?.hasApiSecret)}>Start Authorization</button>
      <button className="btn danger" onClick={async () => { await window.sq.logout(); await refreshAll(); showToast("Logged out."); }}>Logout</button>
    </div>
    <div className="small" style={{ marginTop: 10 }}>Paste verifier code shown by Flickr:</div>
    <div style={{ height: 10 }} />
    <div className="row">
      <input className="input" value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="Verifier code" style={{ maxWidth: 240 }} />
      <button className="btn primary" onClick={finishOAuth} disabled={!verifier}>Finish</button>
    </div>
  </>
)}
              <div className="hr" />

              <div className="row">
                <button className="btn" onClick={loadGroups} disabled={!cfg?.authed}>Load Groups</button>
                <button className="btn" onClick={loadAlbums} disabled={!cfg?.authed}>Load Albums</button>
              </div>

              <div className="small" style={{ marginTop: 10 }}>
                Groups loaded: {groups.length} • Albums loaded: {albums.length}
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Loaded Groups / Albums</h2>
            <div className="content">
              <div className="split">
                <div>
                  <div className="small">Groups filter</div>
                  <input className="input" value={groupsFilter} onChange={(e) => setGroupsFilter(e.target.value)} placeholder="search..." />
                  <div style={{ height: 8 }} />
                  <div className="listbox">
                    {groups.filter(g => g.name.toLowerCase().includes(groupsFilter.toLowerCase())).slice(0, 200).map(g => (
                      <div key={g.id} className="listrow">
                        <div className="small">{g.name}</div>
                      </div>
                    ))}
                    {!groups.length && <div className="small">Not loaded yet.</div>}
                  </div>
                </div>
                <div>
                  <div className="small">Albums filter</div>
                  <input className="input" value={albumsFilter} onChange={(e) => setAlbumsFilter(e.target.value)} placeholder="search..." />
                  <div style={{ height: 8 }} />
                  <div className="listbox">
                    {albums.filter(a => a.title.toLowerCase().includes(albumsFilter.toLowerCase())).slice(0, 200).map(a => (
                      <div key={a.id} className="listrow">
                        <div className="small">{a.title}</div>
                      </div>
                    ))}
                    {!albums.length && <div className="small">Not loaded yet.</div>}
                  </div>
                </div>
              </div>
              <div className="small" style={{ marginTop: 10 }}>
                Tip: in Queue, use normal selection (click, shift-click, cmd/ctrl-click) to batch edit.
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "queue" && (
        <div className="grid">
          <div className="card">
            <h2>Upload Queue (drag by handle ↕)</h2>
            <div className="content">
              <div className="btnrow" style={{ marginBottom: 10, justifyContent: "space-between" }}>
                <div className="btnrow">
                  <button className="btn primary" onClick={addPhotos} disabled={!cfg?.authed}>Add Photos</button>
                  <button className="btn danger" onClick={removeSelected} disabled={!activeId && !selectedIds.length}>Remove</button>
                  <button className="btn" onClick={async () => { const q = await window.sq.queueClearUploaded(); setQueue(q); showToast("Cleared successfully uploaded photos."); }} disabled={!queue.length}>Clear uploaded</button>
                  <button className="btn" onClick={uploadNext} disabled={!cfg?.authed || !queue.length}>Upload Next Item Now</button>
                </div>
                <div className="btncluster">
                  <button className="btn" onClick={selectAll} disabled={!queue.length}>Select all</button>
                  <button className="btn" onClick={clearSelection} disabled={!selectedIds.length}>Clear selection ({selectedIds.length})</button>
                </div>
              </div>

              <div className="queue">
                {queue.map((it) => {
                  const thumb = thumbs[it.photoPath];
                  const isSelected = selectedSet.has(it.id);
                  const dragClass =
                    dragOver?.id === it.id
                      ? (dragOver.pos === "top" ? "drag-over-top" : "drag-over-bottom")
                      : "";
                  return (
                    <div
                      key={it.id}
                      className={`qitem ${isSelected ? "selected" : ""} ${dragClass}`}
                      onClick={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.classList.contains("drag")) return;
                        handleRowClick(it.id, e);
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const pos = (e.clientY - rect.top) < rect.height / 2 ? "top" : "bottom";
                        setDragOver({ id: it.id, pos });
                      }}
                      onDragLeave={() => setDragOver(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        const fromId = e.dataTransfer.getData("text/plain");
                        const pos = dragOver?.id === it.id ? dragOver.pos : "top";
                        onDropReorder(fromId, it.id, pos);
                      }}
                    >
                      <img className={`thumb ${thumb ? "" : "empty"}`} src={thumb || ""} alt="" />
                      <div className="qmid">
                        <div className="qtitle">{it.title || "(untitled)"}</div>
                        <div className="qpath">{it.photoPath}</div>
                        <div className="qmeta">
                          {it.status === "done_warn" ? <span className="badge warn">done (warnings)</span> : <span className="badge">{it.status}</span>}
                          <span className="badge">{PRIVACY_LABEL[it.privacy || "private"]}</span>
                          {(it.groupIds?.length || 0) > 0 ? <span className="badge">{it.groupIds.length} groups</span> : null}
                          {(it.albumIds?.length || 0) > 0 ? <span className="badge">{it.albumIds.length} albums</span> : null}
                          {sched?.schedulerOn && scheduledMap[it.id] ? <span className="badge">Scheduled: {formatLocal(scheduledMap[it.id])}</span> : null}
                          {it.uploadedAt ? <span className="badge">Uploaded: {formatLocal(it.uploadedAt)}</span> : null}
                          {it.lastError ? <span className="badge bad" title={it.lastError}>Error</span> : null}
                        </div>
                      </div>
                      <span
                        className="drag"
                        draggable
                        title="Drag to reorder"
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", it.id);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                      >
                        ↕
                      </span>
                    </div>
                  );
                })}
              </div>
              {!queue.length && <div className="small">Queue is empty. Click “Add Photos”.</div>}
              <div className="small" style={{ marginTop: 10 }}>
                Selection: click • shift-click (range) • cmd/ctrl-click (toggle)
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Edit</h2>
            <div className="content">
              {selectedIds.length > 1 && (
                <>
                  <div className="badge" style={{ marginBottom: 10 }}>Batch edit: {selectedIds.length} selected</div>

                  <label className="small">Title (optional)</label>
                  <input className="input" value={batchTitle} onChange={(e) => setBatchTitle(e.target.value)} placeholder="Leave blank to keep existing" />

                  <div style={{ height: 10 }} />
                  <label className="small">Tags (comma-separated) (optional)</label>
                  <input className="input" value={batchTags} onChange={(e) => setBatchTags(e.target.value)} placeholder="e.g., travel, chicago, black and white" />
                  <div className="small" style={{ marginTop: 6 }}>
                    Multi-word tags are supported (we’ll quote them automatically for Flickr).
                  </div>

                  <div style={{ height: 10 }} />
                  <label className="small">Description (optional)</label>
                  <textarea className="textarea" value={batchDescription} onChange={(e) => setBatchDescription(e.target.value)} placeholder="Leave blank to keep existing" />

                  <div style={{ height: 10 }} />
                  <label className="small">Privacy (optional)</label>
                  <select className="input" value={batchPrivacy} onChange={(e) => setBatchPrivacy(e.target.value as any)}>
                    <option value="">(leave unchanged)</option>
                    <option value="public">Public</option>
                    <option value="friends">Friends only</option>
                    <option value="family">Family only</option>
                    <option value="friends_family">Friends & Family</option>
                    <option value="private">Private</option>
                  </select>

                  <div style={{ height: 10 }} />
                  <label className="small">Create new albums (comma-separated titles) (optional)</label>
                  <input className="input" value={batchCreateAlbums} onChange={(e) => setBatchCreateAlbums(e.target.value)} placeholder="e.g., Trip 2026, Portfolio" />

                  <div style={{ height: 12 }} />
                  <button className="btn primary" onClick={applyBatch}>Apply to selected</button>

                  <div className="hr" />

                  <div className="small">Groups (tri-state)</div>
                  <div style={{ height: 8 }} />
                  <div className="listbox">
                    {groups.map(g => (
                      <label key={g.id} className="listrow">
                        <TriCheck state={triState("group", g.id)} onToggle={(next) => setForSelected("group", g.id, next)} />
                        <span className="small">{g.name}</span>
                      </label>
                    ))}
                    {!groups.length && <div className="small">Load groups in Setup tab.</div>}
                  </div>

                  <div style={{ height: 12 }} />
                  <div className="small">Albums (tri-state)</div>
                  <div style={{ height: 8 }} />
                  <div className="listbox">
                    {albums.map(a => (
                      <label key={a.id} className="listrow">
                        <TriCheck state={triState("album", a.id)} onToggle={(next) => setForSelected("album", a.id, next)} />
                        <span className="small">{a.title}</span>
                      </label>
                    ))}
                    {!albums.length && <div className="small">Load albums in Setup tab.</div>}
                  </div>
                </>
              )}

              {selectedIds.length <= 1 && !active && (
                <div className="small">Select an item to edit.</div>
              )}

              {selectedIds.length <= 1 && active && (
                <>
                  <div className="small" style={{ marginBottom: 8 }}>
                    Single-item edit. (Tip: select multiple items in the queue for batch edit.)
                  </div>

                  <label className="small">Title</label>
                  <input className="input" value={active.title} onChange={(e) => updateActive({ title: e.target.value })} />

                  <div style={{ height: 10 }} />
                  <label className="small">Tags (comma-separated)</label>
                  <input className="input" value={active.tags} onChange={(e) => updateActive({ tags: e.target.value })} placeholder="e.g., travel, street photo, black and white" />
                  <div className="small" style={{ marginTop: 6 }}>
                    Multi-word tags are supported (we’ll quote them automatically for Flickr).
                  </div>

                  <div style={{ height: 10 }} />
                  <label className="small">Description</label>
                  <textarea className="textarea" value={active.description} onChange={(e) => updateActive({ description: e.target.value })} />

                  <div style={{ height: 10 }} />
                  <label className="small">Privacy</label>
                  <select className="input" value={active.privacy || "private"} onChange={(e) => updateActive({ privacy: e.target.value as any })}>
                    <option value="public">Public</option>
                    <option value="friends">Friends only</option>
                    <option value="family">Family only</option>
                    <option value="friends_family">Friends & Family</option>
                    <option value="private">Private</option>
                  </select>

                  <div className="hr" />

                  <div className="split">
                    <div>
                      <div className="small">Groups</div>
                      <div className="listbox">
                        {groups.map(g => (
                          <label key={g.id} className="listrow">
                            <input
                              type="checkbox"
                              checked={(active.groupIds || []).includes(g.id)}
                              onChange={(e) => updateActive({ groupIds: toggleIds(active.groupIds || [], g.id, e.target.checked ? "add" : "remove") })}
                            />
                            <span className="small">{g.name}</span>
                          </label>
                        ))}
                        {!groups.length && <div className="small">Load groups in Setup tab.</div>}
                      </div>
                    </div>
                    <div>
                      <div className="small">Albums</div>
                      <div className="listbox">
                        {albums.map(a => (
                          <label key={a.id} className="listrow">
                            <input
                              type="checkbox"
                              checked={(active.albumIds || []).includes(a.id)}
                              onChange={(e) => updateActive({ albumIds: toggleIds(active.albumIds || [], a.id, e.target.checked ? "add" : "remove") })}
                            />
                            <span className="small">{a.title}</span>
                          </label>
                        ))}
                        {!albums.length && <div className="small">Load albums in Setup tab.</div>}
                      </div>
                    </div>
                  </div>

                  <div style={{ height: 10 }} />
                  <div className="small">Create new albums (comma-separated titles)</div>
                  <input
                    className="input"
                    value={(active.createAlbums || []).join(",")}
                    onChange={(e) => updateActive({ createAlbums: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                    placeholder="e.g., Trip 2026, Portfolio"
                  />

                  <div style={{ height: 14 }} />
                  <button className="btn primary" onClick={uploadNext} disabled={!cfg?.authed || !queue.length}>Upload Next Item Now</button>
                  {active.lastError ? <div className="small" style={{ color: "var(--bad)", marginTop: 10 }}>{active.lastError}</div> : null}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === "schedule" && (
        <div className="grid">
          <div className="card">
            <h2>Scheduler</h2>
            <div className="content">
              <div className="small">Uploads the next item at each interval. Reordering affects what uploads next.</div>

              <div style={{ height: 12 }} />
              <label className="small">Upload every X hours (1–168)</label>
              <input
                className="input"
                type="number"
                step={1}
                min={1}
                max={168}
                value={intervalHours}
                onChange={(e) => setIntervalHours(parseInt(e.target.value || "1", 10))}
                style={{ maxWidth: 160 }}
              />

              <div style={{ height: 10 }} />
              <label className="listrow" style={{ padding: 0 }}>
                <input type="checkbox" checked={timeWindowEnabled} onChange={(e) => { setTimeWindowEnabled(e.target.checked); if (e.target.checked) setDaysEnabled(false); }} />
                <span className="small">Only upload during these times</span>
              </label>
              <div style={{ height: 8 }} />
              <div className="row">
                <div style={{ minWidth: 180 }}>
                  <div className="small">Start</div>
                  <input className="input" type="time" value={windowStart} disabled={!timeWindowEnabled} onChange={(e) => setWindowStart(e.target.value)} style={{ opacity: timeWindowEnabled ? 1 : 0.5 }} />
                </div>
                <div style={{ minWidth: 180 }}>
                  <div className="small">End</div>
                  <input className="input" type="time" value={windowEnd} disabled={!timeWindowEnabled} onChange={(e) => setWindowEnd(e.target.value)} style={{ opacity: timeWindowEnabled ? 1 : 0.5 }} />
                </div>
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                If End is earlier than Start (e.g., 15:00 → 05:00), ShutterQueue assumes you mean an overnight window.
              </div>

              <div className="hr" />

              <label className="listrow" style={{ padding: 0, opacity: timeWindowEnabled ? 0.5 : 1 }}>
                <input type="checkbox" checked={daysEnabled} disabled={timeWindowEnabled} onChange={(e) => setDaysEnabled(e.target.checked)} />
                <span className="small">Only upload on selected days</span>
              </label>
              <div style={{ height: 8 }} />
              <div className="row" style={{ opacity: (daysEnabled && !timeWindowEnabled) ? 1 : 0.5 }}>
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, idx) => (
                  <label key={d} className="listrow" style={{ padding: 0 }}>
                    <input
                      type="checkbox"
                      disabled={!daysEnabled || timeWindowEnabled}
                      checked={allowedDays.includes(idx)}
                      onChange={(e) => {
                        if (e.target.checked) setAllowedDays(prev => Array.from(new Set([...prev, idx])).sort());
                        else setAllowedDays(prev => prev.filter(x => x !== idx));
                      }}
                    />
                    <span className="small">{d}</span>
                  </label>
                ))}
              </div>

              <div className="hr" />

              <label className="listrow" style={{ padding: 0 }}>
                <input type="checkbox" checked={resumeOnLaunch} onChange={(e) => setResumeOnLaunch(e.target.checked)} />
                <span className="small">Automatically resume scheduler when app restarts</span>
              </label>


              <div style={{ height: 12 }} />
              <div className="row">
                <button className="btn primary" onClick={startSched} disabled={!cfg?.authed || !queue.length}>Start</button>
                <button className="btn" onClick={stopSched}>Stop</button>
                <button className="btn" onClick={uploadNext} disabled={!cfg?.authed || !queue.length}>Upload Next Item Now</button>
              </div>

              <div style={{ height: 12 }} />
              <div className="small">Next run: <span style={{ fontFamily: "ui-monospace" }}>{formatLocal(sched?.nextRunAt)}</span></div>
              <div className="small" style={{ marginTop: 8 }}>MVP: scheduler runs while the app is open.</div>
            </div>
          </div>

          <div className="card">
            <h2>Status</h2>
            <div className="content">
              <div className="small">Scheduler: {sched?.schedulerOn ? "ON" : "OFF"}</div>
              <div className="small">Interval hours: {sched?.intervalHours ?? "—"}</div>
              <div className="small"> {sched?.lastError || "—"}</div>
            </div>
          </div>
        </div>
      )}

      
{tab === "logs" && (
  <div className="grid">
    <div className="card">
      <h2>Activity Log</h2>
      <div className="content">
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn" onClick={async () => { setLogs(await window.sq.logGet()); showToast("Log refreshed."); }}>Refresh</button>
          <button className="btn danger" onClick={async () => { await window.sq.logClear(); setLogs([]); showToast("Log cleared."); }}>Clear log</button>
        </div>
        <div className="listbox" style={{ maxHeight: 520 }}>
          {logs.slice().reverse().map((line, i) => (
            <div key={i} className="listrow" style={{ alignItems: "flex-start" }}>
              <div className="small" style={{ fontFamily: "ui-monospace", whiteSpace: "pre-wrap" }}>{line}</div>
            </div>
          ))}
          {!logs.length && <div className="small">No log entries yet.</div>}
        </div>
        <div className="small" style={{ marginTop: 10 }}>
          Tip: if a group rejects a post, the upload will still be marked “done (warnings)” so it won’t re-upload the photo.
        </div>
      </div>
    </div>
  </div>
)}
<div className="small footer">By Paul Nicholson. Not an official Flickr app.</div>
      <div className="footer-fixed">
        <div className="footer-left">
          <span>By Paul Nicholson. Not an official Flickr app.</span>
        </div>
        <div className="footer-right">
          <span className="mono">v{appVersion || "0.7.2"}</span>
        </div>
      </div>

    </div>
  );
}