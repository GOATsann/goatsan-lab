// A made-up paper for the end-to-end tests. Every API the paper page calls is stubbed with this data, so the
// suite needs no AI, no voice spend and no network, and gives the same result every run.

export const PAPER_ID = "2401.00001";

export const meta = {
  id: PAPER_ID,
  source: "arxiv",
  title: "Testing Tutors: A Paper That Exists Only for the Test Suite",
  authors: ["Ada Tester", "Bob Checker"],
  abstract: "We describe a paper used only to test the whiteboard player. It has three sections, one equation and one figure.",
  published: "2024-01-02T00:00:00Z",
  categories: ["cs.LG"],
};

export const ingest = {
  id: PAPER_ID,
  via: "latex",
  chars: 1000,
  figures: [{ id: "fig1", caption: "A test pattern standing in for a figure.", width: 800, height: 450 }],
  ingestedAt: "2024-01-02T00:00:00Z",
};

export const structure = {
  paperType: "ai-systems",
  theme: "diagram",
  oneLine: "A paper used to test the tutor.",
  sections: [
    { id: "intro", title: "Introduction", level: 1, summary: "Why tests matter. They catch bugs before people do." },
    { id: "method", title: "Method", level: 1, summary: "How the tests run. Every control is checked in every state." },
    { id: "results", title: "Results", level: 1, summary: "What the tests found. Fewer surprises on phones." },
  ],
  claims: [{ text: "Tests catch bugs.", section: "results" }],
  equations: [
    {
      id: "eq1",
      tex: "\\mathrm{bugs} = \\frac{\\mathrm{changes}}{\\mathrm{tests}}",
      meaning: "More tests mean fewer bugs per change.",
      section: "method",
      symbols: [{ tex: "\\mathrm{tests}", meaning: "how many checks run" }],
    },
  ],
  figures: [{ id: "fig1", caption: "Test pattern", explanation: "A stand-in figure.", section: "method" }],
  pronunciations: [],
  model: "fixture",
  createdAt: "2024-01-02T00:00:00Z",
};

const title = { t: "title", id: "title", text: "Testing Tutors", y: 300, size: 80, sub: "Ada Tester and others, 2024", s: 0 };

// Four scenes, each with two sentences, so there is always a "middle of a sentence" and a "between sentences".
export const overview = {
  theme: "diagram",
  scenes: [
    { say: "Testing Tutors, by Ada Tester and others. Here is the idea in about a minute.", draw: [title] },
    {
      say: "Bugs hide in controls. Each control has many states.",
      draw: [
        { t: "text", text: "The problem", x: 100, y: 60, size: 46, s: 0 },
        { t: "icon", name: "bug", x: 400, y: 450, size: 160, label: "bugs", s: 0 },
        { t: "icon", name: "gear", x: 1100, y: 450, size: 160, label: "controls", s: 1 },
      ],
      cite: ["intro"],
    },
    {
      say: "So every control is tested in every state. The formula is simple.",
      draw: [
        { t: "text", text: "The method", x: 100, y: 60, size: 46, s: 0 },
        { t: "equation", id: "eq", tex: "\\mathrm{bugs} = \\frac{\\term{c}{\\mathrm{changes}}}{\\term{t}{\\mathrm{tests}}}", x: 800, y: 400, size: 64, s: 0 },
        { t: "highlight", eq: "eq", term: "t", note: "more tests", s: 1 },
      ],
      cite: ["method"],
    },
    {
      say: "Fewer surprises reach phones. That is the result.",
      draw: [
        { t: "text", text: "The result", x: 100, y: 60, size: 46, s: 0 },
        { t: "plot", kind: "bar", x: 120, y: 200, w: 900, h: 560, labels: ["Before", "After"], values: [12, 2], highlight: 1, ylabel: "Bugs", s: 0 },
      ],
      cite: ["results"],
    },
  ],
  model: "fixture",
  createdAt: "2024-01-02T00:00:00Z",
};

export const answerScenes = [
  {
    say: "Here is how the tests work. They press every button.",
    draw: [
      { t: "text", text: "Answer", x: 100, y: 60, size: 46, s: 0 },
      { t: "box", x: 300, y: 350, w: 300, h: 120, text: "press", s: 0 },
      { t: "box", x: 900, y: 350, w: 300, h: 120, text: "check", s: 1 },
    ],
    cite: ["method"],
  },
  {
    say: "Then they check the result. That is all.",
    draw: [{ t: "icon", name: "check", x: 800, y: 450, size: 200, s: 0 }],
    cite: ["method"],
  },
];

export const deepDiveScenes = [
  { say: "The method has two steps. First, press.", draw: [{ t: "text", text: "Step one", x: 100, y: 60, size: 46, s: 0 }] },
  { say: "Second, check. Done.", draw: [{ t: "text", text: "Step two", x: 100, y: 60, size: 46, s: 0 }] },
];
