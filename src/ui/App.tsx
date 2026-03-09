import React, { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import type { Album, GeoPrivacy, Group, Privacy, QueueItem } from "../types";

type Tab = "setup" | "queue" | "schedule" | "logs";
type SavedIdSet = { name: string; ids: string[] };
type DuplicateMember = { id: string; photoPath: string; title?: string };
type DuplicateGroup = { hash: string; members: DuplicateMember[]; removeCandidateIds: string[] };

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

const GEO_PRIVACY_LABEL: Record<GeoPrivacy, string> = {
  public: "Public",
  contacts: "Contacts",
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
function toDateTimeLocalValue(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

function normalizeSavedIdSets(input: any): SavedIdSet[] {
  if (!Array.isArray(input)) return [];
  const out: SavedIdSet[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const ids = Array.isArray(raw?.ids) ? uniq(raw.ids.map((x: any) => String(x)).filter(Boolean)) : [];
    out.push({ name, ids });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
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
      className={`tricheck ${props.state === "some" ? "mixed" : ""}`}
      onChange={(e) => props.onToggle(e.target.checked ? "all" : "none")}
      onClick={(e) => e.stopPropagation()}
      title={props.state === "all" ? "Uncheck all" : "Check all"}
    />
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("queue");
  const [displayTab, setDisplayTab] = useState<Tab>("queue");
  const [isTabLoading, setIsTabLoading] = useState(false);

  // Helper to switch tabs with immediate visual feedback
  const switchTab = (newTab: Tab) => {
    if (newTab === tab) return;
    setTab(newTab); // Immediately update tab selection for visual feedback
    
    // For heavy tabs, show loading state before rendering content
    if (newTab === "queue" || newTab === "logs") {
      if (displayTab !== newTab) {
        setIsTabLoading(true);
        // Brief delay to ensure loading message renders before heavy content
        setTimeout(() => {
          setDisplayTab(newTab);
          setTimeout(() => setIsTabLoading(false), 100);
        }, 50);
      }
    } else {
      // Light tabs render immediately
      setDisplayTab(newTab);
      setIsTabLoading(false);
    }
  };
  const [cfg, setCfg] = useState<any>(null);

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [verifier, setVerifier] = useState("");
  const [showSetupAdvanced, setShowSetupAdvanced] = useState(false);

  const [groups, setGroups] = useState<Group[]>([]);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [groupsFilter, setGroupsFilter] = useState("");
  const [albumsFilter, setAlbumsFilter] = useState("");
  const [savedGroupSets, setSavedGroupSets] = useState<SavedIdSet[]>([]);
  const [savedAlbumSets, setSavedAlbumSets] = useState<SavedIdSet[]>([]);
  const [savedTagSets, setSavedTagSets] = useState<SavedIdSet[]>([]);
  const [activeGroupSetName, setActiveGroupSetName] = useState("");
  const [activeAlbumSetName, setActiveAlbumSetName] = useState("");
  const [activeTagSetName, setActiveTagSetName] = useState("");
  const [groupSetMenuOpen, setGroupSetMenuOpen] = useState(false);
  const [albumSetMenuOpen, setAlbumSetMenuOpen] = useState(false);
  const [tagSetMenuOpen, setTagSetMenuOpen] = useState(false);
  const [saveSetDialog, setSaveSetDialog] = useState<{ kind: "group" | "album" | "tag"; ids: string[] } | null>(null);
  const [saveSetNameInput, setSaveSetNameInput] = useState("");
  
  // Location search state
  const [locationSearchQuery, setLocationSearchQuery] = useState("");
  const [locationSearchResults, setLocationSearchResults] = useState<Array<{
    displayName: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    type: string;
  }>>([]);
  const [locationSearching, setLocationSearching] = useState(false);
  
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

const activeGroupSetIdSet = useMemo(() => {
  const set = savedGroupSets.find(s => s.name === activeGroupSetName);
  return set ? new Set(set.ids.map(String)) : null;
}, [savedGroupSets, activeGroupSetName]);

const activeAlbumSetIdSet = useMemo(() => {
  const set = savedAlbumSets.find(s => s.name === activeAlbumSetName);
  return set ? new Set(set.ids.map(String)) : null;
}, [savedAlbumSets, activeAlbumSetName]);

const filteredGroups = useMemo(() => {
  const q = groupsFilter.trim().toLowerCase();
  return groups.filter(g => {
    const inText = !q || String(g.name || "").toLowerCase().includes(q);
    const inSet = !activeGroupSetIdSet || activeGroupSetIdSet.has(String(g.id));
    return inText && inSet;
  });
}, [groups, groupsFilter, activeGroupSetIdSet]);

const filteredAlbums = useMemo(() => {
  const q = albumsFilter.trim().toLowerCase();
  return albums.filter(a => {
    const inText = !q || String(a.title || "").toLowerCase().includes(q);
    const inSet = !activeAlbumSetIdSet || activeAlbumSetIdSet.has(String(a.id));
    return inText && inSet;
  });
}, [albums, albumsFilter, activeAlbumSetIdSet]);

const isGroupFilterActive = Boolean(groupsFilter.trim() || activeGroupSetName);
const isAlbumFilterActive = Boolean(albumsFilter.trim() || activeAlbumSetName);

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

// Categorize a message as "success", "waiting", or "error"
const categorizeMessage = (msg: string): "success" | "waiting" | "error" => {
  const lower = msg.toLowerCase();
  // Success: moderation queue, already in pool, adding to group (accepted)
  if (/photo added to.*moderation queue|already in pool|^adding to group/i.test(msg)) {
    return "success";
  }
  // Waiting: user limit reached (will retry)
  if (/user limit reached|will attempt again/i.test(msg)) {
    return "waiting";
  }
  // Error: actual failures
  return "error";
};


  const [didAutoLoadLists, setDidAutoLoadLists] = useState(false);

  const [appVersion, setAppVersion] = useState<string>("");
  const [isUploadingNow, setIsUploadingNow] = useState(false);

    const [showSetup, setShowSetup] = useState(true);
const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleAtLocal, setScheduleAtLocal] = useState("");
  const [schedulingItemIds, setSchedulingItemIds] = useState<string[]>([]);
  const [pastTimeDialogOpen, setPastTimeDialogOpen] = useState(false);
  const [pastTimeValue, setPastTimeValue] = useState("");
  const [schedulerWarningDialogOpen, setSchedulerWarningDialogOpen] = useState(false);
  const [pendingPhotoPaths, setPendingPhotoPaths] = useState<string[]>([]);
  const [duplicateDialogGroups, setDuplicateDialogGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const dismissedDuplicateKeysRef = useRef<Set<string>>(new Set());

  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  // Remote (Flickr) URLs used when the local file is missing.
  const [flickrUrls, setFlickrUrls] = useState<Record<string, { thumbUrl: string; previewUrl: string }>>({});

  // Full-window image preview overlay.
  const [preview, setPreview] = useState<{ src: string; title?: string } | null>(null);

  // Context menu for queue items
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null);

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
    const out: Array<{ itemId: string; title: string; photoPath: string; photoId: string; nextRetryAt?: string | null; retryPriority?: number }> = [];
    for (const item of queue) {
      const st = item.groupAddStates?.[pendingGroupFocus];
      if (st?.status === "retry") {
        out.push({
          itemId: item.id,
          title: item.title || "(untitled)",
          photoPath: item.photoPath,
          photoId: item.photoId || "",
          nextRetryAt: st.nextRetryAt || null,
          retryPriority: typeof st.retryPriority === "number" ? st.retryPriority : undefined,
        });
      }
    }
    out.sort((a, b) => {
      const ap = typeof a.retryPriority === "number" ? a.retryPriority : Number.MAX_SAFE_INTEGER;
      const bp = typeof b.retryPriority === "number" ? b.retryPriority : Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return String(a.nextRetryAt || "").localeCompare(String(b.nextRetryAt || ""));
    });
    return out;
  }, [queue, pendingGroupFocus]);

  const pendingRetryTopItemIdForFocus = useMemo(() => pendingRetryItemsForFocus[0]?.itemId || "", [pendingRetryItemsForFocus]);

  const pendingRetryNextAtForFocus = useMemo(() => {
    if (!pendingGroupFocus) return null as string | null;
    let minTs = Number.POSITIVE_INFINITY;
    let minIso: string | null = null;
    for (const item of queue) {
      const st = item.groupAddStates?.[pendingGroupFocus];
      if (st?.status !== "retry" || !st.nextRetryAt) continue;
      const ts = new Date(st.nextRetryAt).getTime();
      if (Number.isFinite(ts) && ts < minTs) {
        minTs = ts;
        minIso = st.nextRetryAt;
      }
    }
    return minIso;
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

  const hasActualErrorText = (s?: string | null) => {
    if (!s) return false;
    const parts = String(s).split("|").map(p => p.trim()).filter(Boolean);
    if (!parts.length) return false;
    return parts.some(p => /\b(fail|failed|error|gave up|gave_up|will be retried|retry|limit reached|user limit)\b/i.test(p));
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
  const isUploaded = useMemo(() => active?.photoId && (active.status === "done" || active.status === "done_warn"), [active]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // Smart-sorted groups/albums for edit lists (only resorts when selectedIds changes)
  // Smart-sorted groups/albums for edit lists (only resorts when selectedIds changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sortedFilteredGroups = useMemo(() => {
    if (!selectedIds.length) return filteredGroups;
    
    const withState = filteredGroups.map(g => {
      let on = 0;
      for (const sid of selectedIds) {
        const it = queue.find(x => x.id === sid);
        if (it?.groupIds?.includes(g.id)) on += 1;
      }
      const state = on === 0 ? "none" : on === selectedIds.length ? "all" : "some";
      return { ...g, state };
    });
    
    withState.sort((a, b) => {
      const order = { all: 0, some: 1, none: 2 };
      const stateCompare = order[a.state] - order[b.state];
      if (stateCompare !== 0) return stateCompare;
      return (a.name || "").localeCompare(b.name || "");
    });
    
    return withState;
  }, [filteredGroups, selectedIds]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sortedFilteredAlbums = useMemo(() => {
    if (!selectedIds.length) return filteredAlbums;
    
    const withState = filteredAlbums.map(a => {
      let on = 0;
      for (const sid of selectedIds) {
        const it = queue.find(x => x.id === sid);
        if (it?.albumIds?.includes(a.id)) on += 1;
      }
      const state = on === 0 ? "none" : on === selectedIds.length ? "all" : "some";
      return { ...a, state };
    });
    
    withState.sort((a, b) => {
      const order = { all: 0, some: 1, none: 2 };
      const stateCompare = order[a.state] - order[b.state];
      if (stateCompare !== 0) return stateCompare;
      return (a.title || "").localeCompare(b.title || "");
    });
    
    return withState;
  }, [filteredAlbums, selectedIds]);

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

  const batchLocationState = useMemo(() => {
    if (selectedItems.length < 2) return { mode: "none" as const, displayName: "", geoPrivacy: "private" as GeoPrivacy };

    const withGeo = selectedItems.filter(
      (it) => typeof it.latitude === "number" && typeof it.longitude === "number"
    );

    if (withGeo.length === 0) return { mode: "none" as const, displayName: "", geoPrivacy: "private" as GeoPrivacy };
    if (withGeo.length !== selectedItems.length) return { mode: "mixed" as const, displayName: "", geoPrivacy: "private" as GeoPrivacy };

    const keyOf = (it: QueueItem) => [
      String(it.latitude),
      String(it.longitude),
      String(it.accuracy || ""),
      String(it.locationDisplayName || ""),
    ].join("|");

    const first = withGeo[0];
    const firstKey = keyOf(first);
    const allSame = withGeo.every((it) => keyOf(it) === firstKey);
    const firstGeoPrivacy = (first.geoPrivacy || "private") as GeoPrivacy;
    const allSameGeoPrivacy = withGeo.every((it) => (it.geoPrivacy || "private") === firstGeoPrivacy);

    if (!allSame) {
      return {
        mode: "mixed" as const,
        displayName: "",
        geoPrivacy: allSameGeoPrivacy ? firstGeoPrivacy : ("private" as GeoPrivacy),
      };
    }

    return {
      mode: "same" as const,
      displayName: String(first.locationDisplayName || "Location selected"),
      geoPrivacy: allSameGeoPrivacy ? firstGeoPrivacy : ("private" as GeoPrivacy),
    };
  }, [selectedItems]);



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
  const [verboseLogging, setVerboseLogging] = useState(false);
  const [minimizeToTray, setMinimizeToTray] = useState(false);

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
    setVerboseLogging(Boolean(c.verboseLogging));
    setMinimizeToTray(Boolean(c.minimizeToTray));
    const nextSavedGroupSets = normalizeSavedIdSets((c as any).savedGroupSets);
    const nextSavedAlbumSets = normalizeSavedIdSets((c as any).savedAlbumSets);
    const nextSavedTagSets = normalizeSavedIdSets((c as any).savedTagSets);
    setSavedGroupSets(nextSavedGroupSets);
    setSavedAlbumSets(nextSavedAlbumSets);
    setSavedTagSets(nextSavedTagSets);
    if (activeGroupSetName && !nextSavedGroupSets.some(s => s.name === activeGroupSetName)) setActiveGroupSetName("");
    if (activeAlbumSetName && !nextSavedAlbumSets.some(s => s.name === activeAlbumSetName)) setActiveAlbumSetName("");
    if (activeTagSetName && !nextSavedTagSets.some(s => s.name === activeTagSetName)) setActiveTagSetName("");

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

  // Close dropdown menus when clicking outside them
  useEffect(() => {
    if (!groupSetMenuOpen && !albumSetMenuOpen && !tagSetMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Check if click was on a dropdown button or inside a dropdown menu
      const isGroupDropdown = target.closest('[data-dropdown="group"]');
      const isAlbumDropdown = target.closest('[data-dropdown="album"]');
      const isTagDropdown = target.closest('[data-dropdown="tag"]');
      if (!isGroupDropdown) setGroupSetMenuOpen(false);
      if (!isAlbumDropdown) setAlbumSetMenuOpen(false);
      if (!isTagDropdown) setTagSetMenuOpen(false);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [groupSetMenuOpen, albumSetMenuOpen, tagSetMenuOpen]);

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

  const duplicateGroupKey = (group: DuplicateGroup) => {
    const ids = (group.members || []).map((m) => String(m.id)).filter(Boolean).sort();
    return `${String(group.hash || "")}|${ids.join("|")}`;
  };

  const evaluateDuplicatesAndPrompt = async () => {
    const groups = await window.sq.queueFindDuplicates();
    const normalized = (Array.isArray(groups) ? groups : [])
      .map((g: any) => ({
        hash: String(g?.hash || ""),
        members: Array.isArray(g?.members) ? g.members.map((m: any) => ({
          id: String(m?.id || ""),
          photoPath: String(m?.photoPath || ""),
          title: String(m?.title || ""),
        })) : [],
        removeCandidateIds: Array.isArray(g?.removeCandidateIds) ? g.removeCandidateIds.map((id: any) => String(id)).filter(Boolean) : [],
      }))
      .filter((g: DuplicateGroup) => g.members.length > 1);

    const unsuppressed = normalized.filter((g) => !dismissedDuplicateKeysRef.current.has(duplicateGroupKey(g)));
    if (!unsuppressed.length) return;
    setDuplicateDialogGroups(unsuppressed);
    setDuplicateDialogOpen(true);
  };

  const addPhotosFromPaths = async (paths: string[]) => {
    if (!paths.length) return;

    // Check if queue was empty and scheduler is on - if so, show warning
    const wasQueueEmpty = queue.length === 0;
    if (wasQueueEmpty && sched?.schedulerOn) {
      // Store the paths and show the warning dialog
      setPendingPhotoPaths(paths);
      setSchedulerWarningDialogOpen(true);
      return;
    }

    // Queue wasn't empty or scheduler is off, so proceed normally
    await performAddPhotos(paths);
  };

  const performAddPhotos = async (paths: string[]) => {
    let currentQueue = await window.sq.queueAdd(paths);
    setQueue(currentQueue);
    if (!activeId && currentQueue.length) setActiveId(currentQueue[0].id);

    // Set default titles for newly added photos that don't have a title yet
    const newlyAdded = currentQueue.filter(it => paths.includes(it.photoPath) && !String(it.title || "").trim());
    if (newlyAdded.length) {
      const patched = newlyAdded.map(it => ({ ...it, title: deriveTitleFromPhotoPath(it.photoPath) }));
      currentQueue = await window.sq.queueUpdate(patched);
      setQueue(currentQueue);
      if (!activeId && currentQueue.length) setActiveId(currentQueue[0].id);
    }

    // Set default safety level (Safe) for newly added photos missing safetyLevel
    const newlyAddedNeedsSafety = currentQueue.filter(it => paths.includes(it.photoPath) && (it as any).safetyLevel == null);
    if (newlyAddedNeedsSafety.length) {
      const patched = newlyAddedNeedsSafety.map(it => ({ ...it, safetyLevel: 1 as any }));
      currentQueue = await window.sq.queueUpdate(patched);
      setQueue(currentQueue);
      if (!activeId && currentQueue.length) setActiveId(currentQueue[0].id);
    }

    await evaluateDuplicatesAndPrompt();
    showToast(`Added ${paths.length} photo(s).`);
  };

  const keepDuplicates = () => {
    for (const g of duplicateDialogGroups) {
      dismissedDuplicateKeysRef.current.add(duplicateGroupKey(g));
    }
    setDuplicateDialogOpen(false);
    setDuplicateDialogGroups([]);
  };

  const removeDuplicates = async () => {
    const ids = uniq(duplicateDialogGroups.flatMap((g) => g.removeCandidateIds).filter(Boolean));
    if (!ids.length) {
      setDuplicateDialogOpen(false);
      setDuplicateDialogGroups([]);
      return;
    }
    const q = await window.sq.queueRemove(ids);
    setQueue(q);
    if (activeId && !q.some((it) => it.id === activeId)) {
      setActiveId(q[0]?.id || null);
    }
    setDuplicateDialogOpen(false);
    setDuplicateDialogGroups([]);
    showToast(`Removed ${ids.length} duplicate photo(s).`);
  };

  const addPhotos = async () => {
    const paths = await window.sq.pickPhotos();
    if (!paths.length) return;
    await addPhotosFromPaths(paths);
  };

  const selectAll = () => setSelectedIds(queue.map(q => q.id));
  const clearSelection = () => setSelectedIds([]);
  const manuallyScheduledCount = useMemo(
    () => queue.filter(it => it.status === "pending" && !!it.scheduledUploadAt).length,
    [queue]
  );

  const hasPendingSelected = useMemo(
    () => selectedIds.some(id => {
      const it = queue.find(q => q.id === id);
      return it && it.status === "pending";
    }),
    [selectedIds, queue]
  );

  const openScheduleSelectedDialog = () => {
    if (!selectedIds.length) {
      showToast("Error: No items selected to schedule.");
      return;
    }
    setSchedulingItemIds(selectedIds);
    const firstSelected = queue.find(it => selectedIds.includes(it.id) && it.status === "pending");
    const defaultIso = firstSelected?.scheduledUploadAt || new Date(Date.now() + 10 * 60 * 1000).toISOString();
    setScheduleAtLocal(toDateTimeLocalValue(defaultIso));
    setScheduleDialogOpen(true);
  };

  const openScheduleDialogForItem = (itemId: string) => {
    const item = queue.find(it => it.id === itemId);
    if (!item || item.status !== "pending") return;
    setSchedulingItemIds([itemId]);
    const defaultIso = item.scheduledUploadAt || new Date(Date.now() + 10 * 60 * 1000).toISOString();
    setScheduleAtLocal(toDateTimeLocalValue(defaultIso));
    setScheduleDialogOpen(true);
  };

  const reorderPendingForManualSchedule = (sourceQueue: QueueItem[]): QueueItem[] => {
    // Separate items: non-pending stay at original positions, 
    // manually scheduled items go before unscheduled pending items (sorted by time)
    const nonPending: QueueItem[] = [];
    const scheduled: QueueItem[] = [];
    const unscheduled: QueueItem[] = [];

    for (const it of sourceQueue) {
      if (it.status !== "pending") {
        nonPending.push(it);
      } else if (it.scheduledUploadAt) {
        scheduled.push(it);
      } else {
        unscheduled.push(it);
      }
    }

    // Sort scheduled by time
    scheduled.sort((a, b) => Date.parse(a.scheduledUploadAt || "") - Date.parse(b.scheduledUploadAt || ""));

    // Rebuild: non-pending first, then scheduled (sorted), then unscheduled
    const result: QueueItem[] = [];
    result.push(...nonPending);
    result.push(...scheduled);
    result.push(...unscheduled);

    return result;
  };

  const scheduleSelectedAt = async () => {
    if (!schedulingItemIds.length) {
      setScheduleDialogOpen(false);
      showToast("Error: No items selected to schedule.");
      return;
    }
    if (!scheduleAtLocal) {
      showToast("Error: Please choose a valid schedule time.");
      return;
    }
    const when = new Date(scheduleAtLocal);
    if (!Number.isFinite(when.getTime())) {
      showToast("Error: Please choose a valid schedule time.");
      return;
    }

    // Check if time is in the past
    if (when.getTime() < Date.now()) {
      setPastTimeValue(scheduleAtLocal);
      setPastTimeDialogOpen(true);
      return;
    }

    const iso = when.toISOString();
    const changed = queue
      .filter(it => schedulingItemIds.includes(it.id) && it.status === "pending")
      .map(it => ({ ...it, scheduledUploadAt: iso }));

    if (!changed.length) {
      setScheduleDialogOpen(false);
      showToast("Error: Selected items are not pending.");
      return;
    }

    const changedById = new Map(changed.map(it => [it.id, it]));
    const updatedQueue = queue.map(it => changedById.get(it.id) || it);
    const reorderedQueue = reorderPendingForManualSchedule(updatedQueue);

    setQueue(reorderedQueue);
    await window.sq.queueUpdate(changed);
    await window.sq.queueReorder(reorderedQueue.map(it => it.id));
    
    setScheduleDialogOpen(false);
    showToast(`Scheduled ${changed.length} item(s) for ${formatLocal(iso)}.`);
  };

  const uploadScheduledItemsNow = async () => {
    setPastTimeDialogOpen(false);
    setScheduleDialogOpen(false);
    const pendingItems = queue.filter(it => schedulingItemIds.includes(it.id) && it.status === "pending");
    if (!pendingItems.length) return;
    for (const item of pendingItems) {
      try {
        await window.sq.uploadNowOne({ itemId: item.id });
      } catch (e) {
        console.error("Upload failed:", e);
      }
    }
    await refreshDynamic();
    showToast(`Uploaded ${pendingItems.length} item(s) now.`);
  };

  const clearManualScheduleForItem = async (itemId: string) => {
    const item = queue.find(it => it.id === itemId);
    if (!item) return;
    const updated = { ...item, scheduledUploadAt: "" };
    setQueue(prev => prev.map(it => it.id === itemId ? updated : it));
    await updateItems([updated]);
    setScheduleDialogOpen(false);
    showToast("Cleared manual schedule.");
  };

  const clearManualSchedule = async () => {
    const changed = queue
      .filter(it => it.status === "pending" && !!it.scheduledUploadAt)
      .map(it => ({ ...it, scheduledUploadAt: "" }));
    if (!changed.length) return;
    setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
    await updateItems(changed);
    showToast(`Cleared manual schedule on ${changed.length} item(s).`);
  };

  const handleContextMenu = useCallback((e: React.MouseEvent, itemId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    // If right-clicked item isn't selected, select it
    if (!selectedIds.includes(itemId)) {
      setSelectedIds([itemId]);
    }
    
    setContextMenu({ x: e.clientX, y: e.clientY, itemId });
  }, [selectedIds]);

  const removeContextMenuItems = async () => {
    const idsToRemove = selectedIds.length > 0 ? selectedIds : (contextMenu ? [contextMenu.itemId] : []);
    setContextMenu(null);
    if (!idsToRemove.length) return;
    
    const confirmed = window.confirm(
      idsToRemove.length === 1
        ? "Remove this item from the queue?"
        : `Remove ${idsToRemove.length} items from the queue?`
    );
    
    if (!confirmed) return;
    
    await removeSelected();
  };

  const uploadContextMenuItemsNow = async () => {
    const idsToUpload = selectedIds.length > 0 ? selectedIds : (contextMenu ? [contextMenu.itemId] : []);
    setContextMenu(null);
    if (!idsToUpload.length) return;
    
    const confirmed = window.confirm(
      idsToUpload.length === 1
        ? "Upload this item now?"
        : `Upload ${idsToUpload.length} items now?`
    );
    
    if (!confirmed) return;
    
    for (const id of idsToUpload) {
      try {
        await window.sq.uploadNowOne({ itemId: id });
      } catch (e) {
        console.error("Upload failed:", e);
      }
    }
    await refreshDynamic();
    showToast(`Uploaded ${idsToUpload.length} item(s).`);
  };

  const toggleScheduleContextMenu = () => {
    const idsToSchedule = selectedIds.length > 0 ? selectedIds : (contextMenu ? [contextMenu.itemId] : []);
    setContextMenu(null);
    if (!idsToSchedule.length) return;
    
    const items = queue.filter(it => idsToSchedule.includes(it.id));
    const hasScheduled = items.some(it => it.scheduledUploadAt);
    
    if (hasScheduled) {
      // Clear manual schedules
      const changed = items
        .filter(it => it.scheduledUploadAt)
        .map(it => ({ ...it, scheduledUploadAt: "" }));
      if (!changed.length) return;
      setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
      updateItems(changed);
      showToast(`Cleared manual schedule on ${changed.length} item(s).`);
    } else {
      // Open schedule dialog
      if (idsToSchedule.length === 1) {
        openScheduleDialogForItem(idsToSchedule[0]);
      } else {
        setSchedulingItemIds(idsToSchedule);
        const firstSelected = queue.find(it => idsToSchedule.includes(it.id) && it.status === "pending");
        const defaultIso = firstSelected?.scheduledUploadAt || new Date(Date.now() + 10 * 60 * 1000).toISOString();
        setScheduleAtLocal(toDateTimeLocalValue(defaultIso));
        setScheduleDialogOpen(true);
      }
    }
  };

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

  const searchLocation = async () => {
    const query = locationSearchQuery.trim();
    if (!query) {
      setLocationSearchResults([]);
      return;
    }
    
    setLocationSearching(true);
    try {
      const result = await window.sq.geoSearch(query);
      if (result.ok && result.results) {
        setLocationSearchResults(result.results);
      } else {
        alert(`Location search failed: ${result.error || "Unknown error"}`);
        setLocationSearchResults([]);
      }
    } catch (err: any) {
      alert(`Location search failed: ${err.message || String(err)}`);
      setLocationSearchResults([]);
    } finally {
      setLocationSearching(false);
    }
  };

  const selectLocation = (result: { displayName: string; latitude: number; longitude: number; accuracy: number }) => {
    if (!active) return;
    const updated: QueueItem = {
      ...active,
      latitude: result.latitude,
      longitude: result.longitude,
      accuracy: result.accuracy,
      locationDisplayName: result.displayName
    };
    setQueue(prev => prev.map(it => it.id === updated.id ? updated : it));
    updateItems([updated]);
    setLocationSearchResults([]);
    setLocationSearchQuery("");
  };

  const clearLocation = () => {
    if (!active) return;
    const updated: QueueItem = {
      ...active,
      latitude: undefined,
      longitude: undefined,
      accuracy: undefined,
      locationDisplayName: undefined,
      geoPrivacy: undefined
    };
    setQueue(prev => prev.map(it => it.id === updated.id ? updated : it));
    updateItems([updated]);
  };

  const searchBatchLocation = async () => {
    const query = batchLocationQuery.trim();
    if (!query) {
      setBatchLocationResults([]);
      return;
    }
    
    setBatchLocationSearching(true);
    try {
      const result = await window.sq.geoSearch(query);
      if (result.ok && result.results) {
        setBatchLocationResults(result.results);
      } else {
        alert(`Location search failed: ${result.error || "Unknown error"}`);
        setBatchLocationResults([]);
      }
    } catch (err: any) {
      alert(`Location search failed: ${err.message || String(err)}`);
      setBatchLocationResults([]);
    } finally {
      setBatchLocationSearching(false);
    }
  };

  const selectBatchLocation = (result: { displayName: string; latitude: number; longitude: number; accuracy: number }) => {
    if (!selectedIds.length) return;
    const byId = new Map(queue.map(it => [it.id, it]));
    const changed: QueueItem[] = [];
    for (const id of selectedIds) {
      const it = byId.get(id);
      if (!it) continue;
      const next: QueueItem = {
        ...it,
        latitude: result.latitude,
        longitude: result.longitude,
        accuracy: result.accuracy,
        locationDisplayName: result.displayName
      };
      changed.push(next);
    }
    if (!changed.length) return;
    setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
    updateItems(changed);
    setBatchLocationResults([]);
    setBatchLocationQuery("");
    showToast(`Set location on ${changed.length} item(s).`);
  };

  const clearBatchLocation = () => {
    if (!selectedIds.length) return;
    const byId = new Map(queue.map(it => [it.id, it]));
    const changed: QueueItem[] = [];
    for (const id of selectedIds) {
      const it = byId.get(id);
      if (!it) continue;
      const next: QueueItem = {
        ...it,
        latitude: undefined,
        longitude: undefined,
        accuracy: undefined,
        locationDisplayName: undefined,
        geoPrivacy: undefined
      };
      changed.push(next);
    }
    if (!changed.length) return;
    setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
    updateItems(changed);
    showToast(`Cleared location from ${changed.length} item(s).`);
  };

  const setBatchLocationPrivacy = async (geoPrivacy: GeoPrivacy) => {
    if (!selectedIds.length) return;
    const byId = new Map(queue.map(it => [it.id, it]));
    const changed: QueueItem[] = [];
    for (const id of selectedIds) {
      const it = byId.get(id);
      if (!it) continue;
      if (typeof it.latitude !== "number" || typeof it.longitude !== "number") continue;
      changed.push({ ...it, geoPrivacy });
    }
    if (!changed.length) return;
    setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
    await updateItems(changed);
    showToast(`Set location privacy on ${changed.length} item(s).`);
  };

  const updateActive = async (patch: Partial<QueueItem>) => {
    if (!active) return;
    const updated: QueueItem = { ...active, ...patch };
    setQueue(prev => prev.map(it => it.id === updated.id ? updated : it));
    await updateItems([updated]);
  };

  const handleRowClick = useCallback((id: string, e: React.MouseEvent) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const isShift = e.shiftKey;

    setActiveId(id);

    if (isShift && anchorId) {
      const a = queue.findIndex(x => x.id === anchorId);
      const b = queue.findIndex(x => x.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = queue.slice(lo, hi + 1).map(x => x.id);
        startTransition(() => {
          setSelectedIds(prev => uniq([...prev, ...range]));
        });
        return;
      }
    }

    if (isMeta) {
      startTransition(() => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : uniq([...prev, id]));
      });
      setAnchorId(id);
      return;
    }

    startTransition(() => {
      setSelectedIds([id]);
    });
    setAnchorId(id);
  }, [anchorId, queue]);

  const [dragOver, setDragOver] = useState<{ id: string; pos: "top" | "bottom" } | null>(null);
  const [pendingRetryDragOver, setPendingRetryDragOver] = useState<{ id: string; pos: "top" | "bottom" } | null>(null);

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

  const onDropPendingRetryReorder = async (fromId: string, toId: string, pos: "top" | "bottom") => {
    if (!pendingGroupFocus) return;

    const ids = pendingRetryItemsForFocus.map(x => x.itemId);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0 || from === to) return;

    const copy = [...ids];
    const [movedId] = copy.splice(from, 1);

    let insertAt = to;
    if (from < to) insertAt -= 1;
    if (pos === "bottom") insertAt += 1;
    insertAt = Math.max(0, Math.min(copy.length, insertAt));
    copy.splice(insertAt, 0, movedId);

    const rankById = new Map(copy.map((id, index) => [id, index + 1]));
    const changed: QueueItem[] = [];
    const baseNextRetryAt = pendingRetryNextAtForFocus || new Date(Date.now() + 1000).toISOString();

    const nextQueue = queue.map((item) => {
      const rank = rankById.get(item.id);
      if (!rank) return item;
      const st = item.groupAddStates?.[pendingGroupFocus];
      if (!st || st.status !== "retry") return item;
      if (st.retryPriority === rank && st.nextRetryAt === baseNextRetryAt) return item;

      const updated: QueueItem = {
        ...item,
        groupAddStates: {
          ...(item.groupAddStates || {}),
          [pendingGroupFocus]: {
            ...st,
            retryPriority: rank,
            nextRetryAt: baseNextRetryAt,
          },
        },
      };
      changed.push(updated);
      return updated;
    });

    setQueue(nextQueue);
    setPendingRetryDragOver(null);
    if (changed.length) {
      await updateItems(changed);
    }
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

  const [uploadByteProgress, setUploadByteProgress] = useState<number | null>(null);

  useEffect(() => {
    const cb = (e: any) => {
      const { loaded, total } = e.detail || {};
      if (typeof loaded === 'number' && typeof total === 'number' && total > 0) {
        setUploadByteProgress(Math.min(1, loaded / total));
        if (loaded >= total) {
          // clear after a short delay so bar reaches 100%
          setTimeout(() => setUploadByteProgress(null), 500);
        }
      }
    };
    window.addEventListener('sq-upload-progress', cb as any);
    return () => window.removeEventListener('sq-upload-progress', cb as any);
  }, []);

  // Listen for files opened via context menu / "open with" / drag-and-drop from external apps
  useEffect(() => {
    const handleAddPhotos = async (e: any) => {
      const paths = e.detail?.paths || [];
      if (Array.isArray(paths) && paths.length > 0) {
        // Switch to queue tab to show the added photos
        if (tab !== "queue") switchTab("queue");
        // Add the photos
        await addPhotosFromPaths(paths);
      }
    };
    window.addEventListener('sq-add-photos', handleAddPhotos as any);
    return () => window.removeEventListener('sq-add-photos', handleAddPhotos as any);
  }, [addPhotosFromPaths, tab]);

  const batchProgressInfo = useMemo(() => {
    const isBatchActive = Boolean((sched as any)?.batchRunActive);
    if (!isBatchActive) return null as { progress: number; completed: number; batchSize: number } | null;

    const startedAtRaw = (sched as any)?.batchRunStartedAt ? String((sched as any).batchRunStartedAt) : "";
    const startedAtMs = Date.parse(startedAtRaw);
    if (!Number.isFinite(startedAtMs)) return null as { progress: number; completed: number; batchSize: number } | null;

    const batchSize = Math.max(1, Math.min(999, Math.round(Number((sched as any)?.batchRunSize || uploadBatchSize || 1))));
    const completed = queue.filter(it => it.uploadedAt && Date.parse(it.uploadedAt) >= startedAtMs).length;
    const hasUploading = queue.some(it => it.status === "uploading");
    const currentPartial = hasUploading ? Math.max(0, Math.min(1, uploadByteProgress ?? 0)) : 0;
    const pct = (completed + currentPartial) / batchSize;
    return { progress: Math.max(0, Math.min(1, pct)), completed, batchSize };
  }, [sched, queue, uploadBatchSize, uploadByteProgress]);

  const uploadProgress = batchProgressInfo?.progress ?? uploadByteProgress;
  const batchProgressLabel = batchProgressInfo && batchProgressInfo.batchSize > 1
    ? `${Math.min(batchProgressInfo.completed, batchProgressInfo.batchSize)}/${batchProgressInfo.batchSize}`
    : null;

  // Clear the batch tag input whenever the selection changes in multi-select mode.
  useEffect(() => {
    if (selectedIds.length >= 2) setBatchTags("");
  }, [selectedIds.join("|")]);

  const [batchDescription, setBatchDescription] = useState("");
  const [batchPrivacy, setBatchPrivacy] = useState<Privacy | "">( "" );
  const [batchSafety, setBatchSafety] = useState<"" | 1 | 2 | 3>("");
  const [batchCreateAlbums, setBatchCreateAlbums] = useState("");
  
  // Batch location state
  const [batchLocationQuery, setBatchLocationQuery] = useState("");
  const [batchLocationResults, setBatchLocationResults] = useState<Array<{
    displayName: string;
    latitude: number;
    longitude: number;
    accuracy: number;
    type: string;
  }>>([]);
  const [batchLocationSearching, setBatchLocationSearching] = useState(false);

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

  const loadTagSet = async (setName: string) => {
    if (!setName) return;
    const set = savedTagSets.find(s => s.name === setName);
    if (!set) return;
    
    if (selectedIds.length > 1) {
      // Batch mode: add tags to all selected items
      const byId = new Map(queue.map(it => [it.id, it]));
      const changed: QueueItem[] = [];
      for (const id of selectedIds) {
        const it = byId.get(id);
        if (!it) continue;
        const existing = parseTagsCsv(it.tags);
        const merged = formatTagsCsv(uniq([...existing, ...set.ids]));
        const next: QueueItem = { ...it, tags: merged };
        changed.push(next);
      }
      if (changed.length) {
        setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
        await updateItems(changed);
        showToast(`Applied tag set "${setName}" to ${changed.length} item(s).`);
      }
    } else if (active) {
      // Single item mode: add tags to current item
      const existing = parseTagsCsv(active.tags);
      const merged = formatTagsCsv(uniq([...existing, ...set.ids]));
      updateActive({ tags: merged });
      showToast(`Applied tag set "${setName}".`);
    }
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

  const persistSavedSets = async (kind: "group" | "album" | "tag", sets: SavedIdSet[]) => {
    const normalized = normalizeSavedIdSets(sets);
    if (kind === "group") setSavedGroupSets(normalized);
    else if (kind === "album") setSavedAlbumSets(normalized);
    else setSavedTagSets(normalized);
    await window.sq.setSavedSets({ kind, sets: normalized });
  };

  const getCurrentSelectedIdsForSetSave = (kind: "group" | "album" | "tag") => {
    if (kind === "tag") {
      // For tags, return tag strings from common tags
      if (selectedIds.length > 1) return commonTags;
      if (!active) return [] as string[];
      return parseTagsCsv(active.tags);
    }
    if (selectedIds.length > 1) {
      const source = kind === "group" ? groups : albums;
      return source
        .map(x => String(x.id))
        .filter(id => triState(kind, id) === "all");
    }
    if (!active) return [] as string[];
    return (kind === "group" ? (active.groupIds || []) : (active.albumIds || [])).map(String);
  };

  const saveCurrentSelectionAsSet = async (kind: "group" | "album" | "tag") => {
    const ids = uniq(getCurrentSelectedIdsForSetSave(kind));
    if (!ids.length) {
      const label = kind === "group" ? "groups" : kind === "album" ? "albums" : "tags";
      showToast(`No ${label} selected to save.`);
      return;
    }
    const defaultName = `${kind === "group" ? "Group" : kind === "album" ? "Album" : "Tag"} set ${new Date().toISOString().slice(0, 10)}`;
    setSaveSetNameInput(defaultName);
    setSaveSetDialog({ kind, ids });
  };

  const saveSetDialogSubmit = async () => {
    if (!saveSetDialog) return;
    const { kind, ids } = saveSetDialog;
    const name = saveSetNameInput.trim();
    if (!name) return;
    const existing = kind === "group" ? savedGroupSets : kind === "album" ? savedAlbumSets : savedTagSets;
    const next = [
      ...existing.filter(s => s.name.toLowerCase() !== name.toLowerCase()),
      { name, ids },
    ];
    await persistSavedSets(kind, next);
    if (kind === "group") setActiveGroupSetName(name);
    else if (kind === "album") setActiveAlbumSetName(name);
    else setActiveTagSetName(name);
    setSaveSetDialog(null);
    setSaveSetNameInput("");
    showToast(`Saved ${kind} set "${name}" (${ids.length} item(s)).`);
  };

  const deleteSavedSet = async (kind: "group" | "album" | "tag", name: string) => {
    const label = kind === "group" ? "groups" : kind === "album" ? "albums" : "tags";
    const ok = window.confirm(
      `Delete saved ${kind} set "${name}"?\n\nThis only deletes the saved set definition. Photos will remain assigned to their current ${label}.`
    );
    if (!ok) return;
    const existing = kind === "group" ? savedGroupSets : kind === "album" ? savedAlbumSets : savedTagSets;
    const next = existing.filter(s => s.name !== name);
    await persistSavedSets(kind, next);
    if (kind === "group" && activeGroupSetName === name) setActiveGroupSetName("");
    if (kind === "album" && activeAlbumSetName === name) setActiveAlbumSetName("");
    if (kind === "tag" && activeTagSetName === name) setActiveTagSetName("");
    showToast(`Deleted ${kind} set "${name}".`);
  };

  const renderSavedSetFilterControl = (kind: "group" | "album" | "tag", opts?: { disabled?: boolean }) => {
    const disabled = Boolean(opts?.disabled);
    const savedSets = kind === "group" ? savedGroupSets : kind === "album" ? savedAlbumSets : savedTagSets;
    const activeName = kind === "group" ? activeGroupSetName : kind === "album" ? activeAlbumSetName : activeTagSetName;
    const setActiveName = kind === "group" ? setActiveGroupSetName : kind === "album" ? setActiveAlbumSetName : setActiveTagSetName;
    const menuOpen = kind === "group" ? groupSetMenuOpen : kind === "album" ? albumSetMenuOpen : tagSetMenuOpen;
    const setMenuOpen = kind === "group" ? setGroupSetMenuOpen : kind === "album" ? setAlbumSetMenuOpen : setTagSetMenuOpen;

    return (
      <div style={{ position: "relative" }} data-dropdown={kind}>
        <button
          className="btn"
          disabled={disabled}
          style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center" }}
          onClick={(e) => {
            if (disabled) return;
            if (kind === "group") {
              setAlbumSetMenuOpen(false);
              setTagSetMenuOpen(false);
            } else if (kind === "album") {
              setGroupSetMenuOpen(false);
              setTagSetMenuOpen(false);
            } else {
              setGroupSetMenuOpen(false);
              setAlbumSetMenuOpen(false);
            }
            setMenuOpen(!menuOpen);
            e.stopPropagation();
          }}
        >
          <span>{activeName || "(none)"}</span>
          <span>▾</span>
        </button>
          {menuOpen && (
            <>
              <div
                style={{ position: "fixed", inset: 0, zIndex: 29, pointerEvents: "none" }}
              />
              <div className="listbox" style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4, maxHeight: 200, zIndex: 30 }} onClick={(e) => e.stopPropagation()}>
                <div className="listrow" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button className="btn" style={{ padding: "2px 8px" }} onClick={() => { setActiveName(""); setMenuOpen(false); }}>(none)</button>
                  <span className="small"> </span>
                </div>
                {savedSets.map(s => (
                  <div key={s.name} className="listrow" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <button
                      className="btn"
                      style={{ padding: "2px 8px", flex: 1, textAlign: "left" }}
                      onClick={() => {
                        setActiveName(s.name);
                        setMenuOpen(false);
                        if (kind === "tag") void loadTagSet(s.name);
                      }}
                    >
                      {s.name}
                    </button>
                    <button
                      className="btn danger"
                      style={{ padding: "2px 8px" }}
                      title={`Delete saved ${kind} set`}
                      onClick={() => { void deleteSavedSet(kind, s.name); }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {!savedSets.length && <div className="small">No saved sets yet.</div>}
              </div>
            </>
          )}
      </div>
    );
  };

  const clearFilteredSelections = async (kind: "group" | "album") => {
    const idsToRemove = new Set((kind === "group" ? sortedFilteredGroups : sortedFilteredAlbums).map(x => String(x.id)));
    if (!idsToRemove.size) {
      showToast(`No filtered ${kind === "group" ? "groups" : "albums"} to clear.`);
      return;
    }

    if (selectedIds.length > 1) {
      const selectedIdSet = new Set(selectedIds);
      const changed: QueueItem[] = [];
      for (const it of queue) {
        if (!selectedIdSet.has(it.id)) continue;
        if (kind === "group") {
          let updated: QueueItem = { ...it, groupIds: (it.groupIds || []).filter(id => !idsToRemove.has(String(id))) };
          for (const gid of idsToRemove) updated = removeGroupRetryAndSelection(updated, gid);
          changed.push(updated);
        } else {
          changed.push({ ...it, albumIds: (it.albumIds || []).filter(id => !idsToRemove.has(String(id))) });
        }
      }
      if (!changed.length) return;
      setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
      await updateItems(changed);
      showToast(`Cleared filtered ${kind === "group" ? "groups" : "albums"} for ${changed.length} item(s).`);
      return;
    }

    if (!active) return;
    if (kind === "group") {
      let updated: QueueItem = { ...active, groupIds: (active.groupIds || []).filter(id => !idsToRemove.has(String(id))) };
      for (const gid of idsToRemove) updated = removeGroupRetryAndSelection(updated, gid);
      setQueue(prev => prev.map(it => (it.id === updated.id ? updated : it)));
      await updateItems([updated]);
    } else {
      const updated: QueueItem = { ...active, albumIds: (active.albumIds || []).filter(id => !idsToRemove.has(String(id))) };
      setQueue(prev => prev.map(it => (it.id === updated.id ? updated : it)));
      await updateItems([updated]);
    }
    showToast(`Cleared filtered ${kind === "group" ? "groups" : "albums"}.`);
  };

  const selectAllFilteredForCurrentSelection = async (kind: "group" | "album") => {
    const idsToAdd = (kind === "group" ? sortedFilteredGroups : sortedFilteredAlbums).map(x => String(x.id));
    if (!idsToAdd.length) {
      showToast(`No filtered ${kind === "group" ? "groups" : "albums"} to select.`);
      return;
    }

    if (selectedIds.length > 1) {
      const selectedIdSet = new Set(selectedIds);
      const changed: QueueItem[] = [];
      for (const it of queue) {
        if (!selectedIdSet.has(it.id)) continue;
        if (kind === "group") changed.push({ ...it, groupIds: uniq([...(it.groupIds || []), ...idsToAdd]) });
        else changed.push({ ...it, albumIds: uniq([...(it.albumIds || []), ...idsToAdd]) });
      }
      if (!changed.length) return;
      setQueue(prev => prev.map(it => changed.find(x => x.id === it.id) || it));
      await updateItems(changed);
      showToast(`Selected all filtered ${kind === "group" ? "groups" : "albums"} for ${changed.length} item(s).`);
      return;
    }

    if (!active) return;
    if (kind === "group") await updateActive({ groupIds: uniq([...(active.groupIds || []), ...idsToAdd]) });
    else await updateActive({ albumIds: uniq([...(active.albumIds || []), ...idsToAdd]) });
    showToast(`Selected all filtered ${kind === "group" ? "groups" : "albums"}.`);
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

    const pending = queue.filter(it => it.status === "pending" && !it.scheduledUploadAt);
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
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="h1">ShutterQueue</div>
          <div className="sub">A paced uploader for Flickr. Build a queue, reorder on the fly, and upload every 1–168 hours.</div>
        </div>
      </div>

      {/* sticky header with tabs and badges */}
      <div className="sticky-header">
        <div className="tabs">
          <div className={`tab ${tab==="queue"?"selected":""}`} onClick={() => switchTab("queue")} role="tab" tabIndex={0}>Queue</div>
          <div className={`tab ${tab==="schedule"?"selected":""}`} onClick={() => switchTab("schedule")} role="tab" tabIndex={0}>Schedule</div>
          <div className={`tab ${tab==="logs"?"selected":""}`} onClick={() => switchTab("logs")} role="tab" tabIndex={0}>Logs</div>
          <div className={`tab ${tab==="setup"?"selected":""}`} onClick={() => switchTab("setup")} role="tab" tabIndex={0}>Setup</div>
        </div>
        <div className="btncluster" style={{ alignItems: "center", marginLeft: "auto" }}>
          {cfg?.authed ? <span className="badge good" onClick={() => switchTab("setup")} style={{ cursor: "pointer" }} title="Click to jump to Setup">Authorized</span> : <span className="badge warn" onClick={() => switchTab("setup")} style={{ cursor: "pointer" }} title="Click to jump to Setup">Not authorized</span>}
          <span className="badge" onClick={() => switchTab("queue")} style={{ cursor: "pointer" }} title="Click to jump to Queue">{queue.length} in queue</span>
          {sched?.schedulerOn ? (
            <span className="badge good" onClick={async () => { await stopSched(); }} style={{ cursor: "pointer" }} title="Click to stop scheduler">Scheduler ON</span>
          ) : (
            <span className="badge" onClick={async () => { switchTab("schedule"); await startSched(); }} style={{ cursor: "pointer" }} title="Click to start scheduler">Scheduler OFF</span>
          )}
          <div style={{position:'relative', width:200, height:6, marginLeft:12, background:'rgba(255,255,255,0.05)', borderRadius:3, overflow:'hidden'}}>
            {uploadProgress != null && (
              <div style={{position:'absolute', left:0, top:0, bottom:0, width:`${Math.round(uploadProgress*100)}%`, background:'var(--accent)'}} />
            )}
          </div>
          {batchProgressLabel && (
            <span className="small" style={{ marginLeft: 8, fontFamily: "ui-monospace" }} title="Batch progress">
              {batchProgressLabel}
            </span>
          )}
        </div>
      </div>

      {toast && <div className="badge" style={{ borderColor: "rgba(139,211,255,0.35)", color: "var(--accent)", marginBottom: 12 }}>{toast}</div>}
      {cfg?.lastError ? <div className="badge bad" style={{ marginBottom: 12 }}> {friendlyIdInMessage(cfg.lastError)}</div> : null}

      {isTabLoading ? (
        <div className="grid">
          <div className="card">
            <div className="content">
              <div style={{ fontSize: "16px", color: "var(--accent)", padding: "40px 0", textAlign: "center" }}>
                Loading {tab === "queue" ? "queue" : tab === "logs" ? "logs" : "content"}...
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
      {displayTab === "setup" && (
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
    <div style={{ height: 16 }} />
    <div className="card" style={{ backgroundColor: "rgba(255,255,255,0.02)", borderRadius: 12, padding: 12, borderLeft: "4px solid var(--accent)" }}>
      <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>Setup Instructions:</div>
      <ol className="small" style={{ marginLeft: 20, lineHeight: 1.6, color: "var(--text-secondary)" }}>
        <li style={{ marginBottom: 8 }}>
          Go to Flickr's Developer Page ({" "}
          <button
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--accent)",
              cursor: "pointer",
              textDecoration: "underline",
              fontSize: "inherit",
              font: "inherit",
            }}
            onClick={() => window.sq.openExternal({ url: "https://www.flickr.com/services/" })}
          >
            https://www.flickr.com/services
          </button>
          {") and click \"Get an API key\""}
          <ul style={{ marginTop: 4, marginLeft: 20 }}>
            <li>Choose "Non-commercial" for your key type</li>
            <li>Name the app something like "ShutterQueue - [your username]"</li>
            <li>Read and acknowledge the Flickr terms</li>
          </ul>
        </li>
        <li style={{ marginBottom: 8 }}>Copy the API Key and paste it below</li>
        <li style={{ marginBottom: 8 }}>Copy the API Secret and paste it below</li>
        <li style={{ marginBottom: 8 }}>Click "Save", then click "Start Authorization"</li>
        <li style={{ marginBottom: 8 }}>A browser window will open for Flickr's OAuth page - log in if needed</li>
        <li>Click "Ok I'll Authorize It" and you'll return to ShutterQueue, logged in!</li>
      </ol>
    </div>
    <div style={{ height: 16 }} />
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
              <div style={{ height: 12 }} />
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={verboseLogging} onChange={(e) => {
                  setVerboseLogging(e.target.checked);
                  window.sq.setVerboseLogging(e.target.checked).catch(console.error);
                }} />
                <span className="small">Enable verbose API and activity logging</span>
              </label>
              <div style={{ height: 8 }} />
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={minimizeToTray} onChange={(e) => {
                  setMinimizeToTray(e.target.checked);
                  window.sq.setMinimizeToTray(e.target.checked).catch(console.error);
                }} />
                <span className="small">
                  {typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') 
                    ? 'Minimize to menu bar when closing the app' 
                    : 'Minimize to system tray when closing the app'}
                </span>
              </label>
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
                    {filteredGroups.slice(0, 200).map(g => (
                      <div key={g.id} className="listrow">
                        <div className="small">{g.name}</div>
                      </div>
                    ))}
                    {!groups.length && <div className="small">Not loaded yet.</div>}
                    {!!groups.length && !filteredGroups.length && <div className="small">No groups match this filter.</div>}
                  </div>
                </div>
                <div>
                  <div className="small">Albums filter</div>
                  <input className="input" value={albumsFilter} onChange={(e) => setAlbumsFilter(e.target.value)} placeholder="search..." />
                  <div style={{ height: 8 }} />
                  <div className="listbox">
                    {filteredAlbums.slice(0, 200).map(a => (
                      <div key={a.id} className="listrow">
                        <div className="small">{a.title}</div>
                      </div>
                    ))}
                    {!albums.length && <div className="small">Not loaded yet.</div>}
                    {!!albums.length && !filteredAlbums.length && <div className="small">No albums match this filter.</div>}
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

      {displayTab === "queue" && (
        <div 
          className="grid"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (!cfg?.authed) {
              showToast("Please authorize first");
              return;
            }

            // Extract file paths from drop event
            const files = e.dataTransfer.files;
            const paths: string[] = [];
            
            // FileList doesn't have array methods, so we need to iterate
            for (let i = 0; i < files.length; i++) {
              const file = files[i];
              
              // Check if file is an image by extension
              const isImageByExtension = /\.(jpg|jpeg|png|webp|gif|tif|tiff|heic)$/i.test(file.name);
              const isImageByMimeType = file.type && file.type.startsWith('image/');
              
              if (isImageByExtension || isImageByMimeType) {
                // Use Electron's webUtils to safely get the file system path
                const filePath = window.sq.getPathForFile(file);
                if (filePath) {
                  paths.push(filePath);
                }
              }
            }

            if (paths.length > 0) {
              await addPhotosFromPaths(paths);
            } else {
              showToast("No image files found in drop");
            }
          }}
        >
          <div className="card">
            <h2>Upload Queue (drag by handle ↕)</h2>
            <div className="content">
              <div style={{ marginBottom: 10, display: "grid", gap: 8 }}>
                <div className="btnrow">
                  <button className="btn primary" onClick={addPhotos} disabled={!cfg?.authed}>Add Photos</button>
                  <button className="btn danger" onClick={removeSelected} disabled={!selectedIds.length}>Remove Selected</button>
                  <button className="btn" onClick={async () => { const q = await window.sq.queueClearUploaded(); setQueue(q); showToast("Cleared successfully uploaded photos."); }} disabled={!queue.length}>Clear Uploaded</button>
                </div>
                <div className="btnrow">
                  <button className="btn" onClick={uploadNext} disabled={!cfg?.authed || !queue.length}>Upload Next Item Now</button>
                  <button className="btn" onClick={openScheduleSelectedDialog} disabled={!hasPendingSelected}>Schedule Selected</button>
                  {manuallyScheduledCount > 0 ? (
                    <button className="btn" onClick={clearManualSchedule}>Clear Manual Schedule</button>
                  ) : null}
                </div>
                <div className="btncluster btncluster-secondary" style={{ justifySelf: "start" }}>
                  <span className="small">Selection</span>
                  <button className="btn btn-sm" onClick={selectAll} disabled={!queue.length}>Select all</button>
                  <button className="btn btn-sm" onClick={clearSelection} disabled={!selectedIds.length}>Clear ({selectedIds.length})</button>
                </div>
              </div>

              {scheduleDialogOpen && (() => {
                const isSingleItem = schedulingItemIds.length === 1;
                const uploadedCount = schedulingItemIds.filter(id => {
                  const it = queue.find(q => q.id === id);
                  return it && it.status !== "pending";
                }).length;
                const hasUploadedItems = uploadedCount > 0;
                return (
                  <div className="schedule-dialog-backdrop" onClick={() => setScheduleDialogOpen(false)}>
                    <div className="schedule-dialog" onClick={(e) => e.stopPropagation()}>
                      <div style={{ fontWeight: 650, marginBottom: 8 }}>
                        {isSingleItem ? "Schedule Upload" : "Schedule Selected"}
                      </div>
                      <div className="small" style={{ marginBottom: 8 }}>
                        {isSingleItem
                          ? "This item will upload at the exact time specified and will be skipped by normal queue order until then."
                          : "Selected items will upload at this exact time and will be skipped by normal queue order until then."}
                      </div>
                      {hasUploadedItems && (
                        <div className="small" style={{ marginBottom: 8, color: "var(--warn)" }}>
                          Previously uploaded items will not be reuploaded or scheduled.
                        </div>
                      )}
                      <input
                        className="input"
                        type="datetime-local"
                        value={scheduleAtLocal}
                        onChange={(e) => setScheduleAtLocal(e.target.value)}
                      />
                      <div className="btnrow" style={{ justifyContent: "space-between", marginTop: 10 }}>
                        <div>
                          {isSingleItem && (
                            <button className="btn" onClick={() => clearManualScheduleForItem(schedulingItemIds[0])}>Clear Manual Schedule</button>
                          )}
                        </div>
                        <div className="btnrow" style={{ justifyContent: "flex-end" }}>
                          <button className="btn" onClick={() => setScheduleDialogOpen(false)}>Cancel</button>
                          <button className="btn primary" onClick={scheduleSelectedAt}>Schedule</button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {pastTimeDialogOpen && (
                <div className="schedule-dialog-backdrop" onClick={() => setPastTimeDialogOpen(false)}>
                  <div className="schedule-dialog" onClick={(e) => e.stopPropagation()}>
                    <div style={{ fontWeight: 650, marginBottom: 8 }}>Selected time is in the past</div>
                    <div className="small" style={{ marginBottom: 12 }}>
                      The time you selected ({formatLocal(pastTimeValue)}) has already passed.
                    </div>
                    <div className="btnrow" style={{ flexDirection: "column", gap: 8 }}>
                      <button className="btn primary" style={{ width: "100%" }} onClick={uploadScheduledItemsNow}>Upload Now</button>
                      <button className="btn" style={{ width: "100%" }} onClick={() => { setPastTimeDialogOpen(false); }}>Edit Scheduled Time</button>
                      <button className="btn" style={{ width: "100%" }} onClick={() => { setPastTimeDialogOpen(false); setScheduleDialogOpen(false); }}>Cancel schedule and return to queue</button>
                    </div>
                  </div>
                </div>
              )}

              {schedulerWarningDialogOpen && (
                <div className="schedule-dialog-backdrop" onClick={() => setSchedulerWarningDialogOpen(false)}>
                  <div className="schedule-dialog" onClick={(e) => e.stopPropagation()}>
                    <div style={{ fontWeight: 650, marginBottom: 8 }}>Scheduler is active</div>
                    <div className="small" style={{ marginBottom: 12 }}>
                      You've added photos to the queue with the scheduler turned on. The next upload will occur at:
                      <div style={{ fontFamily: "ui-monospace", marginTop: 8, fontWeight: 600, color: "var(--accent)" }}>
                        {sched?.nextRunAt ? formatLocal(sched.nextRunAt) : "—"}
                      </div>
                    </div>
                    <div className="btnrow" style={{ flexDirection: "column", gap: 8 }}>
                      <button 
                        className="btn primary" 
                        style={{ width: "100%" }} 
                        onClick={async () => {
                          setSchedulerWarningDialogOpen(false);
                          await performAddPhotos(pendingPhotoPaths);
                          setPendingPhotoPaths([]);
                        }}
                      >
                        Keep Scheduler Active
                      </button>
                      <button 
                        className="btn" 
                        style={{ width: "100%" }} 
                        onClick={async () => {
                          setSchedulerWarningDialogOpen(false);
                          await stopSched();
                          await performAddPhotos(pendingPhotoPaths);
                          setPendingPhotoPaths([]);
                        }}
                      >
                        Disable Scheduler
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="queue">
	                {queue.map((it) => {
	                  const srcs = resolveThumbSrc(it, thumbs, flickrUrls);
	                  const thumb = srcs.thumbSrc;
                  const isSelected = selectedSet.has(it.id);
                  const hasPendingGroupRetries = !!it.groupAddStates && Object.values(it.groupAddStates).some(st => st?.status === "retry");
                  const itemNextRetryAt = (() => {
                    if (!hasPendingGroupRetries) return null;
                    let minTime = Number.POSITIVE_INFINITY;
                    let minIso: string | null = null;
                    for (const st of Object.values(it.groupAddStates || {})) {
                      if (st?.status === "retry" && st.nextRetryAt) {
                        const ts = new Date(st.nextRetryAt).getTime();
                        if (Number.isFinite(ts) && ts < minTime) {
                          minTime = ts;
                          minIso = st.nextRetryAt;
                        }
                      }
                    }
                    return minIso;
                  })();
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
                      onMouseDown={(e) => {
                        const t = e.target as HTMLElement;
                        if (t.closest("button, input, textarea, select, .drag")) return;
                        // Don't prevent default for right-click or ctrl-click (context menu triggers)
                        if (e.button === 2 || e.button === 1) return;
                        // On left-click, prevent text selection  
                        if (e.button === 0 && !e.ctrlKey) {
                          e.preventDefault();
                        }
                      }}
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
                      onContextMenu={(e) => handleContextMenu(e, it.id)}
                      onMouseUp={(e) => {
                        // Detect right-click (button 2) on Mac where ctrl-click also triggers this
                        if (e.button === 2) {
                          handleContextMenu(e as any, it.id);
                        }
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
                            hasPendingGroupRetries ? <span className="badge accent">Uploaded</span> : <span className="badge warn">done (warnings)</span>
                          ) : it.status === "done" ? (
                            hasPendingGroupRetries ? <span className="badge accent">Uploaded</span> : <span className="badge good">done</span>
                          ) : (
                            <span className="badge">{it.status}</span>
                          )}
                          <span className="badge">{PRIVACY_LABEL[it.privacy || "private"]}</span>
                          {(it.groupIds?.length || 0) > 0 ? <span className="badge">{it.groupIds.length} groups</span> : null}
                          {(it.albumIds?.length || 0) > 0 ? <span className="badge">{it.albumIds.length} albums</span> : null}
                          {it.status === "done_warn" && !hasPendingGroupRetries && it.lastError ? (
                            <span className="badge warn" title={friendlyIdInMessage(it.lastError)}>warnings: see details</span>
                          ) : null}
                          {hasPendingGroupRetries ? (
                            <span className="badge warn" title={pendingGroupsTooltip || ""}>Pending Group Additions</span>
                          ) : (
                            hasActualErrorText(it.lastError) ? <span className="badge bad" title={friendlyIdInMessage(it.lastError)}>Error</span> : null
                          )}
                        </div>
                        <div className="qmeta">
                          {it.uploadedAt ? <span className="badge">Uploaded: {formatLocal(it.uploadedAt)}</span> : (hasPendingGroupRetries && itemNextRetryAt ? <span className="badge accent">Pending retry: {formatLocal(itemNextRetryAt)}</span> : (it.status === "pending" && it.scheduledUploadAt ? <span className="badge accent" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); openScheduleDialogForItem(it.id); }}>Scheduled: {formatLocal(it.scheduledUploadAt)}</span> : (sched?.schedulerOn && scheduledMap[it.id] ? <span className="badge">Queued: {scheduledMap[it.id] === "__current_batch__" ? "current batch" : formatLocal(scheduledMap[it.id])}</span> : null)))}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <button
                          className="qmenu-btn"
                          title="Item menu"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!selectedIds.includes(it.id)) {
                              setSelectedIds([it.id]);
                            }
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setContextMenu({ x: rect.left, y: rect.bottom + 4, itemId: it.id });
                          }}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            cursor: "pointer",
                            fontSize: "18px",
                            lineHeight: 1,
                            color: "var(--text-secondary)",
                          }}
                        >
                          ⋮
                        </button>
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
                    </div>
                  );
                })}
              </div>
              {!queue.length && <div className="small">Queue is empty. Click “Add Photos”.</div>}
              <div className="small" style={{ marginTop: 10 }}>
                Selection: click • shift-click (range) • cmd/ctrl-click (toggle) • right-click (menu)
              </div>
            </div>
          </div>

          {contextMenu && (
            <>
              <div 
                style={{ position: "fixed", inset: 0, zIndex: 9998 }} 
                onClick={() => setContextMenu(null)}
              />
              <div
                style={{
                  position: "fixed",
                  top: contextMenu.y,
                  left: contextMenu.x,
                  backgroundColor: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                  zIndex: 9999,
                  minWidth: 180,
                }}
              >
                {(() => {
                  const idsToCheck = selectedIds.length > 0 ? selectedIds : [contextMenu.itemId];
                  const items = queue.filter(it => idsToCheck.includes(it.id));
                  const hasPending = items.some(it => it.status === "pending");
                  const hasScheduled = items.some(it => it.scheduledUploadAt);
                  
                  return (
                    <>
                      <div
                        className="context-menu-item"
                        onClick={removeContextMenuItems}
                        style={{
                          padding: "8px 12px",
                          cursor: "pointer",
                          borderBottom: hasPending ? "1px solid var(--border)" : "none",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover)")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        Remove Item{selectedIds.length > 1 ? "s" : ""}
                      </div>
                      {hasPending && (
                        <>
                          <div
                            className="context-menu-item"
                            onClick={uploadContextMenuItemsNow}
                            style={{
                              padding: "8px 12px",
                              cursor: "pointer",
                              borderBottom: "1px solid var(--border)",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover)")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                          >
                            Upload Now
                          </div>
                          <div
                            className="context-menu-item"
                            onClick={toggleScheduleContextMenu}
                            style={{
                              padding: "8px 12px",
                              cursor: "pointer",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--hover)")}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                          >
                            {hasScheduled ? "Clear Manual Schedule" : "Schedule Time"}
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
              </div>
            </>
          )}

          <div className="card">
            <h2>Edit</h2>
            <div className="content">
              {selectedIds.length > 1 && (
                <>
                  <div className="small" style={{ marginBottom: 12 }}>Batch edit: {selectedIds.length} selected items</div>

                  <label className="small">Title</label>
                  <input className="input" value={batchTitle} onChange={(e) => setBatchTitle(e.target.value)} placeholder="Leave blank to keep existing" />

                  <div className="section-divider" />
                  <label className="small">Description</label>
                  <textarea className="textarea" value={batchDescription} onChange={(e) => setBatchDescription(e.target.value)} placeholder="Leave blank to keep existing" />

                  <div className="section-divider" />
                  <label className="small">Add tags (comma-separated)</label>

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
                  <div className="small">Load saved tag set</div>
                  {renderSavedSetFilterControl("tag")}
                  <div style={{ height: 10 }} />
                  <button className="btn" onClick={() => saveCurrentSelectionAsSet("tag")}>Save entered Tags as a set</button>

                  <div className="section-divider" />
                  <div className="split">
                    <div>
                      <label className="small">Privacy</label>
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
                      <label className="small">Safety level</label>
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

                  <div style={{ height: 12 }} />

                  <button className="btn primary" onClick={applyBatch}>Apply to selected</button>

                  <div className="section-divider" />

                  <div className="split">
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Groups</div>
                      <div className="small" style={{ marginTop: 6 }}>Load saved group set</div>
                      {renderSavedSetFilterControl("group")}
                      <div style={{ height: 6 }} />
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input className="input" value={groupsFilter} onChange={(e) => setGroupsFilter(e.target.value)} placeholder="Filter groups..." style={{ flex: 1 }} />
                        {groupsFilter && <button className="btn btn-sm" onClick={() => setGroupsFilter("")} title="Clear filter">×</button>}
                      </div>
                      <div style={{ height: 8 }} />
                      <div className="btncluster btncluster-secondary" style={{ justifySelf: "start", marginBottom: 8 }}>
                        <span className="small">Filtered</span>
                        <button className="btn btn-sm" onClick={() => selectAllFilteredForCurrentSelection("group")} disabled={!isGroupFilterActive}>Select Filtered</button>
                        <button className="btn btn-sm" onClick={() => clearFilteredSelections("group")} disabled={!isGroupFilterActive}>Clear</button>
                      </div>
                      <div className="listbox">
                        {sortedFilteredGroups.map(g => (
                          <label key={g.id} className="listrow trirow">
                            <TriCheck state={triState("group", g.id)} onToggle={(next) => setForSelected("group", g.id, next)} />
                            <span className="small">{g.name}</span>
                          </label>
                        ))}
                        {!groups.length && <div className="small">Load groups in Setup tab.</div>}
                        {!!groups.length && !sortedFilteredGroups.length && <div className="small">No groups match this filter.</div>}
                      </div>
                      <div style={{ height: 10 }} />
                      <button className="btn" onClick={() => saveCurrentSelectionAsSet("group")}>Save selected Groups as a set</button>
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Albums</div>
                      <div className="small" style={{ marginTop: 6 }}>Load saved album set</div>
                      {renderSavedSetFilterControl("album")}
                      <div style={{ height: 6 }} />
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input className="input" value={albumsFilter} onChange={(e) => setAlbumsFilter(e.target.value)} placeholder="Filter albums..." style={{ flex: 1 }} />
                        {albumsFilter && <button className="btn btn-sm" onClick={() => setAlbumsFilter("")} title="Clear filter">×</button>}
                      </div>
                      <div style={{ height: 8 }} />
                      <div className="btncluster btncluster-secondary" style={{ justifySelf: "start", marginBottom: 8 }}>
                        <span className="small">Filtered</span>
                        <button className="btn btn-sm" onClick={() => selectAllFilteredForCurrentSelection("album")} disabled={!isAlbumFilterActive}>Select Filtered</button>
                        <button className="btn btn-sm" onClick={() => clearFilteredSelections("album")} disabled={!isAlbumFilterActive}>Clear</button>
                      </div>
                      <div className="listbox">
                        {sortedFilteredAlbums.map(a => (
                          <label key={a.id} className="listrow trirow">
                            <TriCheck state={triState("album", a.id)} onToggle={(next) => setForSelected("album", a.id, next)} />
                            <span className="small">{a.title}</span>
                          </label>
                        ))}
                        {!albums.length && <div className="small">Load albums in Setup tab.</div>}
                        {!!albums.length && !sortedFilteredAlbums.length && <div className="small">No albums match this filter.</div>}
                      </div>
                      <div style={{ height: 10 }} />
                      <button className="btn" onClick={() => saveCurrentSelectionAsSet("album")}>Save selected Albums as a set</button>
                      <div style={{ height: 10 }} />
                      <div className="small">Create new albums (comma-separated titles)</div>
                      <input className="input" value={batchCreateAlbums} onChange={(e) => setBatchCreateAlbums(e.target.value)} placeholder="e.g., Trip 2026, Portfolio" />
                    </div>
                  </div>

                  <div className="section-divider" />

                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Location</div>

                    {batchLocationState.mode === "same" && (
                      <div style={{ marginBottom: 10 }}>
                        <div className="small" style={{ marginBottom: 4, fontWeight: 500 }}>Selected Location</div>
                        <div style={{ padding: "8px 12px", background: "rgba(139,211,255,0.15)", borderRadius: 4 }}>
                          <span className="small">{batchLocationState.displayName}</span>
                        </div>
                      </div>
                    )}

                    {batchLocationState.mode === "mixed" && (
                      <div className="small" style={{ marginBottom: 8, color: "var(--text-dim)" }}>
                        Selected items currently have different locations. Leave blank to keep existing values.
                      </div>
                    )}

                    {batchLocationState.mode !== "none" && (
                      <>
                        <label className="small">Location Privacy</label>
                        <select
                          className="input"
                          value={batchLocationState.geoPrivacy}
                          onChange={(e) => {
                            const next = e.target.value as GeoPrivacy;
                            void setBatchLocationPrivacy(next);
                          }}
                          style={{ marginBottom: 8 }}
                        >
                          <option value="public">Public - Visible to everyone</option>
                          <option value="contacts">Contacts - Visible to your contacts</option>
                          <option value="friends">Friends - Visible to friends only</option>
                          <option value="family">Family - Visible to family only</option>
                          <option value="friends_family">Friends & Family</option>
                          <option value="private">Private - Only visible to you</option>
                        </select>
                        {batchLocationState.mode === "same" && (
                          <div className="small" style={{ marginTop: -4, marginBottom: 8, color: "var(--text-dim)" }}>
                            Current location privacy: {GEO_PRIVACY_LABEL[batchLocationState.geoPrivacy]}
                          </div>
                        )}
                      </>
                    )}

                    <label className="small">Search for location</label>
                    <div className="small" style={{ color: "var(--text-dim)", marginTop: 2, marginBottom: 6 }}>
                      Enter an address, city, postal code, country, or lat/long coordinates
                    </div>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input
                        className="input"
                        value={batchLocationQuery}
                        onChange={(e) => setBatchLocationQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") searchBatchLocation();
                        }}
                        placeholder={batchLocationState.mode === "same" ? batchLocationState.displayName : "e.g., Paris, France or 48.8566, 2.3522"}
                        disabled={batchLocationSearching}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn"
                        onClick={searchBatchLocation}
                        disabled={batchLocationSearching || !batchLocationQuery.trim()}
                      >
                        {batchLocationSearching ? "Searching..." : "Search"}
                      </button>
                    </div>

                    {batchLocationResults.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div className="small" style={{ marginBottom: 4, fontWeight: 500 }}>Search Results:</div>
                        <div className="listbox" style={{ maxHeight: 150 }}>
                          {batchLocationResults.map((result, idx) => (
                            <div
                              key={idx}
                              className="listrow"
                              style={{ cursor: "pointer", padding: "6px 8px" }}
                              onClick={() => selectBatchLocation(result)}
                            >
                              <span className="small">{result.displayName}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button
                      className="btn btn-sm"
                      onClick={clearBatchLocation}
                      title="Clear location from all selected items"
                      style={{ background: "var(--bad)", color: "white" }}
                    >
                      Clear Location from Selected
                    </button>
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

                  {isUploaded && (
                    <div style={{ backgroundColor: "var(--warn-bg)", borderLeft: "3px solid var(--warn)", padding: 8, marginBottom: 12, borderRadius: 4 }}>
                      <div className="small" style={{ color: "var(--warn)", fontWeight: "bold" }}>
                        ✓ Already uploaded to Flickr
                      </div>
                      <div className="small" style={{ color: "var(--warn)", marginTop: 4 }}>
                        Metadata fields below are locked. To modify this photo on Flickr, edit it directly on flickr.com.
                      </div>
                    </div>
                  )}

                  <label className="small">Title</label>
                  <input className="input" disabled={isUploaded} value={active.title} onChange={(e) => updateActive({ title: e.target.value })} />

                  <div className="section-divider" />
                  <label className="small">Description</label>
                  <textarea className="textarea" disabled={isUploaded} value={active.description} onChange={(e) => updateActive({ description: e.target.value })} />

                  <div className="section-divider" />
                  <label className="small">Tags (comma-separated)</label>
                  <input className="input" disabled={isUploaded} value={active.tags} onChange={(e) => updateActive({ tags: e.target.value })} placeholder="e.g., travel, street photo, black and white" />
                  <div className="small" style={{ marginTop: 6 }}>
                    Multi-word tags are supported (we’ll quote them automatically for Flickr).
                  </div>

                  <div style={{ height: 10 }} />
                  <div className="small">Load saved tag set</div>
                  {renderSavedSetFilterControl("tag", { disabled: isUploaded })}
                  <div style={{ height: 10 }} />
                  <button className="btn" disabled={isUploaded} onClick={() => saveCurrentSelectionAsSet("tag")}>Save entered Tags as a set</button>

                  <div className="section-divider" />
                  <div className="split">
                    <div>
                      <label className="small">Privacy</label>
                      <select className="input" disabled={isUploaded} value={active.privacy || "private"} onChange={(e) => updateActive({ privacy: e.target.value as any })}>
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
                        disabled={isUploaded}
                        value={String((active as any).safetyLevel || 1)}
                        onChange={(e) => updateActive({ safetyLevel: Number(e.target.value) as any })}
                      >
                        <option value="1">Safe</option>
                        <option value="2">Moderate</option>
                        <option value="3">Restricted</option>
                      </select>
                    </div>
                  </div>

                  <div className="section-divider" />

                  <div className="split">
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Groups</div>
                      <div className="small" style={{ marginTop: 6 }}>Load saved group set</div>
                      {renderSavedSetFilterControl("group")}
                      <div style={{ height: 6 }} />
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input className="input" value={groupsFilter} onChange={(e) => setGroupsFilter(e.target.value)} placeholder="Filter groups..." style={{ flex: 1 }} />
                        {groupsFilter && <button className="btn btn-sm" onClick={() => setGroupsFilter("")} title="Clear filter">×</button>}
                      </div>
                      <div style={{ height: 8 }} />
                      <div className="btncluster btncluster-secondary" style={{ justifySelf: "start", marginBottom: 8 }}>
                        <span className="small">Filtered</span>
                        <button className="btn btn-sm" onClick={() => selectAllFilteredForCurrentSelection("group")} disabled={!isGroupFilterActive}>Select Filtered</button>
                        <button className="btn btn-sm" onClick={() => clearFilteredSelections("group")} disabled={!isGroupFilterActive}>Clear</button>
                      </div>
                      <div className="listbox">
                        {sortedFilteredGroups.map(g => (
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
                        {!!groups.length && !sortedFilteredGroups.length && <div className="small">No groups match this filter.</div>}
                      </div>
                      <div style={{ height: 10 }} />
                      <button className="btn" onClick={() => saveCurrentSelectionAsSet("group")}>Save selected Groups as a set</button>
                    </div>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>Albums</div>
                      <div className="small" style={{ marginTop: 6 }}>Load saved album set</div>
                      {renderSavedSetFilterControl("album")}
                      <div style={{ height: 6 }} />
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input className="input" value={albumsFilter} onChange={(e) => setAlbumsFilter(e.target.value)} placeholder="Filter albums..." style={{ flex: 1 }} />
                        {albumsFilter && <button className="btn btn-sm" onClick={() => setAlbumsFilter("")} title="Clear filter">×</button>}
                      </div>
                      <div style={{ height: 8 }} />
                      <div className="btncluster btncluster-secondary" style={{ justifySelf: "start", marginBottom: 8 }}>
                        <span className="small">Filtered</span>
                        <button className="btn btn-sm" onClick={() => selectAllFilteredForCurrentSelection("album")} disabled={!isAlbumFilterActive}>Select Filtered</button>
                        <button className="btn btn-sm" onClick={() => clearFilteredSelections("album")} disabled={!isAlbumFilterActive}>Clear</button>
                      </div>
                      <div className="listbox">
                        {sortedFilteredAlbums.map(a => (
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
                        {!!albums.length && !sortedFilteredAlbums.length && <div className="small">No albums match this filter.</div>}
                      </div>
                      <div style={{ height: 10 }} />
                      <button className="btn" onClick={() => saveCurrentSelectionAsSet("album")}>Save selected Albums as a set</button>
                      <div style={{ height: 10 }} />
                      <div className="small">Create new albums (comma-separated titles)</div>
                      <input
                        className="input"
                        value={(active.createAlbums || []).join(",")}
                        onChange={(e) => updateActive({ createAlbums: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                        placeholder="e.g., Trip 2026, Portfolio"
                      />
                    </div>
                  </div>

                  <div className="section-divider" />

                  {/* Location Section - Full Width */}
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Location</div>
                    
                    {active.locationDisplayName ? (
                      // Show selected location
                      <div style={{ marginBottom: 12 }}>
                        <div className="small" style={{ marginBottom: 4, fontWeight: 500 }}>Selected Location:</div>
                        <div style={{ 
                          padding: "8px 12px", 
                          background: "rgba(139,211,255,0.15)", 
                          borderRadius: 4,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}>
                          <span className="small">{active.locationDisplayName}</span>
                          <button 
                            className="btn btn-sm" 
                            onClick={clearLocation}
                            disabled={isUploaded}
                            title="Clear location"
                            style={{ background: "var(--bad)", color: "white" }}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    ) : (
                      // Show search interface
                      <div style={{ marginBottom: 12 }}>
                        <label className="small">Search for location</label>
                        <div className="small" style={{ color: "var(--text-dim)", marginTop: 2, marginBottom: 6 }}>
                          Enter an address, city, postal code, country, or lat/long coordinates (e.g., "40.7128, -74.0060")
                        </div>
                        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                          <input 
                            className="input" 
                            value={locationSearchQuery}
                            onChange={(e) => setLocationSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") searchLocation();
                            }}
                            placeholder="e.g., Paris, France or 48.8566, 2.3522"
                            disabled={isUploaded || locationSearching}
                            style={{ flex: 1 }}
                          />
                          <button 
                            className="btn" 
                            onClick={searchLocation}
                            disabled={isUploaded || locationSearching || !locationSearchQuery.trim()}
                          >
                            {locationSearching ? "Searching..." : "Search"}
                          </button>
                        </div>
                        
                        {locationSearchResults.length > 0 && (
                          <div>
                            <div className="small" style={{ marginBottom: 4, fontWeight: 500 }}>Search Results:</div>
                            <div className="listbox" style={{ maxHeight: 200 }}>
                              {locationSearchResults.map((result, idx) => (
                                <div 
                                  key={idx}
                                  className="listrow"
                                  style={{ cursor: "pointer", padding: "6px 8px" }}
                                  onClick={() => selectLocation(result)}
                                >
                                  <span className="small">{result.displayName}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Location Privacy */}
                    {active.locationDisplayName && (
                      <div>
                        <label className="small">Location Privacy</label>
                        <select 
                          className="input" 
                          disabled={isUploaded}
                          value={active.geoPrivacy || "private"}
                          onChange={(e) => updateActive({ geoPrivacy: e.target.value as any })}
                        >
                          <option value="public">Public - Visible to everyone</option>
                          <option value="contacts">Contacts - Visible to your contacts</option>
                          <option value="friends">Friends - Visible to friends only</option>
                          <option value="family">Family - Visible to family only</option>
                          <option value="friends_family">Friends & Family</option>
                          <option value="private">Private - Only visible to you</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div style={{ height: 14 }} />
                  {active.lastError ? (() => {
                    const msg = friendlyIdInMessage(active.lastError) || "";
                    const parts = msg.split("|").map((s) => s.trim()).filter(Boolean);
                    
                    // Categorize messages
                    const successMsgs = parts.filter(p => categorizeMessage(p) === "success");
                    const waitingMsgs = parts.filter(p => categorizeMessage(p) === "waiting");
                    const errorMsgs = parts.filter(p => categorizeMessage(p) === "error");
                    
                    return (
                      <div style={{ marginTop: 10 }}>
                        {successMsgs.length > 0 && (
                          <div>
                            <div className="small" style={{ color: "var(--good)", fontWeight: "bold" }}>Success:</div>
                            <ul className="small" style={{ color: "var(--good)", marginTop: 4, marginBottom: 8, paddingLeft: 18 }}>
                              {successMsgs.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                        )}
                        {waitingMsgs.length > 0 && (
                          <div>
                            <div className="small" style={{ color: "var(--warn)", fontWeight: "bold" }}>Waiting:</div>
                            <ul className="small" style={{ color: "var(--warn)", marginTop: 4, marginBottom: 8, paddingLeft: 18 }}>
                              {waitingMsgs.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                        )}
                        {errorMsgs.length > 0 && (
                          <div>
                            <div className="small" style={{ color: "var(--bad)", fontWeight: "bold" }}>Errors:</div>
                            <ul className="small" style={{ color: "var(--bad)", marginTop: 4, marginBottom: 0, paddingLeft: 18 }}>
                              {errorMsgs.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    );
                  })() : null}
                </>
              )}
            </div>
          </div>


          



        </div>
      )}

      {displayTab === "schedule" && (
        <div className="grid">
          <div className="card">
            <h2>Scheduler</h2>
            <div className="content">
              <div className="row" style={{ gap: 14, marginBottom: 16 }}>
                <button className="btn-start" onClick={startSched} disabled={!cfg?.authed || !queue.length}>▶ Start</button>
                <button className="btn-stop" onClick={stopSched}>■ Stop</button>
                <button className="btn" onClick={uploadNext} disabled={!cfg?.authed || !queue.length}>Upload Next Item Now</button>
              </div>

              <div className="hr" />

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
                        <div
                          key={it.itemId}
                          className={`listrow ${pendingRetryDragOver?.id === it.itemId ? (pendingRetryDragOver.pos === "top" ? "drag-over-top" : "drag-over-bottom") : ""}`}
                          onDragOver={(e) => {
                            e.preventDefault();
                            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                            const pos: "top" | "bottom" = (e.clientY - rect.top) < rect.height / 2 ? "top" : "bottom";
                            setPendingRetryDragOver({ id: it.itemId, pos });
                          }}
                          onDragLeave={() => setPendingRetryDragOver(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            const fromId = e.dataTransfer.getData("application/x-sq-group-retry-id") || e.dataTransfer.getData("text/plain");
                            if (!fromId) return;
                            const pos = pendingRetryDragOver?.id === it.itemId ? pendingRetryDragOver.pos : "top";
                            onDropPendingRetryReorder(fromId, it.itemId, pos);
                          }}
                        >
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
                          <button
                            className="drag"
                            draggable
                            title="Drag to change retry priority for this group"
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("application/x-sq-group-retry-id", it.itemId);
                              e.dataTransfer.setData("text/plain", it.itemId);
                            }}
                          >↕</button>
                          <div className="small" style={{ fontFamily: "ui-monospace" }}>
                            {!sched?.schedulerOn
                              ? "waiting for scheduler restart"
                              : it.itemId === pendingRetryTopItemIdForFocus
                                ? `next slot: ${formatLocal(pendingRetryNextAtForFocus || it.nextRetryAt)}`
                                : "queued"
                            }
                          </div>
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

      
{displayTab === "logs" && (
  <div className="grid">
    <div className="card">
      <h2>Activity Log</h2>
      <div className="content">
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn" onClick={async () => { setLogs(await window.sq.logGet()); showToast("Log refreshed."); }}>Refresh</button>
          <button className="btn danger" onClick={async () => { await window.sq.logClear(); setLogs([]); showToast("Log cleared."); }}>Clear log</button>
          <button className="btn" onClick={async () => { const result = await window.sq.logSave(); showToast(result?.ok ? "Log saved." : "Failed to save log."); }}>Save log to file</button>
        </div>
        <div style={{ height: 8 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={verboseLogging} onChange={(e) => {
            setVerboseLogging(e.target.checked);
            window.sq.setVerboseLogging(e.target.checked).catch(console.error);
          }} />
          <span className="small">Enable verbose API and activity logging</span>
        </label>
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
        </>
      )}
      <div className="footer-fixed">
        <div className="footer-left">
          <span>By Paul Nicholson. Not an official Flickr app.</span>
        </div>
        <div className="footer-right">
          <span className="mono">v{appVersion || "0.8.2-b1"}</span>
        </div>
      </div>

      {duplicateDialogOpen && (
        <div className="schedule-dialog-backdrop" onClick={() => setDuplicateDialogOpen(false)}>
          <div className="schedule-dialog" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 650, marginBottom: 8 }}>
              It looks like you’ve added the same photo twice. Do you want to remove duplicates?
            </div>
            <div className="small" style={{ marginBottom: 10 }}>
              Duplicate matches are based on file content (byte-for-byte hash), not filename or folder.
            </div>
            <div className="listbox" style={{ maxHeight: 260, marginBottom: 10 }}>
              {duplicateDialogGroups.map((group, idx) => (
                <div key={`${group.hash}-${idx}`} style={{ marginBottom: idx === duplicateDialogGroups.length - 1 ? 0 : 10 }}>
                  <div className="small" style={{ marginBottom: 6, fontWeight: 650 }}>
                    Duplicate set {idx + 1}
                  </div>
                  {group.members.map((m) => (
                    <div key={m.id} className="small" style={{ marginBottom: 4 }}>
                      {fileNameFromPath(m.photoPath)} — {m.photoPath}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className="btnrow" style={{ marginTop: 12 }}>
              <button className="btn" onClick={keepDuplicates}>No, keep duplicates</button>
              <button className="btn danger" onClick={removeDuplicates}>Yes, remove duplicates</button>
            </div>
          </div>
        </div>
      )}

      {saveSetDialog && (
        <div className="schedule-dialog-backdrop" onClick={() => setSaveSetDialog(null)}>
          <div className="schedule-dialog" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 650, marginBottom: 8 }}>
              Save Selected As A Set ({saveSetDialog.kind === "group" ? "Groups" : saveSetDialog.kind === "album" ? "Albums" : "Tags"})
            </div>
            <div className="small" style={{ marginBottom: 10 }}>
              You can type a new set name or pick an existing set to overwrite.
            </div>
            <label className="small">Choose existing set (optional)</label>
            <select
              className="input"
              style={{ marginTop: 6, marginBottom: 10 }}
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                setSaveSetNameInput(v);
              }}
            >
              <option value="">(pick existing set)</option>
              {(saveSetDialog.kind === "group" ? savedGroupSets : saveSetDialog.kind === "album" ? savedAlbumSets : savedTagSets).map(s => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
            <label className="small">Set name</label>
            <input
              className="input"
              style={{ marginTop: 6 }}
              value={saveSetNameInput}
              onChange={(e) => setSaveSetNameInput(e.target.value)}
              placeholder={`e.g., ${saveSetDialog.kind === "group" ? "Fujifilm groups" : saveSetDialog.kind === "album" ? "Black and white albums" : "Street night tags"}`}
            />
            <div className="small" style={{ marginTop: 8 }}>
              Items in set: {saveSetDialog.ids.length}
            </div>
            <div className="btnrow" style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setSaveSetDialog(null)}>Cancel</button>
              <button className="btn primary" disabled={!saveSetNameInput.trim()} onClick={saveSetDialogSubmit}>Save</button>
            </div>
          </div>
        </div>
      )}

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