import Link from "next/link";
import { AccountButton } from "@/components/account/AccountButton";
import { Finder } from "@/components/finder/Finder";
import { BoardStill } from "@/components/player/BoardStill";
import { attentionDemo } from "@/lib/scenes/demo-attention";
import "./home.css";

export default function Home() {
  return (
    <>
      <AccountButton />
      <div className="wrap">
        <header className="topbar">
          <Link href="/" className="wordmark">
            Paper Tutor
          </Link>
        </header>

        <section className="hero">
          <div className="hero-copy">
            <h1>Any research paper, explained at a whiteboard</h1>
            <p className="lede">
              Pick a paper and a tutor draws and talks you through it in about a minute. Then go deeper into any section,
              equation or figure, and ask questions as it goes.
            </p>
          </div>
          <Link href="/paper/1706.03762" className="hero-demo" aria-label="Watch the tutor explain Attention Is All You Need">
            <BoardStill list={attentionDemo} scene={3} theme="chalkboard" />
            <span className="hero-demo-label">
              <span className="hero-demo-play" aria-hidden>
                <svg viewBox="0 0 24 24">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
              </span>
              <span>
                Watch it explain Attention Is All You Need
              </span>
            </span>
          </Link>
        </section>

        <Finder />

        <footer className="foot">
          Made by{" "}
          <a href="https://www.instagram.com/_goatsan/" rel="noopener">
            @_goatsan
          </a>
          . Papers come from arXiv, Semantic Scholar and Hugging Face Daily Papers, or from your own PDF. The code is
          open source.
        </footer>
      </div>
    </>
  );
}
