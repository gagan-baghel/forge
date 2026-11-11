// Hairline under the nav once the page has moved.
const nav = document.getElementById("nav");
const onScroll = () => nav.classList.toggle("stuck", scrollY > 8);
onScroll();
addEventListener("scroll", onScroll, { passive: true });

// Download buttons go straight to the newest DMG with its real version.
// If GitHub can't be reached they keep pointing at the Releases page.
fetch("https://api.github.com/repos/gagan-baghel/forge/releases/latest", { headers: { Accept: "application/vnd.github+json" } })
  .then((r) => (r.ok ? r.json() : null))
  .then((rel) => {
    if (!rel) return;
    const dmg = (rel.assets || []).find((a) => /\.dmg$/i.test(a.name));
    if (dmg) document.querySelectorAll("[data-download]").forEach((a) => (a.href = dmg.browser_download_url));
    const v = String(rel.tag_name || "").replace(/^v/, "");
    if (v) {
      document.querySelectorAll("[data-version-short]").forEach((el) => (el.textContent = `v${v}`));
      document.querySelectorAll("[data-version]").forEach((el) => (el.textContent = `Version ${v}`));
      document.querySelectorAll("[data-version-label]").forEach((el) => (el.textContent = `Forge ${v}`));
    }
  })
  .catch(() => {});

// Small scripted scenes. Each runs only while it is on screen and stops the
// moment it scrolls away; with reduced motion they sit in a finished state.
(function () {
  const $ = (q, el = document) => el.querySelector(q);
  const $$ = (q, el = document) => [...el.querySelectorAll(q)];
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function whileVisible(el, scene, threshold = 0.35) {
    if (!el || still) return;
    let run = 0;
    new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return void run++;
      const id = ++run, alive = () => id === run;
      (async () => { while (alive()) await scene(alive); })();
    }, { threshold }).observe(el);
  }
  function liveWhileVisible(el, cls = "live") {
    if (!el || still) return;
    new IntersectionObserver(([e]) => el.classList.toggle(cls, e.isIntersecting), { threshold: 0.2 }).observe(el);
  }
  function onceVisible(el, cls) {
    if (!el || still) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add(cls); io.disconnect(); } }, { threshold: 0.5 });
    io.observe(el);
  }
  async function type(el, text, alive, speed = 24) {
    el.textContent = "";
    for (const ch of text) {
      if (!alive()) return false;
      el.textContent += ch;
      await wait(speed + Math.random() * 26);
    }
    return true;
  }

  /* Principles */
  liveWhileVisible($(".fig-local"));
  liveWhileVisible($(".fig-pack"));
  onceVisible($(".fig-gauge"), "go");

  /* Approval prompt: a real command, typed out, then allowed. */
  const ap = $("#v-approve");
  const COMMANDS = [
    ["in ~/code/forge · asks every time", "git status --short && pnpm test", "✓ exit 0 · 1.8s"],
    ["in ~/Downloads · asks every time", "mv ~/Downloads/*.pdf ~/Documents/Invoices/", "✓ moved 6 files"],
    ["on your screen · asks every time", "open -a Figma ~/Design/dashboard.fig", "✓ opened"],
  ];
  let ci = 0;
  whileVisible(ap, async (alive) => {
    const [ctx, cmd, res] = COMMANDS[ci++ % COMMANDS.length];
    const out = $(".res", ap), allow = $(".allow", ap);
    $(".ctx", ap).textContent = ctx;
    out.classList.remove("on");
    ap.classList.add("typing-on");
    const typed = await type($(".cmd", ap), cmd, alive);
    ap.classList.remove("typing-on");
    if (!typed) return;
    await wait(900);
    if (!alive()) return;
    allow.classList.add("press");
    await wait(320);
    allow.classList.remove("press");
    out.textContent = res;
    out.classList.add("on");
    await wait(2800);
  });

  /* Knowledge: a question, a scan, the passage that answers it. */
  const kn = $("#v-know");
  const QUESTIONS = [
    ["How long do refunds take?", 0, "p.4 · 0.82"],
    ["How do we answer an angry customer?", 1, "§3 · 0.77"],
    ["Which region sold most in Q3?", 2, "row 214 · 0.71"],
  ];
  let qi = 0;
  if (kn && still) { $$(".docs .row", kn)[0].classList.add("hit"); $(".score", kn).textContent = QUESTIONS[0][2]; }
  whileVisible(kn, async (alive) => {
    const [q, row, score] = QUESTIONS[qi++ % QUESTIONS.length];
    const rows = $$(".docs .row", kn), bar = $(".qbar", kn), scan = $(".scan", kn);
    rows.forEach((r) => r.classList.remove("hit"));
    bar.classList.add("typing-on");
    const typed = await type($(".qtext", kn), q, alive, 30);
    bar.classList.remove("typing-on");
    if (!typed) return;
    scan.classList.remove("go");
    void scan.offsetWidth;
    scan.classList.add("go");
    await wait(900);
    if (!alive()) return;
    $(".score", rows[row]).textContent = score;
    rows[row].classList.add("hit");
    await wait(3200);
  });

  /* Phone: ask, approve on the phone, get the file. */
  const ph = $("#v-phone");
  if (ph && !still) ph.classList.add("scene");
  const show = (b) => { b.classList.remove("gone"); void b.offsetWidth; b.classList.remove("hide"); };
  whileVisible(ph, async (alive) => {
    const [me, typing, ask, it, file] = $$(".chat .b", ph);
    const approve = $(".approve", ask);
    [me, ask, it, file].forEach((b) => b.classList.add("hide", "gone"));
    typing.classList.remove("show");
    approve.classList.remove("press");
    const steps = [
      [500, () => show(me)],
      [900, () => typing.classList.add("show")],
      [1300, () => { typing.classList.remove("show"); show(ask); }],
      [1600, () => approve.classList.add("press")],
      [800, () => { typing.classList.add("show"); }],
      [900, () => { typing.classList.remove("show"); show(it); }],
      [700, () => show(file)],
      [3800, () => {}],
    ];
    for (const [ms, fn] of steps) { await wait(ms); if (!alive()) return; fn(); }
  }, 0.45);

  /* Schedules: a playhead crosses the day; routines light as it passes. */
  const sch = $("#w-sched");
  if (sch) {
    const head = $(".head", sch);
    const jobs = $$(".job", sch).map((j) => [j, parseFloat(j.style.getPropertyValue("--at"))]);
    const at = (t) => { head.style.setProperty("--t", `${t}%`); jobs.forEach(([j, p]) => j.classList.toggle("done", t >= p)); };
    at(still ? 62 : 0);
    whileVisible(sch, async (alive) => {
      for (let t = 0; t <= 100; t += 0.5) { if (!alive()) return; at(t); await wait(45); }
      await wait(1400);
    });
  }

  /* Updates: offer, download, verify, restart. */
  const upd = $("#w-update");
  whileVisible(upd, async (alive) => {
    const btn = $(".upd-btn", upd), label = $(".upd-t", upd), bar = $(".upd-bar i", upd), note = $(".upd-s", upd);
    btn.classList.remove("ok");
    label.textContent = "Update to v1.0.2";
    note.textContent = "signed · verified · one click";
    bar.style.setProperty("--p", "0%");
    await wait(1500);
    if (!alive()) return;
    label.textContent = "Downloading…";
    for (let p = 0; p <= 100; p += 4) { if (!alive()) return; bar.style.setProperty("--p", `${p}%`); await wait(70); }
    note.textContent = "signature ok";
    label.textContent = "Restarting…";
    await wait(1100);
    if (!alive()) return;
    btn.classList.add("ok");
    label.textContent = "Up to date · v1.0.2";
    note.textContent = "installed";
    await wait(2800);
  });

  /* Skills switch on one by one. */
  const sk = $("#w-skills");
  if (sk && still) $$(".skills i", sk).forEach((i) => i.classList.add("on"));
  whileVisible(sk, async (alive) => {
    const items = $$(".skills i", sk);
    items.forEach((i) => i.classList.remove("on"));
    await wait(500);
    for (const i of items) { if (!alive()) return; i.classList.add("on"); await wait(240); }
    await wait(2800);
  });

  /* Models: the selector steps through the family. */
  const md = $("#w-models");
  if (md) {
    const seg = $(".seg", md), opts = $$(".seg span", md);
    const pick = (i) => { seg.style.setProperty("--i", i); opts.forEach((o, j) => o.classList.toggle("on", j === i)); };
    pick(0);
    whileVisible(md, async (alive) => {
      for (let i = 0; i < opts.length; i++) { await wait(1700); if (!alive()) return; pick((i + 1) % opts.length); }
    });
  }

  /* Activity: bars grow in. */
  const act = $("#w-act");
  if (act) {
    const H = [28, 42, 35, 58, 50, 66, 44, 62, 55, 78, 60, 72, 86, 96];
    $(".bars", act).innerHTML = H.map((h, i) => `<i style="--h:${h}%;transition-delay:${i * 40}ms"></i>`).join("");
    liveWhileVisible(act);
  }

  /* Closing ring turns slowly while on screen. */
  liveWhileVisible($(".closer"));
})();

// Feature dial. One notch every few seconds; hover, keyboard focus or the
// pause button stops it, and it never moves on its own for reduced motion.
(function () {
  const FEATURES = [
    ["Computer access", "Shell, files and clicks — every action asks first and shows exactly what it will do."],
    ["Documents & PDFs", "Drop in PDFs and notes; the passages that matter reach the agent before it answers."],
    ["Memory", "Facts an agent keeps across conversations. Write them yourself, or approve what it saves."],
    ["Phone remote", "Message your Mac from Telegram or Discord. Machine actions wait for your OK."],
    ["Shareable packs", "Agents, skills and knowledge in one .gap file. Send it; they install it."],
    ["Schedules", "Cron for agents: a morning digest or a Friday report, with nobody watching."],
    ["Web & Python", "Search that reads whole pages, and a Python sandbox for data and charts."],
    ["In-app updates", "New versions arrive as one button. Signed, verified, installed, restarted."],
  ];
  const wheel = document.getElementById("wheel");
  const dial = document.getElementById("dial");
  if (!wheel || getComputedStyle(wheel).display === "none") return;
  const panel = wheel.querySelector(".readout-panel");
  const count = document.getElementById("rp-count");
  const title = document.getElementById("rp-title");
  const text = document.getElementById("rp-text");
  const pauseBtn = document.getElementById("rp-pause");
  const N = FEATURES.length, STEP = 360 / N;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const spokes = FEATURES.map(([name], i) => {
    const s = document.createElement("div");
    s.className = "spoke";
    s.style.setProperty("--a", `${i * STEP}deg`);
    s.innerHTML = `<span class="pip"></span><button type="button"></button>`;
    const b = s.querySelector("button");
    b.textContent = name;
    b.addEventListener("click", () => go(i, true));
    dial.appendChild(s);
    return s;
  });

  let pos = 0; // cumulative notches turned; only ever grows or shrinks by the shortest way
  const active = () => ((pos % N) + N) % N;
  function render(animateText) {
    const k = active();
    dial.style.setProperty("--rot", `${-pos * STEP}deg`);
    spokes.forEach((s, i) => {
      const d = Math.abs(i - k), dist = Math.min(d, N - d);
      s.dataset.d = String(dist);
      const b = s.querySelector("button");
      b.setAttribute("aria-pressed", String(dist === 0));
      b.tabIndex = dist <= 2 ? 0 : -1; // only what's visible is reachable
    });
    const fill = () => {
      count.textContent = `${String(k + 1).padStart(2, "0")} / ${String(N).padStart(2, "0")}`;
      title.textContent = FEATURES[k][0];
      text.textContent = FEATURES[k][1];
      panel.classList.remove("swap");
    };
    if (animateText && !still) { panel.classList.add("swap"); setTimeout(fill, 300); } else fill();
  }
  function go(i, byUser) {
    let d = (i - active() + N) % N;
    if (d > N / 2) d -= N;
    pos += d;
    if (byUser) setPaused(true);
    render(true);
  }

  let paused = still, hovering = false;
  function setPaused(p) {
    paused = p;
    pauseBtn.textContent = p ? "play" : "pause";
    pauseBtn.setAttribute("aria-label", p ? "Play the highlights" : "Pause the highlights");
  }
  setPaused(paused);
  pauseBtn.addEventListener("click", () => setPaused(!paused));
  wheel.addEventListener("mouseenter", () => (hovering = true));
  wheel.addEventListener("mouseleave", () => (hovering = false));
  wheel.addEventListener("focusin", () => (hovering = true));
  wheel.addEventListener("focusout", () => (hovering = false));
  setInterval(() => {
    if (!paused && !hovering && !document.hidden) { pos += 1; render(true); }
  }, 3400);
  render(false);
})();

// Sections fade in once. Adding .js arms the hidden state, so the page
// still renders if anything below throws.
document.documentElement.classList.add("js");
const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}, { rootMargin: "0px 0px -10% 0px" });
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
