"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PaperCard } from "@/lib/types";
import { CATEGORIES } from "@/lib/categories";
import { idToSlug, parseArxivId } from "@/lib/arxivId";
import { signInHref, useMe } from "@/lib/client/useMe";
import { PaperRow } from "../PaperRow";

// Find a paper: one box for arXiv search or a pasted arXiv link, a PDF upload, today's trending papers, and the
// newest papers by topic.

type View = { kind: "trending" } | { kind: "browse"; cat: string } | { kind: "search"; q: string };

const MAX_MB = 40;
const MAX_PAGES = 150;
const isLink = (t: string) => /^https?:\/\//i.test(t.trim());

export function Finder() {
  const router = useRouter();
  const me = useMe();
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>({ kind: "trending" });
  const [papers, setPapers] = useState<PaperCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setPapers(null);
    setError(null);
    const url =
      view.kind === "trending"
        ? "/api/trending"
        : view.kind === "browse"
          ? `/api/browse?cat=${encodeURIComponent(view.cat)}`
          : `/api/search?q=${encodeURIComponent(view.q)}`;
    fetch(url)
      .then(async (r) => {
        const d = await r.json();
        if (!live) return;
        if (!r.ok) throw new Error(d.error ?? "The list couldn't load.");
        if (d.open) router.push(`/paper/${idToSlug(d.open)}`);
        setPapers(d.papers);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [view, router]);

  const [linkError, setLinkError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  // Any other https link is read as a PDF (private to the person who opened it).
  const openLink = async (url: string) => {
    setLinkError(null);
    if (me === null) {
      location.assign(signInHref());
      return;
    }
    setOpening(true);
    try {
      const r = await fetch("/api/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "That link couldn't be opened.");
      router.push(`/paper/${d.id}`);
    } catch (err) {
      setLinkError((err as Error).message);
      setOpening(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    const id = parseArxivId(text);
    if (id) router.push(`/paper/${idToSlug(id)}`);
    else if (isLink(text)) void openLink(text);
    else setView({ kind: "search", q: text });
  };

  const pickFile = () => {
    setUploadError(null);
    if (me === null) {
      location.assign(signInHref("upload"));
      return;
    }
    fileInput.current?.click();
  };

  // Back from sign-in with ?after=upload: open the file picker straight away is blocked by browsers, so just
  // point at the button.
  const [nudge, setNudge] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("after") === "upload") setNudge(true);
  }, []);

  const upload = async (file: File) => {
    if (file.size > MAX_MB * 1024 * 1024) {
      setUploadError(`PDFs can be up to ${MAX_MB} MB.`);
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "The upload failed.");
      router.push(`/paper/${d.id}`);
    } catch (e) {
      setUploadError((e as Error).message);
      setUploading(false);
    }
  };

  const heading =
    view.kind === "trending"
      ? "Trending today"
      : view.kind === "browse"
        ? `Newest in ${CATEGORIES.find((c) => c.id === view.cat)?.label ?? view.cat}`
        : `Results for “${view.q}”`;

  return (
    <section className="finder" aria-label="Find a paper">
      <form className="search" onSubmit={submit} role="search">
        <label htmlFor="q" className="visually-hidden">
          Search papers, or paste an arXiv or PDF link
        </label>
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5L21 21" />
        </svg>
        <input
          id="q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search, or paste a link"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-pen" disabled={opening}>
          {opening ? "Opening…" : parseArxivId(q) || isLink(q) ? "Open" : "Search"}
        </button>
      </form>

      <div className="upload-line">
        <button type="button" className={`link-btn ${nudge ? "is-nudged" : ""}`} onClick={pickFile} disabled={uploading}>
          {uploading ? "Uploading…" : "Upload a PDF"}
        </button>
        <span className="upload-hint">
          Up to {MAX_MB} MB and {MAX_PAGES} pages. Papers you upload or open from a link are visible only to you.
        </span>
        <input
          ref={fileInput}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
        {uploadError ? <p className="error upload-error">{uploadError}</p> : null}
        {linkError ? <p className="error upload-error">{linkError}</p> : null}
      </div>

      <nav className="tabs" aria-label="Lists">
        <button type="button" className="tab" aria-pressed={view.kind === "trending"} onClick={() => setView({ kind: "trending" })}>
          Trending
        </button>
        {CATEGORIES.map((c) => (
          <button
            type="button"
            key={c.id}
            className="tab"
            aria-pressed={view.kind === "browse" && view.cat === c.id}
            onClick={() => setView({ kind: "browse", cat: c.id })}
          >
            {c.label}
          </button>
        ))}
      </nav>

      <h2 className="list-heading">{heading}</h2>
      {error ? (
        <p className="error">
          {error}{" "}
          <button type="button" className="link-btn" onClick={() => setView({ ...view })}>
            Try again
          </button>
        </p>
      ) : papers === null ? (
        <ul className="rows is-loading" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="row row-ghost" />
          ))}
        </ul>
      ) : papers.length === 0 ? (
        <div className="empty">
          <p>No papers matched “{view.kind === "search" ? view.q : ""}”.</p>
          <p>
            If it&apos;s a whitepaper or a lab report, it may not be on arXiv. Paste the PDF link into the box above and
            it opens here, visible only to you.
          </p>
        </div>
      ) : (
        <>
          <ul className="rows">
            {papers.map((p) => (
              <PaperRow key={p.id} paper={p} onOpenPdf={(u) => void openLink(u)} />
            ))}
          </ul>
          {view.kind === "search" ? <p className="list-foot">Not here? Paste the paper&apos;s PDF link into the box above.</p> : null}
        </>
      )}
    </section>
  );
}
