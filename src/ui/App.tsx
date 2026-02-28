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

const SAFETY_LABEL: Record<1 | 2 | 3, string> = {
  1: "Safe",
  2: "Moderate",
  3: "Restricted",
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

function fileNameFromPath(p?: string) {
  try {
    if (!p) return "";
    const parts = p.split(/[/\\]/);
    return parts[parts.length - 1] || "";
  } catch {
    return "";
  }
}

function resolveThumbSrc(item: any, thumbs: Record<string, string | null | undefined>, flickrUrls: Record<string, {thumbUrl:string; previewUrl:string} | undefined>) {
  const local = item?.photoPath ? thumbs[item.photoPath] : null;
  if (local) return { thumbSrc: local, previewSrc: local };
  const pid = item?.photoId;
  const remote = pid ? flickrUrls[pid] : undefined;
  if (remote?.thumbUrl) return { thumbSrc: remote.thumbUrl, previewSrc: remote.previewUrl || remote.thumbUrl };
  return { thumbSrc: "", previewSrc: "" };
}


function parseTagsCsv(csv: string): string[] {
  // Tags are stored comma-separated in UI.
  // Normalize: trim, collapse whitespace, drop empties, de-dupe case-insensitively.
  const raw = (csv || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/\s+/g, " "));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function formatTagsCsv(tags: string[]): string {
  return tags.join(", ");
}

function deriveTitleFromPhotoPath(photoPath: string): string {
  const p = String(photoPath || "");
  // Support Windows and POSIX paths
  const base = p.split(/[/\\]/).pop() || "";
  // Remove final extension (e.g., .jpg, .jpeg). Keep dots in the basename (e.g., "my.photo")
  const noExt = base.replace(/\.[^\.]+$/, "");
  return noExt || base || "";
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
const groupNameById = useMemo(() => {
  const m = new Map<string, string>();
  for (const g of groups) m.set(String(g.id), String(g.name));
  return m;
}, [groups]);

const albumTitleById = useMemo(() => {
  const m = new Map<string, string>();
  for (const a of albums) m.set(String(a.id), String(a.title));
  return m;
}, [albums]);

const friendlyIdInMessage = (msg?: string) => {
  if (!msg) return msg;
  // Replace "group <id>" / "album <id>" with friendly names when possible.
  // Handles both "group <id>:" and "... for group <id>." patterns.
  return msg.replace(/\b(group|album)\s+([^\s:,.]+)(\s*:)?/gi, (full, kindRaw, idRaw, colon) => {
    const kind = String(kindRaw).toLowerCase();
    const id = String(idRaw);
    if (kind === "group") {
      const name = groupNameById.get(id);
      if (!name) return full;
      return colon ? `group "${name}":` : `group "${name}"`;
    }
    if (kind === "album") {
      const title = albumTitleById.get(id);
      if (!title) return full;
      return colon ? `album "${title}":` : `album "${title}"`;
    }
    return full;
  });
};

  const [didAutoLoadLists, setDidAutoLoadLists] = useState(false);

  const [appVersion, setAppVersion] = useState<string>("");
  const [isUploadingNow, setIsUploadingNow] = useState(false);

    const [showSetup, setShowSetup] = useState(true);
const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  // Remote (Flickr) URLs used when the local file is missing.
  const [flickrUrls, setFlickrUrls] = useState<Record<string, { thumbUrl: string; previewUrl: string }>>({});

  // Full-window image preview overlay.
  const [preview, setPreview] = useState<{ src: string; title?: string } | null>(null);

  const [pendingGroupFocus, setPendingGroupFocus] = useState<string>("");

  const pendingRetryGroups = useMemo(() => {
    // Build list of groups that currently have at least one pending retry.
    const counts = new Map<string, number>();
    for (const item of queue) {
      const states = item.groupAddStates || {};
      for (const [gid, st] of Object.entries(states)) {
        if (st?.status === "retry") counts.set(gid, (counts.get(gid) || 0) + 1);
      }
    }
    const out = Array.from(counts.entries()).map(([groupId, count]) => ({
      groupId,
      count,
      groupName: groupNameById.get(groupId) || groupId,
    }));
    out.sort((a, b) => a.groupName.localeCompare(b.groupName));
    return out;
  }, [queue, groupNameById]);

  const pendingRetryItemsForFocus = useMemo(() => {
    if (!pendingGroupFocus) return [];
    const out: Array<{ itemId: string; title: string; photoPath: string; photoId: string; nextRetryAt?: string | null }> = [];
    for (const item of queue) {
      const st = item.groupAddStates?.[pendingGroupFocus];
      if (st?.status === "retry") {
        out.push({ itemId: item.id, title: item.title || "(untitled)", photoPath: item.photoPath, photoId: item.photoId || "", nextRetryAt: st.nextRetryAt || null });
      }
    }
    out.sort((a, b) => String(a.nextRetryAt || "").localeCompare(String(b.nextRetryAt || "")));
    return out;
  }, [queue, pendingGroupFocus]);

  useEffect(() => {
    if (!pendingRetryGroups.length) return;
    const exists = pendingRetryGroups.some(g => g.groupId === pendingGroupFocus);
    if (!pendingGroupFocus || !exists) setPendingGroupFocus(pendingRetryGroups[0].groupId);
  }, [pendingRetryGroups, pendingGroupFocus]);

  const isGroupAlbumErrorText = (s?: string | null) => {
    if (!s) return false;
    return /\bgroup\b|\balbum\b/i.test(String(s));
  };

  
  const removeGroupRetryAndSelection = (it: QueueItem, groupId: string): QueueItem => {
    const gid = String(groupId);

    const nextStates: any = { ...(it.groupAddStates || {}) };
    if (nextStates[gid]) delete nextStates[gid];
    const nextGroupIds = (it.groupIds || []).map(String).filter(x => x !== gid);

    const remainingStates = Object.values(nextStates).filter(Boolean) as any[];
    const hasNonDone = remainingStates.some(st => st && st.status && st.status !== "done");

    // Clear item-level group/album-style lastError only if nothing else is pending.
    const nextLastError = (!hasNonDone && isGroupAlbumErrorText(it.lastError)) ? undefined : it.lastError;

    const updated: QueueItem = {
      ...it,
      groupIds: nextGroupIds,
      groupAddStates: remainingStates.length ? nextStates : undefined,
      status: (!hasNonDone && it.status === "done_warn") ? "done" : it.status,
      lastError: nextLastError,
    };

    return updated;
  };

const removePendingRetryForGroup = async (groupId: string, itemId: string) => {
    const it = queue.find(x => x.id === itemId);
    if (!it) return;
    const updated = removeGroupRetryAndSelection(it, groupId);
    setQueue(prev => prev.map(q => (q.id === updated.id ? updated : q)));
    await updateItems([updated]);
  };



  const active = useMemo(() => queue.find(q => q.id === activeId) || null, [queue, activeId]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const selectedItems = useMemo(
    () => queue.filter(it => selectedSet.has(it.id)),
    [queue, selectedSet]
  );

  const commonTags = useMemo(() => {
    if (selectedItems.length < 2) return [] as string[];

    // Compare case-insensitively, but preserve a stable display value.
    const displayByLc = new Map<string, string>();
    let intersection: Set<string> | null = null;

    for (const it of selectedItems) {
      const tags = parseTagsCsv(it.tags);
      const lcSet = new Set<string>();
      for (const t of tags) {
        const lc = t.toLowerCase();
        lcSet.add(lc);
        if (!displayByLc.has(lc)) displayByLc.set(lc, t);
      }

      if (!intersection) intersection = lcSet;
      else {
        for (const lc of Array.from(intersection)) {
          if (!lcSet.has(lc)) intersection.delete(lc);
        }
      }
    }

    return Array.from(intersection || [])
      .map(lc => displayByLc.get(lc) || lc)
      .sort((a, b) => a.localeCompare(b));
  }, [selectedItems]);

  const hasOtherTags = useMemo(() => {
    if (selectedItems.length < 2) return false;
    const union = new Set<string>();
    for (const it of selectedItems) {
      for (const t of parseTagsCsv(it.tags)) union.add(t.toLowerCase());
    }
    return union.size > commonTags.length;
  }, [selectedItems, commonTags]);



  const [intervalHours, setIntervalHours] = useState<number>(24);
  const [timeWindowEnabled, setTimeWindowEnabled] = useState<boolean>(false);
  const [windowStart, setWindowStart] = useState<string>("07:00");
  const [windowEnd, setWindowEnd] = useState<string>("22:00");
  const [daysEnabled, setDaysEnabled] = useState<boolean>(false);
  const [allowedDays, setAllowedDays] = useState<number[]>([1,2,3,4,5]);
  const [resumeOnLaunch, setResumeOnLaunch] = useState<boolean>(false);
  const [uploadBatchSize, setUploadBatchSize] = useState<number>(1);
  const [skipOvernight, setSkipOvernight] = useState<boolean>(false);
  const [sched, setSched] = useState<any>(null);

  const [toast, setToast] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800); };

  // refresh only the configuration settings that back the form fields
  const refreshConfig = async () => {
    const c = await window.sq.getConfig();
    setCfg(c);
    const le = String(c.lastError || "");
    const authish = /oauth_problem|\b(95|96|97|98|99|100)\b/i.test(le);
    if (authish) setShowSetupAdvanced(true);
    else if (c.authed) setShowSetupAdvanced(false);

    setIntervalHours(Number(c.intervalHours || 24));
    setTimeWindowEnabled(Boolean(c.timeWindowEnabled));
    setWindowStart(String(c.windowStart || "07:00"));
    setWindowEnd(String(c.windowEnd || "22:00"));
    setDaysEnabled(Boolean(c.daysEnabled));
    setAllowedDays(Array.isArray(c.allowedDays) ? c.allowedDays : [1,2,3,4,5]);
    setResumeOnLaunch(Boolean(c.resumeOnLaunch));
    setUploadBatchSize(Math.max(1, Math.min(999, Math.round(Number((c as any).uploadBatchSize || 1)))));

    // scheduler defaults (only set once if missing)
    if (typeof c.timeWindowEnabled !== "boolean") setTimeWindowEnabled(false);
    if (typeof c.daysEnabled !== "boolean") setDaysEnabled(false);

    // hide setup UI if already authed
    if (c.authed) setShowSetup(false);
    setSkipOvernight(Boolean(c.skipOvernight));
    // only set API key when field is empty so we don't clobber user input
    if (!apiKey) setApiKey(c.apiKey || "");
    // note: apiSecret is intentionally left untouched here
  };

  // refresh data that may change without user interaction
  const refreshDynamic = async () => {
    const q = await window.sq.queueGet();
    setQueue(q);
    if (!activeId && q.length) setActiveId(q[0].id);

    // Ensure default titles (filename without extension) for items missing a title
    try {
      const needsTitle = q.filter(it => !String(it.title || "").trim());
      if (needsTitle.length) {
        const patched = needsTitle.map(it => ({ ...it, title: deriveTitleFromPhotoPath(it.photoPath) }));
        const q2 = await window.sq.queueUpdate(patched);
        setQueue(q2);
        if (!activeId && q2.length) setActiveId(q2[0].id);
      }
    } catch {
      // ignore
    }
    setSched(await window.sq.schedulerStatus());
    try { setLogs(await window.sq.logGet()); } catch { /* ignore */ }
  };

  const refreshAll = async () => {
    // new behaviour: always update config/dynamic via helpers and exit early
    await refreshConfig();
    await refreshDynamic();
    return;
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
    setUploadBatchSize(Math.max(1, Math.min(999, Math.round(Number((c as any).uploadBatchSize || 1)))));

    // scheduler defaults (only set once if missing)
    if (typeof c.timeWindowEnabled !== "boolean") setTimeWindowEnabled(false);
    if (typeof c.daysEnabled !== "boolean") setDaysEnabled(false);

    // hide setup UI if already authed
    if (c.authed) setShowSetup(false);
    setSkipOvernight(Boolean(c.skipOvernight));
    setApiKey(c.apiKey || "");
    // Do NOT clear apiSecret here—the user may be typing it in.
    // The backend only returns a presence flag (hasApiSecret), not the actual secret.
    // The user's locally-entered secret should persist until they logout or refresh the page.
    const q = await window.sq.queueGet();
    setQueue(q);
    if (!activeId && q.length) setActiveId(q[0].id);

    // Ensure default titles (filename without extension) for items missing a title
    try {
      const needsTitle = q.filter(it => !String(it.title || "").trim());
      if (needsTitle.length) {
        const patched = needsTitle.map(it => ({ ...it, title: deriveTitleFromPhotoPath(it.photoPath) }));
        const q2 = await window.sq.queueUpdate(patched);
        setQueue(q2);
        if (!activeId && q2.length) setActiveId(q2[0].id);
      }
    } catch {
      // ignore
    }
    setSched(await window.sq.schedulerStatus());
    try { setLogs(await window.sq.logGet()); } catch { /* ignore */ }

  };


  useEffect(() => {
    (async () => {
      try {
        // @ts-ignore - declared in global.d.ts but TS sometimes forgets it
        const v = await window.sq.appVersion();
        setAppVersion(v || "");
      } catch {
        // ignore
      }
    })();
  }, []);
  useEffect(() => { refreshAll(); }, []);

  // Background work can update app state without user interaction (especially in packaged builds).
  // Poll lightly to keep UI consistent; only refresh the dynamic data, not the form config.
  const refreshDynamicRef = useRef(refreshDynamic);
  useEffect(() => {
    refreshDynamicRef.current = refreshDynamic;
  });
  useEffect(() => {
    const t = window.setInterval(() => {
      void refreshDynamicRef.current?.();
    }, 1500);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!cfg?.authed) return;
    if (didAutoLoadLists) return;
    (async () => {
      try {
        const [g, a] = await Promise.all([window.sq.fetchGroups(), window.sq.fetchAlbums()]);
        setGroups(g);
        setAlbums(a);
      } catch {
        // ignore
      } finally {
        setDidAutoLoadLists(true);
      }
    })();
  }, [cfg?.authed, didAutoLoadLists]);


  useEffect(() => {
    (async () => {
      for (const it of queue.slice(0, 120)) {
        // Try to load local thumbnail if we haven't cached it yet
        let dataUrl = thumbs[it.photoPath];
        if (dataUrl === undefined) {
          dataUrl = await window.sq.getThumbDataUrl(it.photoPath);
          setThumbs(t => ({ ...t, [it.photoPath]: dataUrl }));
        }
        // If local thumbnail is missing and item has a photoId, try fetching from Flickr
        if (!dataUrl && it.photoId && flickrUrls[it.photoId] === undefined) {
          try {
            // @ts-ignore - dynamic typing for sq API
            const u = await window.sq.getFlickrPhotoUrls(it.photoId);
            setFlickrUrls(m => ({ ...m, [it.photoId as any]: u }));
          } catch {
            // ignore
          }
        }
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

  const refreshGroups = async () => {
    const g = await window.sq.fetchGroups();
    setGroups(g);
    showToast(`Loaded ${g.length} groups.`);
  };

  const refreshAlbums = async () => {
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

    // Set default titles for newly added photos that don't have a title yet
    const newlyAdded = q.filter(it => paths.includes(it.photoPath) && !String(it.title || "").trim());
    if (newlyAdded.length) {
      const patched = newlyAdded.map(it => ({ ...it, title: deriveTitleFromPhotoPath(it.photoPath) }));
      const q2 = await window.sq.queueUpdate(patched);
      setQueue(q2);
      if (!activeId && q2.length) setActiveId(q2[0].id);
    }

    // Set default safety level (Safe) for newly added photos missing safetyLevel
    const newlyAddedNeedsSafety = q.filter(it => paths.includes(it.photoPath) && (it as any).safetyLevel == null);
    if (newlyAddedNeedsSafety.length) {
      const patched = newlyAddedNeedsSafety.map(it => ({ ...it, safetyLevel: 1 as any }));
      const q2 = await window.sq.queueUpdate(patched);
      setQueue(q2);
      if (!activeId && q2.length) setActiveId(q2[0].id);
    }
    showToast(`Added ${paths.length} photo(s).`);
  };

  const selectAll = () => setSelectedIds(queue.map(q => q.id));
  const clearSelection = () => setSelectedIds([]);

  const removeSelected = async () => {
    const ids = selectedIds.length ? selectedIds : (activeId ? [activeId] : []);
    if (!ids.length) return;

    // If any items are waiting on group retry, confirm how to proceed.
    const waitingIds = ids.filter(id => {
      const it = queue.find(q => q.id === id);
      if (!it?.groupAddStates) return false;
      return Object.values(it.groupAddStates).some(st => st?.status === "retry");
    });

    let finalIds = ids;
    if (waitingIds.length) {
      const removeAll = window.confirm(
        "One or more items being removed is still waiting to be added to a group.\n\nOK = Remove items from queue.\nCancel = Keep photos that are waiting."
      );
      if (!removeAll) {
        // Keep waiting photos; remove only those not waiting.
        finalIds = ids.filter(id => !waitingIds.includes(id));
        if (!finalIds.length) return;
      }
    }

    const q = await window.sq.queueRemove(finalIds);
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


  const persistScheduler = (partial: any) => {
    try {
      // Persist scheduler settings immediately so the periodic refresh does not overwrite user changes.
      void window.sq.setSchedulerSettings(partial);
    } catch {
      // ignore
    }
  };

  const startSched = async () => {
    const h = Math.max(1, Math.min(168, Math.round(Number(intervalHours || 24))));

    // ask user how they want to start the scheduler
    const choice = await window.sq.showStartSchedulerDialog();
    if (choice === "cancel") {
      // user explicitly cancelled; do nothing
      showToast("Scheduler start canceled.");
      return;
    }

    const uploadImmediately = choice === "now";

    await window.sq.schedulerStart(h, uploadImmediately, {
      timeWindowEnabled,
      windowStart,
      windowEnd,
      daysEnabled,
      allowedDays,
      resumeOnLaunch,
      uploadBatchSize,
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

  // Clear the batch tag input whenever the selection changes in multi-select mode.
  useEffect(() => {
    if (selectedIds.length >= 2) setBatchTags("");
  }, [selectedIds.join("|")]);

  const [batchDescription, setBatchDescription] = useState("");
  const [batchPrivacy, setBatchPrivacy] = useState<Privacy | "">( "" );
  const [batchSafety, setBatchSafety] = useState<"" | 1 | 2 | 3>("");
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
      if (batchTags.trim()) {
        const existing = parseTagsCsv(next.tags);
        const add = parseTagsCsv(batchTags);
        const merged = formatTagsCsv(uniq([...existing, ...add]));
        next.tags = merged;
      }
      if (batchDescription.trim()) next.description = batchDescription;
      if (batchCreateAlbums.trim()) next.createAlbums = batchCreateAlbums.split(",").map(s => s.trim()).filter(Boolean);
      if (batchPrivacy) next.privacy = batchPrivacy as Privacy;
      if (batchSafety) next.safetyLevel = batchSafety as 1 | 2 | 3;
      changed.push(next);
    }
    if (!changed.length) return;
    setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
    await updateItems(changed);
    showToast(`Applied to ${changed.length} item(s).`);

  };

  const removeTagFromSelected = async (tag: string) => {
    if (!selectedIds.length) return;
    const byId = new Map(queue.map(it => [it.id, it]));
    const changed: QueueItem[] = [];
    for (const id of selectedIds) {
      const it = byId.get(id);
      if (!it) continue;
      const lc = tag.toLowerCase();
      const tags = parseTagsCsv(it.tags).filter(t => t.toLowerCase() !== lc);
      const next: QueueItem = { ...it, tags: formatTagsCsv(tags) };
      changed.push(next);
    }
    if (!changed.length) return;
    setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
    await updateItems(changed);
    await refreshAll();
    showToast(`Removed tag “${tag}” from ${changed.length} item(s).`);
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
      if (kind === "group") {
        let updated: QueueItem = { ...it, groupIds: toggleIds(it.groupIds || [], id, next === "all" ? "add" : "remove") };
        if (next === "none") updated = removeGroupRetryAndSelection(updated, id);
        changed.push(updated);
      }
      else changed.push({ ...it, albumIds: toggleIds(it.albumIds || [], id, next === "all" ? "add" : "remove") });
    }
    setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
    await updateItems(changed);
  };

  const scheduledMap = useMemo(() => {
    const out: Record<string, string> = {};
    if (!sched?.schedulerOn) return out;

    const h = Number(sched?.intervalHours || intervalHours || 24);
    const batch = Math.max(1, Math.min(999, Math.round(Number((sched as any)?.uploadBatchSize || uploadBatchSize || 1))));

    // When a batch run is active, nextRunAt has already been advanced to the next interval.
    // For items that are about to upload in the *current* batch, display "current batch" instead of a future timestamp.
    const isBatchActive = Boolean((sched as any)?.batchRunActive);
    const batchStartedAt = (sched as any)?.batchRunStartedAt ? String((sched as any).batchRunStartedAt) : null;
    const batchRunSize = Number((sched as any)?.batchRunSize || batch);

    const pending = queue.filter(it => it.status === "pending");
    if (!pending.length) return out;

    if (isBatchActive && batchStartedAt) {
      const startMs = Date.parse(batchStartedAt);
      const uploadedThisRun = queue.filter(it => it.uploadedAt && Date.parse(it.uploadedAt) >= startMs).length;
      const uploadingNow = queue.filter(it => it.status === "uploading").length;
      const remainingInCurrentBatch = Math.max(0, batchRunSize - uploadedThisRun - uploadingNow);

      // Mark the next N pending items as part of the current batch.
      for (let i = 0; i < pending.length; i++) {
        if (i < remainingInCurrentBatch) out[pending[i].id] = "__current_batch__";
      }

      // Schedule the rest starting at nextRunAt (already bumped forward at the start of the run).
      let t = sched?.nextRunAt ? new Date(sched.nextRunAt).getTime() : Date.now();
      let j = 0;
      for (let i = remainingInCurrentBatch; i < pending.length; i++) {
        out[pending[i].id] = new Date(t).toISOString();
        j += 1;
        if (j % batch === 0) t += h * 3600 * 1000;
      }
      return out;
    }

    // Normal case: upcoming schedule starts at nextRunAt.
    let t = sched?.nextRunAt ? new Date(sched.nextRunAt).getTime() : Date.now();
    let i = 0;
    for (const it of pending) {
      out[it.id] = new Date(t).toISOString();
      i += 1;
      if (i % batch === 0) t += h * 3600 * 1000;
    }
    return out;
  }, [queue, sched, intervalHours, uploadBatchSize]);

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
        <button className={`btn ${tab==="queue"?"primary":""}`} onClick={() => setTab("queue")}>Queue</button>
        <button className={`btn ${tab==="schedule"?"primary":""}`} onClick={() => setTab("schedule")}>Schedule</button>
        <button className={`btn ${tab==="logs"?"primary":""}`} onClick={() => setTab("logs")}>Logs</button>
        <button className={`btn ${tab==="setup"?"primary":""}`} onClick={() => setTab("setup")}>Setup</button>
      </div>

      {toast && <div className="badge" style={{ borderColor: "rgba(139,211,255,0.35)", color: "var(--accent)", marginBottom: 12 }}>{toast}</div>}
      {cfg?.lastError ? <div className="badge bad" style={{ marginBottom: 12 }}> {friendlyIdInMessage(cfg.lastError)}</div> : null}

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
                <button className="btn" onClick={refreshGroups} disabled={!cfg?.authed}>Refresh Groups</button>
                <button className="btn" onClick={refreshAlbums} disabled={!cfg?.authed}>Refresh Albums</button>
            <button className="btn" onClick={async () => { await (window as any).api.openThirdPartyLicenses?.(); }}>View Third-Party Licenses</button>

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
	                  const srcs = resolveThumbSrc(it, thumbs, flickrUrls);
	                  const thumb = srcs.thumbSrc;
                  const isSelected = selectedSet.has(it.id);
                  const hasPendingGroupRetries = !!it.groupAddStates && Object.values(it.groupAddStates).some(st => st?.status === "retry");
                  const pendingGroupsTooltip = hasPendingGroupRetries
                    ? (
                        Object.entries(it.groupAddStates || {})
                          .filter(([, st]) => st?.status === "retry")
                          .map(([gid, st]) => {
                            const gname = groupNameById.get(String(gid)) || String(gid);
                            const next = (!sched?.schedulerOn) ? "waiting for scheduler restart" : (st?.nextRetryAt ? formatLocal(st.nextRetryAt) : "—");
                            const msg = st?.message ? friendlyIdInMessage(st.message) : "Will retry";
                            return `${gname} • next: ${next} • ${msg}`;
                          })
                          .join("\n")
                      )
                    : "";
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
	                      <img
	                        className={`thumb ${thumb ? "" : "empty"}`}
	                        src={thumb || ""}
	                        alt=""
	                        onClick={(e) => {
	                          // Prevent row-click selection toggle when opening preview.
	                          e.stopPropagation();
	                          if (!srcs.previewSrc) return;
	                          setPreview({
	                            src: srcs.previewSrc,
	                            title: it.title || fileNameFromPath(it.photoPath),
	                          });
	                        }}
	                        style={{ cursor: srcs.previewSrc ? "pointer" : "default" }}
	                      />
                      <div className="qmid">
                        <div className="qtitle">{it.title || "(untitled)"}</div>
                        <div className="qpath">{it.photoPath}</div>
                        <div className="qmeta">
                          {it.status === "done_warn" ? (
                            hasPendingGroupRetries ? <span className="badge">done</span> : <span className="badge warn">done (warnings)</span>
                          ) : (
                            <span className="badge">{it.status}</span>
                          )}
                          <span className="badge">{PRIVACY_LABEL[it.privacy || "private"]}</span>
                          {(it.groupIds?.length || 0) > 0 ? <span className="badge">{it.groupIds.length} groups</span> : null}
                          {(it.albumIds?.length || 0) > 0 ? <span className="badge">{it.albumIds.length} albums</span> : null}
                          {sched?.schedulerOn && scheduledMap[it.id] ? <span className="badge">Scheduled: {scheduledMap[it.id] === "__current_batch__" ? "current batch" : formatLocal(scheduledMap[it.id])}</span> : null}
                          {it.status === "done_warn" && !hasPendingGroupRetries && it.lastError ? (
                            <span className="badge warn" title={friendlyIdInMessage(it.lastError)}>warnings: see details</span>
                          ) : null}
                          {it.uploadedAt ? <span className="badge">Uploaded: {formatLocal(it.uploadedAt)}</span> : null}
                          {hasPendingGroupRetries ? (
                            <span className="badge warn" title={pendingGroupsTooltip || ""}>Pending Group Additions</span>
                          ) : (
                            it.lastError ? <span className="badge bad" title={friendlyIdInMessage(it.lastError)}>Error</span> : null
                          )}
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
                  <div className="badge" style={{ marginBottom: 10, display: "block", width: "100%" }}>Batch edit: {selectedIds.length} selected</div>

                  <label className="small">Title (optional)</label>
                  <input className="input" value={batchTitle} onChange={(e) => setBatchTitle(e.target.value)} placeholder="Leave blank to keep existing" />

                  <div style={{ height: 10 }} />
                  <label className="small">Add tags (comma-separated) (optional)</label>

                  {commonTags.length > 0 && (
                    <div style={{ marginTop: 6, marginBottom: 6 }}>
                      <div className="small" style={{ marginBottom: 6 }}>Common tags on selected items</div>
                      <div className="chips">
                        {commonTags.map(t => (
                          <span key={t} className="chip">
                            {t}
                            <button className="chipX" title="Remove from all selected" onClick={() => removeTagFromSelected(t)}>×</button>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {hasOtherTags && (
                    <div className="small" style={{ marginTop: commonTags.length ? 0 : 6, marginBottom: 6 }}>
                      Other tags present on one or more selected items
                    </div>
                  )}

                  <input className="input" value={batchTags} onChange={(e) => setBatchTags(e.target.value)} placeholder="e.g., travel, chicago, black and white" />
                  <div className="small" style={{ marginTop: 6 }}>
                    New tags will be <b>added</b> to each selected item (existing tags are kept).
                  </div>

                  <div style={{ height: 10 }} />
                  <label className="small">Description (optional)</label>
                  <textarea className="textarea" value={batchDescription} onChange={(e) => setBatchDescription(e.target.value)} placeholder="Leave blank to keep existing" />

                  <div style={{ height: 10 }} />
                  <div className="split">
                    <div>
                      <label className="small">Privacy (optional)</label>
                      <select className="input" value={batchPrivacy} onChange={(e) => setBatchPrivacy(e.target.value as any)}>
                        <option value="">(leave unchanged)</option>
                        <option value="public">Public</option>
                        <option value="friends">Friends only</option>
                        <option value="family">Family only</option>
                        <option value="friends_family">Friends & Family</option>
                        <option value="private">Private</option>
                      </select>
                    </div>
                    <div>
                      <label className="small">Safety level (optional)</label>
                      <select className="input" value={batchSafety} onChange={(e) => {
                        const v = e.target.value;
                        setBatchSafety((v === "" ? "" : (Number(v) as any)));
                      }}>
                        <option value="">(leave unchanged)</option>
                        <option value="1">Safe</option>
                        <option value="2">Moderate</option>
                        <option value="3">Restricted</option>
                      </select>
                    </div>
                  </div>

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
                  <div className="split">
                    <div>
                      <label className="small">Privacy</label>
                      <select className="input" value={active.privacy || "private"} onChange={(e) => updateActive({ privacy: e.target.value as any })}>
                        <option value="public">Public</option>
                        <option value="friends">Friends only</option>
                        <option value="family">Family only</option>
                        <option value="friends_family">Friends & Family</option>
                        <option value="private">Private</option>
                      </select>
                    </div>
                    <div>
                      <label className="small">Safety level</label>
                      <select
                        className="input"
                        value={String((active as any).safetyLevel || 1)}
                        onChange={(e) => updateActive({ safetyLevel: Number(e.target.value) as any })}
                      >
                        <option value="1">Safe</option>
                        <option value="2">Moderate</option>
                        <option value="3">Restricted</option>
                      </select>
                    </div>
                  </div>

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
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (checked) {
                                  updateActive({ groupIds: toggleIds(active.groupIds || [], g.id, "add") });
                                } else {
                                  const updated = removeGroupRetryAndSelection(active, g.id);
                                  setQueue(prev => prev.map(it => it.id === updated.id ? updated : it));
                                  updateItems([updated]);
                                }
                              }}
                            />
                            <span className="small" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span>{g.name}</span>
                              {active.groupAddStates?.[g.id]?.status === "retry" ? <span className="badge warn">Pending Retry</span> : null}
                            </span>
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
                  {active.lastError ? (() => {
                    const msg = friendlyIdInMessage(active.lastError) || "";
                    const parts = msg.split("|").map((s) => s.trim()).filter(Boolean);
                    // If status is "done" (not "done_warn" or "failed"), these are informational messages, not errors
                    const isInfo = active.status === "done";
                    const color = isInfo ? "var(--good)" : "var(--bad)";
                    const label = isInfo ? "Info" : "Error";
                    if (parts.length <= 1) {
                      return <div className="small" style={{ color, marginTop: 10 }}><strong>{label}:</strong> {msg}</div>;
                    }
                    return (
                      <div style={{ marginTop: 10 }}>
                        <div className="small" style={{ color, fontWeight: "bold" }}>{label}:</div>
                        <ul className="small" style={{ color, marginTop: 4, marginBottom: 0, paddingLeft: 18 }}>
                          {parts.map((p, i) => <li key={i}>{p}</li>)}
                        </ul>
                      </div>
                    );
                  })() : null}
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
                onChange={(e) => {
                    const raw = String((e.target as any).value ?? "");
                    const parsed = raw.trim() === "" ? 1 : Number.parseInt(raw, 10);
                    const v = Math.max(1, Math.min(168, Math.round(Number.isFinite(parsed) ? parsed : 1)));
                    setIntervalHours(v);
                    persistScheduler({ intervalHours: v });
                  }}
                style={{ maxWidth: 160 }}
              />

              <div style={{ height: 10 }} />
              <label className="small">Upload batch size per run (1–999)</label>
              <input
                className="input"
                type="number"
                step={1}
                min={1}
                max={999}
                value={uploadBatchSize}
                onChange={(e) => {
                    const raw = String((e.target as any).value ?? "");
                    const parsed = raw.trim() === "" ? 1 : Number.parseInt(raw, 10);
                    const v = Math.max(1, Math.min(999, Math.round(Number.isFinite(parsed) ? parsed : 1)));
                    setUploadBatchSize(v);
                    // Persist immediately so the polling refresh does not overwrite the UI value.
                    persistScheduler({ uploadBatchSize: v });
                  }}
                style={{ maxWidth: 160 }}
              />

              <div style={{ height: 10 }} />
              <label className="listrow" style={{ padding: 0 }}>
                <input type="checkbox" checked={timeWindowEnabled} onChange={(e) => {
                  const checked = e.target.checked;
                  setTimeWindowEnabled(checked);
                  if (checked) setDaysEnabled(false);
                  persistScheduler({ timeWindowEnabled: checked, daysEnabled: checked ? false : daysEnabled });
                }} />
                <span className="small">Only upload during these times</span>
              </label>
              <div style={{ height: 8 }} />
              <div className="row">
                <div style={{ minWidth: 180 }}>
                  <div className="small">Start</div>
                  <input className="input" type="time" value={windowStart} disabled={!timeWindowEnabled} onChange={(e) => {
                      const v = e.target.value;
                      setWindowStart(v);
                      persistScheduler({ windowStart: v });
                    }} style={{ opacity: timeWindowEnabled ? 1 : 0.5 }} />
                </div>
                <div style={{ minWidth: 180 }}>
                  <div className="small">End</div>
                  <input className="input" type="time" value={windowEnd} disabled={!timeWindowEnabled} onChange={(e) => {
                      const v = e.target.value;
                      setWindowEnd(v);
                      persistScheduler({ windowEnd: v });
                    }} style={{ opacity: timeWindowEnabled ? 1 : 0.5 }} />
                </div>
              </div>
              <div className="small" style={{ marginTop: 6 }}>
                If End is earlier than Start (e.g., 15:00 → 05:00), ShutterQueue assumes you mean an overnight window.
              </div>

              <div className="hr" />

              <label className="listrow" style={{ padding: 0, opacity: timeWindowEnabled ? 0.5 : 1 }}>
                <input type="checkbox" checked={daysEnabled} disabled={timeWindowEnabled} onChange={(e) => {
                  const checked = e.target.checked;
                  setDaysEnabled(checked);
                  if (checked) setTimeWindowEnabled(false);
                  persistScheduler({ daysEnabled: checked, timeWindowEnabled: checked ? false : timeWindowEnabled });
                }} />
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
                        setAllowedDays(prev => {
                          const next = e.target.checked
                            ? Array.from(new Set([...prev, idx])).sort()
                            : prev.filter(x => x !== idx);
                          persistScheduler({ allowedDays: next });
                          return next;
                        });
                      }}
                    />
                    <span className="small">{d}</span>
                  </label>
                ))}
              </div>

              <div className="hr" />

              <label className="listrow" style={{ padding: 0 }}>
                <input type="checkbox" checked={resumeOnLaunch} onChange={(e) => {
                  const checked = e.target.checked;
                  setResumeOnLaunch(checked);
                  persistScheduler({ resumeOnLaunch: checked });
                }} />
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
              <div className="small"> {friendlyIdInMessage(sched?.lastError) || "—"}</div>
            </div>
          </div>


          <div className="card" style={{ gridColumn: "1 / -1" }}>
            <h2>Groups With Pending Retries</h2>
            <div className="content">
              {!pendingRetryGroups.length ? (
                <div className="small">No groups currently have pending retries.</div>
              ) : (
                <div className="split">
                  <div>
                    {pendingRetryGroups.map((g) => (
                      <div
                        key={g.groupId}
                        className="listrow"
                        style={{
                          cursor: "pointer",
                          background: pendingGroupFocus === g.groupId ? "rgba(255,255,255,0.06)" : undefined,
                        }}
                        onClick={() => setPendingGroupFocus(g.groupId)}
                      >
                        <div style={{ flex: 1 }}>
                          <div>{g.groupName}</div>
                          <div className="small" style={{ fontFamily: "ui-monospace" }}>{g.groupId}</div>
                        </div>
                        <div
                          className="small"
                          style={{
                            padding: "2px 8px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.06)",
                            fontFamily: "ui-monospace",
                          }}
                          title="Items pending for this group"
                        >
                          {g.count}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div className="small" style={{ marginBottom: 8 }}>
                      Pending photos for: <span style={{ fontFamily: "ui-monospace" }}>{pendingGroupFocus}</span>
                    </div>
                    {!pendingRetryItemsForFocus.length ? (
                      <div className="small">No pending photos for this group.</div>
                    ) : (
                      pendingRetryItemsForFocus.map((it) => (
                        <div key={it.itemId} className="listrow">
                          <div style={{ flex: 1, display: "flex", gap: 10, alignItems: "center" }}>
                            {(() => {
                              const fullItem = queue.find(q => q.id === it.itemId);
                              const srcs = resolveThumbSrc(fullItem, thumbs, flickrUrls);
                              const fname = fileNameFromPath(it.photoPath);
                              return (
                                <>
                                  <img
                                    className={`thumb ${srcs.thumbSrc ? "" : "empty"}`}
                                    src={srcs.thumbSrc || ""}
                                    alt=""
                                    style={{ width: 34, height: 34, cursor: srcs.previewSrc ? "pointer" : "default" }}
                                    onClick={() => { if (srcs.previewSrc) setPreview({ src: srcs.previewSrc, title: it.title }); }}
                                  />
                                  <div>
                                    <div>{it.title} <span className="small">({fname})</span></div>
                                  </div>
                                </>
                              );
                            })()}
                          </div>
                          <div className="small" style={{ fontFamily: "ui-monospace" }}>{sched?.schedulerOn ? formatLocal(it.nextRetryAt) : "waiting for scheduler restart"}</div>
                          <button
                            className="btn danger"
                            style={{ padding: "6px 10px", borderRadius: 10 }}
                            title="Remove this photo from this group retry"
                            onClick={() => removePendingRetryForGroup(pendingGroupFocus, it.itemId)}
                          >
                            ×
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
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
          <span className="mono">v{appVersion || "0.7.9"}</span>
        </div>
      </div>

      {preview && (
              <div className="preview-overlay" onClick={() => setPreview(null)}>
                <div className="preview-top">
                  <button className="preview-close" onClick={(e) => { e.stopPropagation(); setPreview(null); }}>×</button>
                </div>
                <div className="preview-body" onClick={(e) => e.stopPropagation()}>
                  {/* ensure the image fits the viewport by its longest edge and keeps aspect ratio */}
                  <img
                    src={preview.src}
                    alt=""
                    style={{
                      maxWidth: "100vw",
                      maxHeight: "100vh",
                      objectFit: "contain",
                    }}
                  />
                </div>
              </div>
      )}

    </div>
  );
}