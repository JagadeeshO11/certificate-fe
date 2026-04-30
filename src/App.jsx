import { useEffect, useState } from "react";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "https://certificate-be-ochre.vercel.app").replace(/\/$/, "");
const batchOptions = [10, 25, 50, 100];

export default function App() {
  const [tracks, setTracks] = useState([]);
  const [selectedTrackId, setSelectedTrackId] = useState("");
  const [lists, setLists] = useState([]);
  const [selectedListId, setSelectedListId] = useState("");
  const [recipients, setRecipients] = useState([]);
  const [skippedRows, setSkippedRows] = useState([]);
  const [sendFailures, setSendFailures] = useState([]);
  const [recipientStatuses, setRecipientStatuses] = useState({});
  const [batchSize, setBatchSize] = useState("50");
  const [template, setTemplate] = useState({
    bannerUrl: "",
    title: "Certificate Ready",
    letter: "Your participation certificate is ready. Use the button below to view it.",
    viewButtonText: "View Certificate"
  });
  const [status, setStatus] = useState("Loading certification tracks...");
  const [isSending, setIsSending] = useState(false);

  const selectedTrack = tracks.find((track) => track.id === selectedTrackId);
  const selectedList = lists.find((list) => list.id === selectedListId);
  const doneCount = recipients.filter((recipient) => recipientStatuses[recipient.email]?.status === "sent").length;
  const pendingCount = Math.max(recipients.length - doneCount, 0);

  useEffect(() => {
    async function loadTracks() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/tracks`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Failed to load certification tracks.");
        }

        const nextTracks = data.tracks ?? [];
        setTracks(nextTracks);

        if (nextTracks.length > 0) {
          setSelectedTrackId((current) => current || nextTracks[0].id);
        } else {
          setStatus("No certification tracks are configured.");
        }
      } catch (error) {
        setStatus(error.message);
      }
    }

    loadTracks();
  }, []);

  useEffect(() => {
    if (!selectedTrackId) {
      return;
    }

    async function loadLists() {
      try {
        setStatus("Loading certification events...");
        const response = await fetch(`${apiBaseUrl}/api/lists?track=${encodeURIComponent(selectedTrackId)}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Failed to load certification events.");
        }

        const nextLists = data.lists ?? [];
        setLists(nextLists);

        if (nextLists.length > 0) {
          setSelectedListId((current) => {
            const currentStillExists = nextLists.some((list) => list.id === current);
            return currentStillExists ? current : nextLists[0].id;
          });
        } else {
          setSelectedListId("");
          setRecipients([]);
          setSkippedRows([]);
          setSendFailures([]);
          setRecipientStatuses({});
          setStatus("No CSV files are available for this certification track.");
        }
      } catch (error) {
        setStatus(error.message);
      }
    }

    loadLists();
  }, [selectedTrackId]);

  useEffect(() => {
    if (!selectedListId) {
      return;
    }

    async function loadRecipients() {
      try {
        setStatus("Loading recipients...");
        const response = await fetch(`${apiBaseUrl}/api/recipients?list=${encodeURIComponent(selectedListId)}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Failed to load recipients.");
        }

        setRecipients(data.recipients ?? []);
        setSkippedRows(data.skipped ?? []);
        setSendFailures([]);
        setRecipientStatuses(
          Object.fromEntries(
            (data.recipients ?? []).map((recipient) => [recipient.email, recipient.delivery ?? { status: "pending" }])
          )
        );
        setStatus(
          `Loaded ${data.recipients.length} valid recipient(s) from ${data.list?.name ?? selectedListId}. ${data.skipped?.length ?? 0} row(s) were skipped.`
        );
      } catch (error) {
        setRecipients([]);
        setSkippedRows([]);
        setSendFailures([]);
        setRecipientStatuses({});
        setStatus(error.message);
      }
    }

    loadRecipients();
  }, [selectedListId]);

  async function handleSendEmails() {
    setIsSending(true);
    setStatus("Sending emails...");
    setSendFailures([]);
    setRecipientStatuses((currentStatuses) => {
      const nextStatuses = { ...currentStatuses };
      const limit = batchSize === "all" ? recipients.length : Number(batchSize);

      recipients.slice(0, limit).forEach((recipient) => {
        nextStatuses[recipient.email] = { status: "sending" };
      });

      return nextStatuses;
    });

    try {
      const response = await fetch(`${apiBaseUrl}/api/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          listId: selectedListId,
          batchSize: batchSize === "all" ? recipients.length : Number(batchSize),
          template
        })
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to send emails.");
      }

      setStatus(data.message);
      setSkippedRows(data.skipped ?? []);
      setSendFailures(data.failed ?? []);
      setRecipientStatuses((currentStatuses) => {
        const nextStatuses = { ...currentStatuses };

        (data.results ?? []).forEach((result) => {
          nextStatuses[result.email] = result.delivery;
        });

        return nextStatuses;
      });
    } catch (error) {
      setStatus(error.message);
    } finally {
      setIsSending(false);
    }
  }

  function getRecipientStatus(email) {
    const entry = recipientStatuses[email];
    if (!entry) {
      return { label: "Pending", className: "result-badge pending", reason: "" };
    }

    if (entry.status === "sent") {
      return { label: "Done", className: "result-badge success", reason: "" };
    }

    if (entry.status === "invalid_email") {
      return { label: "Wrong Email", className: "result-badge error", reason: entry.reason ?? "" };
    }

    if (entry.status === "blocked") {
      return { label: "Blocked", className: "result-badge blocked", reason: entry.reason ?? "" };
    }

    if (entry.status === "failed") {
      return { label: "Failed", className: "result-badge error", reason: entry.reason ?? "" };
    }

    return { label: "Sending", className: "result-badge sending", reason: "" };
  }

  function updateTemplateField(key, value) {
    setTemplate((current) => ({
      ...current,
      [key]: value
    }));
  }

  function getTrackDescription(trackId) {
    if (trackId === "demo") {
      return "Recipients confirmation and demo sending flow.";
    }

    if (trackId === "tech") {
      return "Web Development, Hackathon, and Crak The Code.";
    }

    if (trackId === "nontech") {
      return "Presentation, Circutron, and Tecchquiz.";
    }

    return "Choose a certification track to start sending.";
  }

  return (
    <main className="page-shell">
      <section className="dashboard-shell">
        <header className="dashboard-topbar">
          <div>
            <p className="eyebrow">Codeathon 2K26</p>
            <h1>Modern Certificate Dashboard</h1>
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
            <p>{getTrackDescription(selectedTrackId)}</p>
          </article>
          <article className="overview-card">
            <span className="overview-label">Event</span>
            <strong>{selectedList?.name ?? "No CSV"}</strong>
            <p>{selectedList?.id ?? "Waiting for selection"}</p>
          </article>
          <article className="overview-card">
            <span className="overview-label">Recipients</span>
            <strong>{recipients.length}</strong>
            <p>{pendingCount} pending</p>
          </article>
          <article className="overview-card">
            <span className="overview-label">Delivered</span>
            <strong>{doneCount}</strong>
            <p>{sendFailures.length} failed</p>
          </article>
        </section>

        <section className="workspace-grid">
          <aside className="panel control-panel">
            <div className="panel-head">
              <h2>Controls</h2>
              <p>Compact setup for quick mail runs.</p>
            </div>

            <div className="compact-form">
              <label className="field">
                <span>Certificate Track</span>
                <select
                  value={selectedTrackId}
                  onChange={(event) => setSelectedTrackId(event.target.value)}
                  disabled={isSending || tracks.length === 0}
                >
                  {tracks.map((track) => (
                    <option key={track.id} value={track.id}>
                      {track.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Event</span>
                <select
                  value={selectedListId}
                  onChange={(event) => setSelectedListId(event.target.value)}
                  disabled={isSending || lists.length === 0}
                >
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Batch Size</span>
                <select value={batchSize} onChange={(event) => setBatchSize(event.target.value)} disabled={isSending}>
                  {batchOptions.map((option) => (
                    <option key={option} value={String(option)}>
                      {option}
                    </option>
                  ))}
                  <option value="all">All</option>
                </select>
              </label>

              <label className="field field-wide">
                <span>Banner URL</span>
                <input
                  type="url"
                  placeholder="https://res.cloudinary.com/.../banner.png"
                  value={template.bannerUrl}
                  onChange={(event) => updateTemplateField("bannerUrl", event.target.value)}
                  disabled={isSending}
                />
              </label>

              <label className="field">
                <span>Mail Title</span>
                <input
                  type="text"
                  value={template.title}
                  onChange={(event) => updateTemplateField("title", event.target.value)}
                  disabled={isSending}
                />
              </label>

              <label className="field">
                <span>Button Text</span>
                <input
                  type="text"
                  value={template.viewButtonText}
                  onChange={(event) => updateTemplateField("viewButtonText", event.target.value)}
                  disabled={isSending}
                />
              </label>

              <label className="field field-wide">
                <span>Letter</span>
                <textarea
                  rows="4"
                  value={template.letter}
                  onChange={(event) => updateTemplateField("letter", event.target.value)}
                  disabled={isSending}
                />
              </label>
            </div>

            <div className="panel-actions">
              <button className="send-button" onClick={handleSendEmails} disabled={isSending || recipients.length === 0}>
                {isSending ? "Sending..." : "Send Emails"}
              </button>
              <div className="mini-meta">
                <span>{selectedTrack?.events?.length ?? 0} events</span>
                <span>{skippedRows.length} skipped</span>
              </div>
            </div>
          </aside>

          <section className="panel preview-panel">
            <div className="panel-head panel-head-inline">
              <div>
                <h2>Recipient Preview</h2>
                <p>Live data from the selected event CSV.</p>
              </div>
              <div className="panel-chip-row">
                <span className="panel-chip">{selectedTrack?.id ?? "track"}</span>
                <span className="panel-chip">{selectedList?.name ?? "event"}</span>
              </div>
            </div>

            <div className="table-wrap compact-table">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Certificate</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.length > 0 ? (
                    recipients.map((recipient) => {
                      const badge = getRecipientStatus(recipient.email);

                      return (
                        <tr key={recipient.email}>
                          <td>{recipient.name}</td>
                          <td>{recipient.email}</td>
                          <td>
                            <a href={recipient.certificates} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          </td>
                          <td>
                            <span className={badge.className} title={badge.reason}>
                              {badge.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan="4" className="empty-state">
                        No recipients yet. Add rows to the selected CSV.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="signal-grid">
              <article className="signal-card">
                <h3>Skipped Rows</h3>
                <div className="signal-list">
                  {skippedRows.length > 0 ? (
                    skippedRows.map((item) => (
                      <div key={`${item.row}-${item.reason}`} className="signal-item">
                        <strong>Row {item.row}</strong>
                        <span>{item.reason}</span>
                      </div>
                    ))
                  ) : (
                    <div className="signal-item muted">
                      <span>No skipped rows.</span>
                    </div>
                  )}
                </div>
              </article>

              <article className="signal-card">
                <h3>Send Failures</h3>
                <div className="signal-list">
                  {sendFailures.length > 0 ? (
                    sendFailures.map((item) => (
                      <div key={`${item.email}-${item.reason}`} className="signal-item">
                        <strong>{item.email}</strong>
                        <span>{item.reason}</span>
                      </div>
                    ))
                  ) : (
                    <div className="signal-item muted">
                      <span>No send failures.</span>
                    </div>
                  )}
                </div>
              </article>
            </div>
          </section>
        </section>
      </section>
    </main>
  );
}
