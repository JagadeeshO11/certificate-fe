import { useEffect, useRef, useState } from "react";

const CERT_TYPES = [
  { id: "winner", label: "Winner" },
  { id: "runner", label: "Runner Up" },
  { id: "participant", label: "Participant" }
];

const backendOptions = [
  {
    id: "local",
    label: "Local Backend",
    url: (import.meta.env.VITE_API_BASE_URL_LOCAL || "http://localhost:5000").replace(/\/$/, "")
  },
  {
    id: "vercel",
    label: "Vercel Backend",
    url: (import.meta.env.VITE_API_BASE_URL_VERCEL || import.meta.env.VITE_API_BASE_URL || "https://certificate-be-ochre.vercel.app").replace(/\/$/, "")
  }
];
const defaultBackendId = import.meta.env.VITE_DEFAULT_BACKEND || "vercel";

async function readApiResponse(response, fallbackMessage) {
  const rawBody = await response.text();
  let data = {};
  if (rawBody) {
    try { data = JSON.parse(rawBody); } catch {
      if (!response.ok) throw new Error(`${fallbackMessage} Server returned a non-JSON ${response.status} response.`);
    }
  }
  if (!response.ok) throw new Error(data.message || `${fallbackMessage} Server returned ${response.status}.`);
  return data;
}

const RANGE_OPTIONS = [5, 10, 50, 100];
const STATUS_ORDER = { pending: 0, sending: 1, failed: 2, invalid_email: 3, blocked: 4, sent: 5 };

export default function App() {
  const bannerInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const [activeBackendId, setActiveBackendId] = useState(defaultBackendId);
  const [tracks, setTracks] = useState([]);
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [certType, setCertType] = useState("participant");
  const [recipients, setRecipients] = useState([]);
  const [recipientStatuses, setRecipientStatuses] = useState({});
  const [dataSource, setDataSource] = useState(null);
  const [uploadFile, setUploadFile] = useState(null);
  const [template, setTemplate] = useState({
    bannerUrl: "",
    title: "Certificate Ready",
    letter: "Your participation certificate is ready. Use the button below to view it.",
    viewButtonText: "View Certificate"
  });
  const [status, setStatus] = useState("Loading certification tracks...");
  const [isSending, setIsSending] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeletingUpload, setIsDeletingUpload] = useState(false);
  const [deletingEmail, setDeletingEmail] = useState("");
  const [selectedEmails, setSelectedEmails] = useState(new Set());
  const [search, setSearch] = useState("");
  const [colMap, setColMap] = useState({ name: "", email: "", certificate: "" });
  const [csvColumns, setCsvColumns] = useState([]);
  const [showColMapper, setShowColMapper] = useState(false);
  const [pendingListId, setPendingListId] = useState("");

  const sortedRecipients = [...recipients].sort((a, b) => {
    const aOrder = STATUS_ORDER[recipientStatuses[a.email]?.status ?? "pending"] ?? 0;
    const bOrder = STATUS_ORDER[recipientStatuses[b.email]?.status ?? "pending"] ?? 0;
    return aOrder - bOrder;
  });

  const q = search.trim().toLowerCase();
  const filteredRecipients = q
    ? sortedRecipients.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
    : sortedRecipients;

  function highlight(text) {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return text;
    return <>{text.slice(0, idx)}<mark className="search-highlight">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
  }

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId);
  const selectedList = lists.find((l) => l.id === selectedListId);
  const activeBackend = backendOptions.find((b) => b.id === activeBackendId) ?? backendOptions[1];
  const apiBaseUrl = activeBackend.url;
  const isBusy = isSending || isUploading || isDeletingUpload;
  const pendingRecipients = recipients.filter((r) => !recipientStatuses[r.email] || recipientStatuses[r.email]?.status === "pending");
  const doneCount = recipients.filter((r) => recipientStatuses[r.email]?.status === "sent").length;
  const allSelected = pendingRecipients.length > 0 && pendingRecipients.every((r) => selectedEmails.has(r.email));

  function resetListState() {
    setRecipients([]);
    setRecipientStatuses({});
    setDataSource(null);
    setSelectedEmails(new Set());
  }

  async function loadRecipientsForList(listId, { announce = true } = {}) {
    const params = new URLSearchParams({ list: listId });
    if (colMap.name) params.set("colName", colMap.name);
    if (colMap.email) params.set("colEmail", colMap.email);
    if (colMap.certificate) params.set("colCert", colMap.certificate);
    const response = await fetch(`${apiBaseUrl}/api/recipients?${params}`);
    const data = await readApiResponse(response, "Failed to load recipients.");
    setRecipients(data.recipients ?? []);
    setDataSource(data.source ?? null);
    setSelectedEmails(new Set());
    setRecipientStatuses(
      Object.fromEntries((data.recipients ?? []).map((r) => [r.email, r.delivery ?? { status: "pending" }]))
    );
    const summary = `Loaded ${data.recipients?.length ?? 0} recipient(s) from ${data.list?.name ?? listId}. Source: ${data.source?.label ?? "Unknown"}.`;
    if (announce) setStatus(summary);
    return { data, summary };
  }

  async function loadColumns(listId) {
    try {
      const res = await fetch(`${apiBaseUrl}/api/lists/${encodeURIComponent(listId)}/columns`);
      const data = await readApiResponse(res, "Failed to load columns.");
      const cols = data.columns ?? [];
      if (cols.length === 0) {
        setStatus("No columns found in CSV. Check the file format.");
        return;
      }
      setCsvColumns(cols);
      // pre-select obvious matches
      const guess = (patterns) => cols.find((c) => patterns.some((p) => c.toLowerCase().includes(p))) ?? "";
      setColMap({
        name: guess(["participant", "name", "student", "full"]),
        email: guess(["email", "mail"]),
        certificate: guess(["cert", "link", "url", "drive"])
      });
      setPendingListId(listId);
      setShowColMapper(true);
    } catch (error) {
      setStatus(error.message);
      setCsvColumns([]);
    }
  }

  async function applyColMap() {
    if (!colMap.name || !colMap.email || !colMap.certificate) {
      setStatus("Please map all three columns before loading.");
      return;
    }
    setShowColMapper(false);
    setStatus("Loading recipients...");
    try {
      await loadRecipientsForList(pendingListId);
    } catch (error) {
      resetListState(); setStatus(error.message);
    }
  }

  useEffect(() => {
    resetListState();
    setTracks([]); setSelectedTrackId(""); setLists([]); setSelectedListId("");

    async function loadTracks() {
      try {
        setStatus(`Connecting to ${activeBackend.label}...`);
        const response = await fetch(`${apiBaseUrl}/api/tracks`);
        const data = await readApiResponse(response, "Failed to load tracks.");
        const nextTracks = data.tracks ?? [];
        setTracks(nextTracks);
        if (nextTracks.length > 0) setSelectedTrackId((c) => c || nextTracks[0].id);
        else setStatus("No certification tracks configured.");
      } catch (error) { setStatus(error.message); }
    }
    loadTracks();
  }, [activeBackendId]);

  useEffect(() => {
    if (!selectedTrackId) return;
    async function loadLists() {
      try {
        setStatus("Loading events...");
        const response = await fetch(`${apiBaseUrl}/api/lists?track=${encodeURIComponent(selectedTrackId)}`);
        const data = await readApiResponse(response, "Failed to load events.");
        const nextLists = data.lists ?? [];
        setLists(nextLists);
        if (nextLists.length > 0) {
          setSelectedListId((c) => nextLists.some((l) => l.id === c) ? c : nextLists[0].id);
        } else {
          setSelectedListId(""); resetListState();
          setStatus("No CSV files available for this track.");
        }
      } catch (error) { setStatus(error.message); }
    }
    loadLists();
  }, [selectedTrackId]);

  useEffect(() => {
    if (!selectedListId) return;
    async function initList() {
      try {
        setStatus("Reading CSV columns...");
        await loadColumns(selectedListId);
      } catch (error) {
        resetListState(); setStatus(error.message);
      }
    }
    initList();
  }, [selectedListId]);

  function toggleSelectAll() {
    const allPendingSelected = pendingRecipients.every((r) => selectedEmails.has(r.email));
    if (allPendingSelected) setSelectedEmails(new Set());
    else setSelectedEmails(new Set(pendingRecipients.map((r) => r.email)));
  }

  function selectRange(n) {
    setSelectedEmails(new Set(pendingRecipients.slice(0, n).map((r) => r.email)));
  }

  function toggleEmail(email) {
    setSelectedEmails((prev) => {
      const next = new Set(prev);
      next.has(email) ? next.delete(email) : next.add(email);
      return next;
    });
  }

  function handleBannerFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      const MAX = 800;
      const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      setTemplate((p) => ({ ...p, bannerUrl: dataUrl }));
    };
    img.src = objectUrl;
  }

  async function handleUpload() {
    if (!uploadFile || !selectedListId) return;
    setIsUploading(true); setStatus("Uploading CSV...");
    try {
      const cleanName = uploadFile.name.replace(/\.csv$/i, "");
      const response = await fetch(
        `${apiBaseUrl}/api/lists/${encodeURIComponent(selectedListId)}/upload?filename=${encodeURIComponent(cleanName)}`,
        { method: "POST", headers: { "Content-Type": "text/csv" }, body: uploadFile }
      );
      const data = await readApiResponse(response, "Upload failed.");
      const { summary } = await loadRecipientsForList(selectedListId, { announce: false });
      setStatus(`${data.message} ${summary}`);
      setUploadFile(null);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    } catch (error) { setStatus(error.message); }
    finally { setIsUploading(false); }
  }

  async function handleDeleteUpload() {
    if (!selectedListId) return;
    setIsDeletingUpload(true); setStatus("Deleting uploaded file...");
    try {
      const response = await fetch(`${apiBaseUrl}/api/lists/${encodeURIComponent(selectedListId)}/upload`, { method: "DELETE" });
      const data = await readApiResponse(response, "Delete failed.");
      const { summary } = await loadRecipientsForList(selectedListId, { announce: false });
      setStatus(`${data.message} ${summary}`);
    } catch (error) { setStatus(error.message); }
    finally { setIsDeletingUpload(false); }
  }

  async function handleRefresh() {
    if (!selectedListId) return;
    setStatus("Refreshing...");
    try {
      const { summary } = await loadRecipientsForList(selectedListId, { announce: false });
      setStatus(summary);
    } catch (error) { setStatus(error.message); }
  }

  async function handleDeleteRecipient(email) {
    if (!selectedListId || !email) return;
    setDeletingEmail(email); setStatus(`Deleting ${email}...`);
    try {
      const response = await fetch(`${apiBaseUrl}/api/recipients`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId: selectedListId, email })
      });
      const data = await readApiResponse(response, "Delete failed.");
      const { summary } = await loadRecipientsForList(selectedListId, { announce: false });
      setStatus(`${data.message} ${summary}`);
    } catch (error) { setStatus(error.message); }
    finally { setDeletingEmail(""); }
  }

  async function handleSend(emailsToSend) {
    if (!emailsToSend.length) return;
    setIsSending(true); setStatus(`Sending ${emailsToSend.length} email(s)...`);
    setRecipientStatuses((prev) => {
      const next = { ...prev };
      emailsToSend.forEach((email) => { next[email] = { status: "sending" }; });
      return next;
    });
    try {
      const certLabel = CERT_TYPES.find((c) => c.id === certType)?.label ?? "Participant";
      const response = await fetch(`${apiBaseUrl}/api/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listId: selectedListId,
          emails: emailsToSend,
          colName: colMap.name || undefined,
          colEmail: colMap.email || undefined,
          colCert: colMap.certificate || undefined,
          template: { ...template, title: `${certLabel} Certificate Ready` }
        })
      });
      const data = await readApiResponse(response, "Send failed.");
      setStatus(data.message);
      setDataSource(data.source ?? dataSource);
      setRecipientStatuses((prev) => {
        const next = { ...prev };
        (data.results ?? []).forEach((r) => { next[r.email] = r.delivery; });
        return next;
      });
      setSelectedEmails(new Set());
    } catch (error) { setStatus(error.message); }
    finally { setIsSending(false); }
  }

  function getRecipientStatus(email) {
    const entry = recipientStatuses[email];
    if (!entry) return { label: "Pending", className: "result-badge pending", reason: "" };
    if (entry.status === "sent") return { label: "Done", className: "result-badge success", reason: "" };
    if (entry.status === "invalid_email") return { label: "Wrong Email", className: "result-badge error", reason: entry.reason ?? "" };
    if (entry.status === "blocked") return { label: "Blocked", className: "result-badge blocked", reason: entry.reason ?? "" };
    if (entry.status === "failed") return { label: "Failed", className: "result-badge error", reason: entry.reason ?? "" };
    return { label: "Sending", className: "result-badge sending", reason: "" };
  }

  return (
    <main className="page-shell">
      <section className="dashboard-shell">
        <header className="dashboard-topbar">
          <div>
            <p className="eyebrow">Codeathon 2K26</p>
            <h1>Certificate Dashboard</h1>
          </div>
          <div className="topbar-status">
            <span className="status-dot" />
            <span>{status}</span>
          </div>
        </header>

        <section className="overview-strip">
          <article className="overview-card feature">
            <span className="overview-label">Track</span>
            <strong>{selectedTrack?.name ?? "Not selected"}</strong>
          </article>
          <article className="overview-card">
            <span className="overview-label">Event</span>
            <strong>{selectedList?.name ?? "—"}</strong>
          </article>
          <article className="overview-card">
            <span className="overview-label">Certificate Type</span>
            <strong>{CERT_TYPES.find((c) => c.id === certType)?.label ?? "—"}</strong>
          </article>
          <article className="overview-card">
            <span className="overview-label">Recipients</span>
            <strong>{recipients.length}</strong>
            <div className="overview-tally">
              <span className="tally-done">✅ {doneCount} done</span>
              <span className="tally-pending">⏳ {pendingRecipients.length} pending</span>
              <span className="tally-selected">☑️ {selectedEmails.size} selected</span>
            </div>
          </article>
        </section>

        <section className="workspace-grid">
          <aside className="panel control-panel">
            <div className="panel-head">
              <h2>Controls</h2>
            </div>

            <div className="compact-form">
              <label className="field">
                <span>Backend</span>
                <select value={activeBackendId} onChange={(e) => setActiveBackendId(e.target.value)} disabled={isBusy}>
                  {backendOptions.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </select>
              </label>

              <label className="field">
                <span>Event</span>
                <select value={selectedListId} onChange={(e) => setSelectedListId(e.target.value)} disabled={isBusy || !lists.length}>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>

              <div className="field field-wide">
                <span>Upload CSV</span>
                <input ref={uploadInputRef} type="file" accept=".csv" onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} disabled={isBusy} />
                {uploadFile && <span className="field-subnote">📄 {uploadFile.name}</span>}
                <div className="upload-actions">
                  <button className="send-button secondary-button" onClick={handleUpload} disabled={isBusy || !uploadFile || !selectedListId}>
                    {isUploading ? "Uploading..." : "Upload"}
                  </button>
                  <button className="send-button secondary-button" onClick={handleRefresh} disabled={isBusy || !selectedListId}>
                    Refresh
                  </button>
                </div>
              </div>

              {dataSource && (
                <div className="field field-wide uploaded-file-card">
                  <span>Active Source</span>
                  <div className="uploaded-file-info">
                    <span className="uploaded-file-icon">📁</span>
                    <div>
                      <strong>{dataSource.filename ?? dataSource.pathname}</strong>
                      <span className="field-subnote">{dataSource.label}{dataSource.uploadedAt ? ` · ${new Date(dataSource.uploadedAt).toLocaleString()}` : ""}</span>
                    </div>
                  </div>
                  {dataSource.type === "mongodb" && (
                    <button className="send-button danger-button" onClick={handleDeleteUpload} disabled={isBusy}>
                      {isDeletingUpload ? "Deleting..." : "Delete Uploaded File"}
                    </button>
                  )}
                </div>
              )}

              <div className="field field-wide">
                <span>Banner Image</span>
                <input ref={bannerInputRef} type="file" accept="image/*" onChange={handleBannerFile} disabled={isBusy} />
                {template.bannerUrl && (
                  <div className="banner-preview-wrap">
                    <img src={template.bannerUrl} alt="Banner preview" className="banner-preview" />
                    <button className="search-clear-btn" onClick={() => { setTemplate((p) => ({ ...p, bannerUrl: "" })); if (bannerInputRef.current) bannerInputRef.current.value = ""; }}>✕ Remove</button>
                  </div>
                )}
              </div>

              <label className="field">
                <span>Mail Title</span>
                <input type="text" value={template.title} onChange={(e) => setTemplate((p) => ({ ...p, title: e.target.value }))} disabled={isBusy} />
              </label>

              <label className="field">
                <span>Button Text</span>
                <input type="text" value={template.viewButtonText} onChange={(e) => setTemplate((p) => ({ ...p, viewButtonText: e.target.value }))} disabled={isBusy} />
              </label>

              <label className="field field-wide">
                <span>Letter</span>
                <textarea rows="3" value={template.letter} onChange={(e) => setTemplate((p) => ({ ...p, letter: e.target.value }))} disabled={isBusy} />
              </label>
            </div>

            <div className="panel-actions">
              <button
                className="send-button"
                onClick={() => handleSend([...selectedEmails])}
                disabled={isBusy || selectedEmails.size === 0}
              >
                {isSending ? "Sending..." : `Send Selected (${selectedEmails.size})`}
              </button>
            </div>
          </aside>

          <section className="panel preview-panel">
            <div className="recipients-head">
              <div className="recipients-head-top">
                <div>
                  <h2>Recipients</h2>
                  <p>{selectedList?.name ?? "No event selected"} · <span className={`source-tag source-${dataSource?.type ?? "none"}`}>{dataSource?.label ?? "No source"}</span></p>
                </div>
                <div className="panel-chip-row">
                  <span className="panel-chip">{selectedTrack?.id ?? "track"}</span>
                  <span className="panel-chip">{CERT_TYPES.find((c) => c.id === certType)?.label ?? "type"}</span>
                </div>
              </div>
            </div>

            <div className="table-toolbar">
              <span className="toolbar-label">Quick select pending:</span>
              {RANGE_OPTIONS.map((n) => (
                <button key={n} className="range-btn" onClick={() => selectRange(n)} disabled={isBusy || pendingRecipients.length === 0}>
                  {n}
                </button>
              ))}
              <button className="range-btn range-btn-clear" onClick={() => setSelectedEmails(new Set())} disabled={isBusy || selectedEmails.size === 0}>
                Clear
              </button>
              <span className="toolbar-count">{selectedEmails.size} selected · {pendingRecipients.length} pending</span>
            </div>

            <div className="table-wrap compact-table">
              <div className="table-search-wrap">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input
                  className="table-search-input"
                  placeholder="Search by name or email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && <button className="search-clear-btn" onClick={() => setSearch("")}>✕</button>}
                {q && <span className="toolbar-count">{filteredRecipients.length} match{filteredRecipients.length !== 1 ? "es" : ""}</span>}
              </div>
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={isBusy || !recipients.length} /></th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Certificate</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecipients.length > 0 ? filteredRecipients.map((r) => {
                    const badge = getRecipientStatus(r.email);
                    return (
                      <tr key={r.email} className={selectedEmails.has(r.email) ? "row-selected" : ""}>
                        <td><input type="checkbox" checked={selectedEmails.has(r.email)} onChange={() => toggleEmail(r.email)} disabled={isBusy} /></td>
                        <td className="td-name">{highlight(r.name)}</td>
                        <td className="td-email">{highlight(r.email)}</td>
                        <td><a href={r.certificates} target="_blank" rel="noreferrer">Open ↗</a></td>
                        <td><span className={badge.className} title={badge.reason}>{badge.label}</span></td>
                      </tr>
                    );
                  }) : (
                    <tr><td colSpan="5" className="empty-state">{q ? `No results for "${search}"` : "No recipients. Select an event or upload a CSV."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </section>

      {showColMapper && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 className="modal-title">Map CSV Columns</h2>
            <p className="modal-sub">Your file has these columns. Tell us which one is which.</p>

            <div className="modal-cols-preview">
              {csvColumns.map((c) => <span key={c} className="col-chip">{c}</span>)}
            </div>

            <div className="modal-fields">
              {[["name", "👤 Name / Participants"], ["email", "✉️ Email"], ["certificate", "🔗 Certificate Link"]].map(([key, label]) => (
                <div key={key} className="modal-field-row">
                  <label className="modal-field-label">{label}</label>
                  <select
                    className="modal-select"
                    value={colMap[key]}
                    onChange={(e) => setColMap((p) => ({ ...p, [key]: e.target.value }))}
                  >
                    <option value="">— select column —</option>
                    {csvColumns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button className="send-button" onClick={applyColMap} disabled={!colMap.name || !colMap.email || !colMap.certificate}>
                Load Recipients
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
