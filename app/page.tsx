"use client";

import { useEffect, useMemo, useState } from "react";

type Split = { name: string; seconds: number };
type Race = {
  id: string;
  sourceUrl: string;
  eventName: string;
  eventDate: string;
  format: string;
  participant?: string;
  bib?: string;
  category?: string;
  totalSeconds: number;
  penaltySeconds: number;
  penaltyNote?: string;
  notes?: string;
  splits: Split[];
  createdAt: string;
  isPB?: boolean;
};

const STORE = "comparador-carreras:v1";

function isRace(value: unknown): value is Race {
  if (!value || typeof value !== "object") return false;
  const race = value as Partial<Race>;
  return Boolean(
    typeof race.id === "string" &&
      typeof race.eventName === "string" &&
      typeof race.totalSeconds === "number" &&
      Array.isArray(race.splits) &&
      race.splits.every(
        (split) =>
          split &&
          typeof split.name === "string" &&
          typeof split.seconds === "number",
      ),
  );
}

function parseRaces(value: unknown): Race[] {
  return Array.isArray(value) ? value.filter(isRace) : [];
}

function createRaceId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `race-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function time(seconds = 0) {
  const value = Math.max(0, Math.round(seconds));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function dateLabel(value: string) {
  if (!value) return "Sin fecha";
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

export default function Home() {
  const [races, setRaces] = useState<Race[]>([]);
  const [ready, setReady] = useState(false);
  const [modal, setModal] = useState<"add" | "detail" | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selected, setSelected] = useState<Race | null>(null);
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<Partial<Race> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [formatFilter, setFormatFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"date" | "time" | "name">("date");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved) setRaces(parseRaces(JSON.parse(saved)));
    } catch {
      // A damaged local copy must not prevent the page from rendering.
      setRaces([]);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(STORE, JSON.stringify(races));
  }, [races, ready]);

  const compared = useMemo(() => races.filter((race) => compareIds.includes(race.id)), [races, compareIds]);

  const availableFormats = useMemo(
    () => [...new Set(races.map((race) => race.format).filter(Boolean))].sort(),
    [races],
  );

  const visibleRaces = useMemo(() => {
    return races
      .filter((race) => formatFilter === "all" || race.format === formatFilter)
      .sort((a, b) => {
        if (sortBy === "time") return a.totalSeconds - b.totalSeconds;
        if (sortBy === "name") return a.eventName.localeCompare(b.eventName, "es");
        return (b.eventDate || b.createdAt).localeCompare(a.eventDate || a.createdAt);
      });
  }, [races, formatFilter, sortBy]);

  const referenceParticipant = useMemo(
    () => races.find((race) => race.isPB && race.participant?.trim())?.participant?.trim() || "",
    [races],
  );

  const evolutionRaces = useMemo(() => {
    const source = referenceParticipant
      ? races.filter(
          (race) => race.participant?.trim().toLocaleLowerCase() === referenceParticipant.toLocaleLowerCase(),
        )
      : races;
    return [...source].sort((a, b) => (a.eventDate || a.createdAt).localeCompare(b.eventDate || b.createdAt));
  }, [races, referenceParticipant]);

  const evolutionPoints = useMemo(() => {
    if (!evolutionRaces.length) return [];
    const min = Math.min(...evolutionRaces.map((race) => race.totalSeconds));
    const max = Math.max(...evolutionRaces.map((race) => race.totalSeconds));
    const range = Math.max(max - min, 1);
    return evolutionRaces.map((race, index) => ({
      race,
      x: evolutionRaces.length === 1 ? 350 : 35 + (index * 630) / (evolutionRaces.length - 1),
      y: 35 + ((race.totalSeconds - min) / range) * 150,
    }));
  }, [evolutionRaces]);

  const splitNames = useMemo(() => {
    const names: string[] = [];
    compared.forEach((race) => {
      race.splits.forEach((split) => {
        if (!names.includes(split.name)) {
          names.push(split.name);
        }
      });
    });
    return names;
  }, [compared]);

  const minTotalSeconds = useMemo(() => {
    if (compared.length < 2) return 0;
    return Math.min(...compared.map((r) => r.totalSeconds));
  }, [compared]);

  function togglePB(id: string) {
    setRaces((current) =>
      current.map((r) => (r.id === id ? { ...r, isPB: !r.isPB } : r))
    );
  }

  async function importRace() {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/import-race", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo leer la carrera");
      setDraft(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el enlace");
    } finally {
      setLoading(false);
    }
  }

  function saveRace() {
    if (!draft?.eventName || !draft.totalSeconds) {
      setError("El nombre y el tiempo total son obligatorios");
      return;
    }
    const race: Race = {
      id: createRaceId(),
      sourceUrl: url || "",
      eventName: draft.eventName,
      eventDate: draft.eventDate || "",
      format: draft.format || "",
      participant: draft.participant || "",
      bib: draft.bib || "",
      category: draft.category || "",
      totalSeconds: Number(draft.totalSeconds),
      penaltySeconds: Number(draft.penaltySeconds || 0),
      penaltyNote: draft.penaltyNote || "",
      notes: draft.notes || "",
      splits: draft.splits || [],
      createdAt: new Date().toISOString(),
    };
    setRaces((current) => [race, ...current]);
    closeModal();
  }

  function closeModal() {
    setModal(null);
    setDraft(null);
    setUrl("");
    setError("");
  }

  function openDetail(race: Race) {
    setSelected(race);
    setModal("detail");
  }

  function deleteRace(race: Race) {
    if (!confirm(`¿Eliminar la carrera “${race.eventName}”?`)) return;
    setRaces((items) => items.filter((item) => item.id !== race.id));
    setCompareIds((ids) => ids.filter((id) => id !== race.id));
    setModal(null);
  }

  function updateRaceNotes(id: string, notes: string) {
    setRaces((items) => items.map((item) => item.id === id ? { ...item, notes } : item));
    setSelected((current) => current?.id === id ? { ...current, notes } : current);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(races, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `carreras-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const imported = parseRaces(parsed);
        if (!Array.isArray(parsed) || imported.length !== parsed.length) throw new Error();
        setRaces(imported);
      } catch {
        alert("El archivo no contiene una copia válida.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#">Deka<span>Lab</span></a>
        <div className="top-actions">
          <button className="help-button" onClick={() => setHelpOpen(true)} aria-label="Abrir ayuda" title="Cómo funciona DekaLab">?</button>
          <button
            className="quiet"
            onClick={exportData}
            disabled={!races.length}
            title={races.length ? "Descargar todas las carreras guardadas" : "No hay carreras para guardar"}
          >
            Guardar carreras
          </button>
          <label className="quiet file">Importar copia<input type="file" accept=".json" onChange={importBackup} /></label>
          <button className="primary" onClick={() => setModal("add")}>+ Añadir carrera</button>
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">COMPETIDORES DEKA</p>
          <h1>Cada parcial cuenta.<br /><em>Compara tu DEKA.</em></h1>
          <p className="lead">Importa tus resultados de DEKA FIT, MILE o STRONG, analiza cada estación y descubre dónde ganar tiempo a tus rivales.</p>
        </div>
        <div className="stat-card">
          <span>CARRERAS GUARDADAS</span>
          <strong>{races.length}</strong>
          <small>Los datos se guardan solo en este dispositivo</small>
        </div>
      </section>

      <section className="content">
        <div className="section-head">
          <div><p className="eyebrow">RESULTADOS</p><h2>Mis carreras</h2></div>
          {races.length > 1 && <p className="hint">Selecciona dos o más para comparar</p>}
        </div>

        {!ready ? (
          <div className="empty loading-state" aria-live="polite">Cargando carreras…</div>
        ) : races.length === 0 ? (
          <div className="empty">
            <div className="track-mark">01</div>
            <h3>Aún no hay carreras</h3>
            <p>Añade un enlace de Race Result para importar el tiempo, los parciales y las penalizaciones.</p>
            <button className="primary" onClick={() => setModal("add")}>Añadir mi primera carrera</button>
          </div>
        ) : (
          <>
            <div className="list-controls" aria-label="Filtros, ordenación y visualización">
              <label>Modalidad
                <select value={formatFilter} onChange={(e) => setFormatFilter(e.target.value)}>
                  <option value="all">Todas</option>
                  {availableFormats.map((format) => <option key={format} value={format}>{format}</option>)}
                </select>
              </label>
              <label>Ordenar por
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
                  <option value="date">Más recientes</option>
                  <option value="time">Mejor tiempo</option>
                  <option value="name">Nombre</option>
                </select>
              </label>
              <div className="view-toggle" aria-label="Modo de visualización">
                <span>Ver como</span>
                <button className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")} aria-pressed={viewMode === "grid"}>Cuadrícula</button>
                <button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")} aria-pressed={viewMode === "list"}>Lista</button>
              </div>
            </div>
            {visibleRaces.length === 0 ? (
              <div className="empty filtered-empty">No hay carreras con este filtro.</div>
            ) : (
              <div className={`race-grid ${viewMode === "list" ? "list-view" : ""}`}>
            {visibleRaces.map((race) => {
              const isSelected = compareIds.includes(race.id);
              const toggleSelect = () => setCompareIds((ids) => ids.includes(race.id) ? ids.filter((id) => id !== race.id) : [...ids, race.id]);

              return (
                <article
                  className={`race-card ${isSelected ? "selected" : ""} ${race.isPB ? "pb-card" : ""}`}
                  key={race.id}
                  onClick={toggleSelect}
                >
                  <label className="check" title="Seleccionar para comparar" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={toggleSelect} />
                    <span />
                  </label>
                  <div className="card-top-row">
                    <p className="race-date">{dateLabel(race.eventDate)}</p>
                    <button
                      className={`pb-badge-btn ${race.isPB ? "active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); togglePB(race.id); }}
                      title={race.isPB ? "Quitar mejor marca personal" : "Marcar como mejor marca personal"}
                    >
                      {race.isPB ? "★ PB" : "Marcar PB"}
                    </button>
                  </div>
                  <h3>{race.eventName}</h3>
                  <p className="meta">{[race.participant, race.format].filter(Boolean).join(" · ")}</p>
                  <div className="race-time">{time(race.totalSeconds)}</div>
                  <div className="card-foot">
                    {viewMode === "grid" && <span>{race.splits.length} parciales{race.penaltySeconds ? ` · +${time(race.penaltySeconds)} penalización` : ""}</span>}
                    <div className="card-actions">
                      {viewMode === "grid" ? <>
                        <button className="delete-card" onClick={(e) => { e.stopPropagation(); deleteRace(race); }}>Eliminar</button>
                        <button onClick={(e) => { e.stopPropagation(); openDetail(race); }}>Ver detalle →</button>
                      </> : <>
                        <button className="icon-action" onClick={(e) => { e.stopPropagation(); openDetail(race); }} aria-label={`Ver detalle de ${race.eventName}`} title="Ver detalle">↗</button>
                        <button className="delete-card icon-action" onClick={(e) => { e.stopPropagation(); deleteRace(race); }} aria-label={`Eliminar ${race.eventName}`} title="Eliminar carrera">🗑</button>
                      </>}
                    </div>
                  </div>
                </article>
              );
            })}
              </div>
            )}
          </>
        )}

        {compared.length >= 2 && (
          <section className="comparison">
            <div className="section-head"><div><p className="eyebrow">COMPARATIVA</p><h2>Carrera a carrera</h2></div></div>

            <div className="insights-grid">
              <div className="insight-card"><span className="insight-icon">🏆</span><div><span className="insight-title">Mejor tiempo</span><p className="insight-body">{compared.find((race) => race.totalSeconds === minTotalSeconds)?.eventName} · {time(minTotalSeconds)}</p></div></div>
            </div>
            
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Parcial / Resultado</th>
                    {compared.map((r) => (
                      <th key={r.id}>
                        <div className="th-race-title">{r.eventName}</div>
                        {r.participant && <div className="th-race-sub">{r.participant}</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="table-section-title">
                    <td colSpan={compared.length + 1}>RESUMEN GENERAL</td>
                  </tr>
                  <tr className="highlight-row">
                    <td><strong>Tiempo total</strong></td>
                    {compared.map((r) => {
                      const isWinner = r.totalSeconds === minTotalSeconds;
                      return (
                        <td key={r.id}>
                          <span className={isWinner ? "time-winner" : "time-normal"}>
                            {time(r.totalSeconds)}
                            {isWinner && <span className="winner-badge">Mejor tiempo</span>}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td>Penalizaciones</td>
                    {compared.map((r) => (
                      <td key={r.id}>{r.penaltySeconds ? <span className="penalty-tag">+{time(r.penaltySeconds)}</span> : "—"}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Total parciales</td>
                    {compared.map((r) => (
                      <td key={r.id}>{r.splits.length} parciales</td>
                    ))}
                  </tr>

                  {splitNames.length > 0 && (
                    <>
                      <tr className="table-section-title">
                        <td colSpan={compared.length + 1}>DESGLOSE POR PARCIALES</td>
                      </tr>
                      {splitNames.map((splitName, idx) => {
                        const times = compared.map((race) => {
                          const found = race.splits.find((s) => s.name === splitName) || race.splits[idx];
                          return found ? found.seconds : null;
                        });

                        const validTimes = times.filter((t): t is number => t !== null && t > 0);
                        const minTime = validTimes.length > 0 ? Math.min(...validTimes) : null;

                        return (
                          <tr key={splitName}>
                            <td>
                              <div className="split-name-cell">
                                <span className="split-idx">{String(idx + 1).padStart(2, "0")}</span>
                                <strong>{splitName}</strong>
                              </div>
                            </td>
                            {compared.map((race, raceIdx) => {
                              const found = race.splits.find((s) => s.name === splitName) || race.splits[raceIdx];
                              if (!found || !found.seconds) return <td key={race.id}>—</td>;

                              const isFastest = minTime !== null && found.seconds === minTime && validTimes.length > 1;
                              const diff = minTime !== null && found.seconds > minTime ? found.seconds - minTime : 0;

                              return (
                                <td key={race.id}>
                                  <div className="split-compare-cell">
                                    <span className={isFastest ? "split-time fastest" : "split-time"}>
                                      {time(found.seconds)}
                                    </span>
                                    {isFastest && <span className="fastest-pill">⚡ Rápidos</span>}
                                    {diff > 0 && <span className="diff-pill">+{time(diff)}</span>}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {evolutionRaces.length > 0 && (
          <section className="evolution">
            <div className="section-head"><div><p className="eyebrow">EVOLUCIÓN</p><h2>Tu progreso</h2></div><p className="hint">{referenceParticipant ? `Solo ${referenceParticipant}` : "Marca una PB para identificar tus carreras"}</p></div>
            <div className="chart-card">
              <svg className="evolution-chart" viewBox="0 0 700 240" role="img" aria-label="Evolución del tiempo total de las carreras">
                <line x1="35" y1="35" x2="665" y2="35" className="chart-grid-line" />
                <line x1="35" y1="110" x2="665" y2="110" className="chart-grid-line" />
                <line x1="35" y1="185" x2="665" y2="185" className="chart-grid-line" />
                <polyline points={evolutionPoints.map((point) => `${point.x},${point.y}`).join(" ")} className="chart-line" />
                {evolutionPoints.map((point) => (
                  <g key={point.race.id}>
                    <circle cx={point.x} cy={point.y} r="6" className={point.race.isPB ? "chart-point pb-point" : "chart-point"} />
                    <text x={point.x} y="215" textAnchor="middle" className="chart-label">{dateLabel(point.race.eventDate).replace(" de ", " ")}</text>
                    <text x={point.x} y={point.y - 12} textAnchor="middle" className="chart-value">{time(point.race.totalSeconds)}</text>
                  </g>
                ))}
              </svg>
            </div>
          </section>
        )}
      </section>

      {helpOpen && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setHelpOpen(false)}>
          <section className="modal help-modal">
            <button className="close" onClick={() => setHelpOpen(false)}>×</button>
            <p className="eyebrow">GUÍA RÁPIDA</p>
            <h2>Cómo usar DekaLab</h2>
            <p className="modal-lead">Organiza tus resultados de DEKA, compara carreras y descubre dónde puedes mejorar.</p>
            <div className="help-grid">
              <div><span className="help-number">01</span><h3>Añade una carrera</h3><p>Importa un enlace público de Race Result, revisa los datos y guarda el resultado.</p></div>
              <div><span className="help-number">02</span><h3>Identifica tu PB</h3><p>Marca una carrera como mejor marca personal para que la gráfica filtre tus resultados por participante.</p></div>
              <div><span className="help-number">03</span><h3>Compara resultados</h3><p>Selecciona dos o más carreras con el checkbox para comparar tiempos, penalizaciones y parciales.</p></div>
              <div><span className="help-number">04</span><h3>Analiza tu progreso</h3><p>Consulta la evolución de tus tiempos en el gráfico y añade notas personales a cada carrera.</p></div>
              <div><span className="help-number">05</span><h3>Organiza el listado</h3><p>Filtra por modalidad, ordena por fecha, tiempo o nombre y cambia entre cuadrícula y lista.</p></div>
              <div><span className="help-number">06</span><h3>Guarda una copia</h3><p>Descarga tus carreras en JSON para conservarlas o recuperarlas desde otro navegador.</p></div>
            </div>
            <div className="help-tip"><strong>Consejo:</strong> marca como PB una carrera tuya con el nombre de participante correcto. DekaLab usará ese nombre para separar tus carreras de las de otros participantes.</div>
          </section>
        </div>
      )}

      {modal === "add" && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && closeModal()}>
          <section className="modal">
            <button className="close" onClick={closeModal}>×</button>
            <p className="eyebrow">NUEVO RESULTADO</p><h2>Añadir carrera</h2>
            <p className="modal-lead">Pega el enlace público de Race Result. Podrás revisar los datos antes de guardarlos.</p>
            <label>Enlace de Race Result</label>
            <div className="url-row"><input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://my.raceresult.com/..." /><button onClick={importRace} disabled={loading}>{loading ? "Leyendo…" : "Leer enlace"}</button></div>
            
            <details className="url-guide">
              <summary>💡 ¿Cómo obtener el enlace de tu carrera en DEKA / Race Result?</summary>
              <ol className="guide-steps">
                <li>Busca tu nombre o dorsal en la página de resultados del evento <strong>DEKA</strong>.</li>
                <li>Haz clic sobre tu resultado para abrir tu ficha de tiempos.</li>
                <li>Pulsa en el botón <strong>Compartir</strong> (icono de red o enlace).</li>
                <li>Copia la dirección URL que aparece (ejemplo: <code>https://my.raceresult.com/410443/details1?pid=1131</code>) y pégala en la casilla superior.</li>
              </ol>
            </details>

            {error && <div className="error">{error}</div>}
            {draft && (
              <>
                <div className="form-grid">
                  <label>Nombre del evento<input value={draft.eventName || ""} onChange={(e) => setDraft({ ...draft, eventName: e.target.value })} /></label>
                  <label>Fecha<input type="date" value={draft.eventDate || ""} onChange={(e) => setDraft({ ...draft, eventDate: e.target.value })} /></label>
                  <label>Modalidad<input value={draft.format || ""} onChange={(e) => setDraft({ ...draft, format: e.target.value })} /></label>
                  <label>Tiempo total<input value={time(draft.totalSeconds)} readOnly /></label>
                  <label>Categoría<input value={draft.category || ""} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></label>
                  <label>Dorsal<input value={draft.bib || ""} onChange={(e) => setDraft({ ...draft, bib: e.target.value })} /></label>
                </div>
                <label className="notes-field">Notas personales<textarea value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="¿Qué aprendiste en esta carrera?" rows={3} /></label>
                <div className="import-summary"><strong>{draft.splits?.length || 0} parciales detectados</strong><span>{draft.penaltySeconds ? `Penalización: +${time(draft.penaltySeconds)} · ${draft.penaltyNote || ""}` : "Sin penalizaciones detectadas"}</span></div>
                <button className="save" onClick={saveRace}>Guardar carrera y parciales</button>
              </>
            )}
          </section>
        </div>
      )}

      {modal === "detail" && selected && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setModal(null)}>
          <section className="modal detail">
            <button className="close" onClick={() => setModal(null)}>×</button>
            <p className="eyebrow">{dateLabel(selected.eventDate)}</p><h2>{selected.eventName}</h2>
            <div className="detail-summary"><div><span>Tiempo oficial</span><strong>{time(selected.totalSeconds)}</strong></div><div><span>Parciales</span><strong>{selected.splits.length}</strong></div><div><span>Penalización</span><strong>{selected.penaltySeconds ? `+${time(selected.penaltySeconds)}` : "—"}</strong></div></div>
            {selected.penaltyNote && <div className="penalty"><strong>Penalización</strong><span>{selected.penaltyNote}</span><b>+{time(selected.penaltySeconds)}</b></div>}
            <label className="notes-field detail-notes">Notas personales<textarea value={selected.notes || ""} onChange={(e) => updateRaceNotes(selected.id, e.target.value)} placeholder="Añade sensaciones, estrategia o cosas a mejorar" rows={4} /></label>
            <h3 className="split-title">Detalle de parciales</h3>
            <div className="splits">
              {selected.splits.map((split, i) => {
                const cumulative = selected.splits.slice(0, i + 1).reduce((sum, item) => sum + item.seconds, 0);
                return <div className="split" key={`${split.name}-${i}`}><span className="num">{String(i + 1).padStart(2, "0")}</span><strong>{split.name}</strong><span>{time(split.seconds)}</span><b>{time(cumulative)}</b></div>;
              })}
            </div>
            <div className="detail-actions">
              {selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noreferrer">Ver resultado original ↗</a>}
              <button className="danger" onClick={() => deleteRace(selected)}>Eliminar carrera</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
