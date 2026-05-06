/* SkillTestBench project page — runtime
 *
 * Behaviour:
 *   - Lookup-first hero: type a skill name, see autocomplete, hit enter.
 *   - The verdict card under the hero is the page's main element. It shows
 *     two-axis verdict pills (Effectiveness + Safety), three big metric
 *     tiles, and a tabbed evidence panel.
 *   - Distribution histograms + interactive explorer below.
 *   - Default-load 'docx' on first paint so the page is alive immediately.
 */
(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

  const DEFAULT_SKILL = "docx";

  /* ----------------------------------------------------- helpers */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class")        node.className = attrs[k];
        else if (k === "html")    node.innerHTML = attrs[k];
        else if (k === "text")    node.textContent = attrs[k];
        else if (k === "style")   node.setAttribute("style", attrs[k]);
        else if (k === "data") {
          Object.keys(attrs.data).forEach(function (dk) { node.dataset[dk] = attrs.data[dk]; });
        } else if (typeof attrs[k] === "boolean") {
          if (attrs[k]) node.setAttribute(k, "");
        } else {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c == null) return;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  function fmtPercentPP(v, digits) {
    if (v == null || isNaN(v)) return "—";
    const sign = v > 0 ? "+" : "";
    return sign + (v * 100).toFixed(digits == null ? 1 : digits);
  }

  function fmtFraction(v, digits) {
    if (v == null || isNaN(v)) return "—";
    return v.toFixed(digits == null ? 2 : digits);
  }

  function categoryLabel(id) {
    if (!id) return "—";
    return id.split("-").map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); }).join(" ");
  }

  function loadJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("fetch " + url + " => " + r.status);
      return r.json();
    });
  }

  /* ------------------------------------------------- 1. verdict tiers */

  function effectivenessTier(g) {
    if (g == null || isNaN(g))    return { tone: "neutral", word: "Unknown",      desc: "no measurement" };
    if (g >= 0.20)                return { tone: "good",    word: "High gain",    desc: "+" + (g * 100).toFixed(0) + " pp over baseline" };
    if (g >= 0.05)                return { tone: "good",    word: "Modest gain",  desc: "+" + (g * 100).toFixed(0) + " pp over baseline" };
    if (g > 0)                    return { tone: "warn",    word: "Marginal",     desc: "+" + (g * 100).toFixed(1) + " pp" };
    if (g === 0)                  return { tone: "neutral", word: "No gain",      desc: "matches baseline" };
    return { tone: "bad", word: "Regression", desc: (g * 100).toFixed(1) + " pp" };
  }
  function safetyTier(s, findings) {
    if (s == null) return { tone: "neutral", word: "Untested", desc: "no scan" };
    const triggered = (findings || []).filter(function (f) { return f.risk_triggered === true; }).length;
    if (s >= 95)                  return { tone: "good", word: "Clean",          desc: "no triggered risk" };
    if (s >= 80 && triggered === 0) return { tone: "good", word: "Low risk",     desc: "static-only findings" };
    if (s >= 65)                  return { tone: "warn", word: "Use carefully", desc: triggered + " confirmed trigger" + (triggered === 1 ? "" : "s") };
    if (s >= 40)                  return { tone: "bad",  word: "High risk",     desc: triggered + " confirmed trigger" + (triggered === 1 ? "" : "s") };
    return { tone: "bad", word: "Do not install", desc: triggered + " confirmed exploit" + (triggered === 1 ? "" : "s") };
  }
  function metricTone(tier) { return tier.tone; }

  /* ------------------------------------------------- 2. verdict card render */

  function renderVerdict(detail) {
    const card = document.getElementById("verdict-card");
    if (!card) return;
    card.dataset.state = "loaded";

    const u = detail.utility || {};
    const s = detail.safety || {};

    const effTier = effectivenessTier(u.pass_rate_gain);
    const safTier = safetyTier(s.score, s.findings);

    card.innerHTML = "";

    // ---- HEAD ----
    const head = el("div", { class: "verdict-head fade-in" });
    head.appendChild(el("div", { class: "who" }, [
      el("h2", null, detail.name),
      el("div", { class: "meta" }, [
        el("span", null, [document.createTextNode("owner "), el("b", null, detail.owner || "—")]),
        el("span", null, [document.createTextNode("category "), el("b", null, categoryLabel(detail.category))]),
        el("span", null, [document.createTextNode("scenarios "), el("b", null, String((u.scenarios || []).length))]),
      ]),
    ]));
    head.appendChild(el("div", { class: "verdict-pills" }, [
      pillEl("Effectiveness", effTier),
      pillEl("Safety", safTier),
    ]));
    card.appendChild(head);

    // ---- METRICS ----
    const metrics = el("div", { class: "verdict-metrics fade-in" }, [
      metricTile(
        "Effectiveness gain",
        fmtPercentPP(u.pass_rate_gain),
        "pp",
        metricTone(effTier),
        u.total_items != null ? "wi  " + (u.wi_passed_items || 0) + "  /  wo  " + (u.wo_passed_items || 0) + "   ·  " + u.total_items + " items" : ""
      ),
      metricTile(
        "Efficiency",
        u.efficiency_score == null ? "—" : fmtFraction(u.efficiency_score, 2),
        null,
        u.efficiency_score == null ? "neutral" : (u.efficiency_score >= 0.30 ? "good" : (u.efficiency_score > 0 ? "warn" : "neutral")),
        "from time + token savings"
      ),
      metricTile(
        "Safety",
        s.score == null ? "—" : Number(s.score).toFixed(1),
        "/100",
        metricTone(safTier),
        (s.findings || []).length === 0 ? "no findings" : (s.findings || []).length + " findings  ·  " + (s.findings || []).filter(function (f) { return f.risk_triggered === true; }).length + " triggered"
      ),
    ]);
    card.appendChild(metrics);

    // ---- TABS ----
    const tabsRow = el("div", { class: "verdict-tabs", role: "tablist" });
    const tabs = [
      { id: "summary",  label: "Summary" },
      { id: "wiwo",     label: "wi vs wo", count: (u.scenarios || []).length },
      { id: "judge",    label: "Judge evidence", count: (u.judge_scenarios || []).reduce(function (n, s) { return n + ((s.items || []).length); }, 0) },
      { id: "findings", label: "Security findings", count: (s.findings || []).length },
    ];
    tabs.forEach(function (t, i) {
      const btn = el("button", {
        class: "verdict-tab" + (i === 0 ? " is-active" : ""),
        type: "button",
        role: "tab",
        "data-tab": t.id,
      }, [document.createTextNode(t.label), t.count != null ? el("span", { class: "ct" }, String(t.count)) : null]);
      tabsRow.appendChild(btn);
    });
    card.appendChild(tabsRow);

    // ---- PANES ----
    const panes = el("div", { class: "verdict-panes fade-in" });

    // SUMMARY
    panes.appendChild(paneSummary(detail, effTier, safTier));
    // WI vs WO
    panes.appendChild(paneWiWo(detail));
    // JUDGE
    panes.appendChild(paneJudge(detail));
    // FINDINGS
    panes.appendChild(paneFindings(detail));

    card.appendChild(panes);

    // tab switching
    tabsRow.addEventListener("click", function (e) {
      const t = e.target.closest(".verdict-tab");
      if (!t) return;
      $$(".verdict-tab", card).forEach(function (b) { b.classList.toggle("is-active", b === t); });
      const id = t.dataset.tab;
      $$(".verdict-pane", card).forEach(function (p) { p.classList.toggle("hidden", p.dataset.tab !== id); });
    });

    // initial visibility — show only summary
    $$(".verdict-pane", card).forEach(function (p, i) { p.classList.toggle("hidden", i !== 0); });
  }

  function pillEl(label, tier) {
    return el("div", { class: "verdict-pill tone-" + tier.tone }, [
      el("span", { class: "lab" }, label),
      el("span", { class: "word" }, tier.word),
      el("span", { class: "desc" }, tier.desc),
    ]);
  }

  function metricTile(lbl, val, unit, tone, delta) {
    return el("div", { class: "metric-tile tone-" + tone }, [
      el("span", { class: "lbl" }, lbl),
      el("span", { class: "val" }, [
        document.createTextNode(val),
        unit ? el("span", { class: "unit" }, unit) : null,
      ]),
      delta ? el("span", { class: "delta" }, delta) : null,
    ]);
  }

  /* ----- panes ----- */

  function paneSummary(detail, effTier, safTier) {
    const u = detail.utility || {};
    const s = detail.safety || {};

    const wrap = el("div", { class: "verdict-pane", "data-tab": "summary" });
    const inner = el("div", { class: "verdict-summary" });

    const totalItems = u.total_items || 0;
    const wi = u.wi_passed_items || 0;
    const wo = u.wo_passed_items || 0;
    const findings = s.findings || [];
    const triggered = findings.filter(function (f) { return f.risk_triggered === true; }).length;

    let lead;
    if (effTier.tone === "good" && safTier.tone === "good") {
      lead = "This skill measurably improves task completion AND introduces no triggered risks. A safe adoption.";
    } else if (effTier.tone === "good" && safTier.tone !== "good") {
      lead = "This skill measurably improves task completion BUT introduces real, dynamically-confirmed risks. Adopt with sandboxing.";
    } else if (effTier.tone !== "good" && safTier.tone === "good") {
      lead = "This skill is safe to install but does not measurably improve task completion above the no-skill baseline.";
    } else {
      lead = "This skill neither improves task completion nor passes the safety evaluation cleanly.";
    }
    inner.appendChild(el("p", { class: "verdict-summary-lead", style: "font-family: var(--serif); font-size: 22px; line-height: 1.35; color: var(--ink); letter-spacing: -0.015em;" }, lead));

    inner.appendChild(el("p", null,
      "The agent passed " + wi + " of " + totalItems + " judge items with the skill mounted, and " +
      wo + " of " + totalItems + " without — across " + ((u.scenarios || []).length) + " scenarios. " +
      "The security judge produced " + findings.length + " finding" + (findings.length === 1 ? "" : "s") +
      ", of which " + triggered + " " + (triggered === 1 ? "was" : "were") + " confirmed end-to-end triggered."
    ));

    if ((u.scenarios || []).length) {
      const scenRow = el("div", { class: "scenarios-mini" });
      (u.scenarios || []).forEach(function (sc) {
        if (sc.valid) {
          scenRow.appendChild(el("div", { class: "scenario-cell" }, [
            el("span", { class: "lab" }, sc.id + " · valid"),
            el("span", { class: "val" }, sc.pass_rate_gain == null ? "—" : ((sc.pass_rate_gain >= 0 ? "+" : "") + (sc.pass_rate_gain * 100).toFixed(1) + " pp")),
            el("span", { class: "sub" }, "wi " + sc.wi_passed + " / wo " + sc.wo_passed + " of " + sc.total_items),
          ]));
        } else {
          scenRow.appendChild(el("div", { class: "scenario-cell invalid" }, [
            el("span", { class: "lab" }, sc.id + " · skipped"),
            el("span", { class: "val" }, "invalid"),
            el("span", { class: "sub" }, ((sc.invalid_reason || "—").split(":")[0])),
          ]));
        }
      });
      inner.appendChild(scenRow);
    }

    const reading = el("div", { class: "reading" });
    reading.appendChild(document.createTextNode("How to read this card: "));
    reading.appendChild(el("strong", null, "effectiveness"));
    reading.appendChild(document.createTextNode(" and "));
    reading.appendChild(el("strong", null, "safety"));
    reading.appendChild(document.createTextNode(" are reported as two independent axes — by design, never combined into a single number. A skill can be highly effective and unsafe; a safe skill can have zero gain. The two pills above tell you each separately."));
    inner.appendChild(reading);

    wrap.appendChild(inner);
    return wrap;
  }

  function paneWiWo(detail) {
    const u = detail.utility || {};
    const wrap = el("div", { class: "verdict-pane", "data-tab": "wiwo" });
    const block = el("div", { class: "wiwo-block" });

    block.appendChild(el("h4", null, "Paired execution: with skill vs without"));
    block.appendChild(el("p", null,
      "Every task is run twice — agent, task instance, and seed held fixed. The bars below show the absolute count of judge items the agent completed in each condition. The skill's effectiveness gain is the difference, divided by the total."
    ));

    const total = u.total_items || 0;
    const wi = u.wi_passed_items || 0;
    const wo = u.wo_passed_items || 0;
    const wiPct = total > 0 ? (wi / total * 100) : 0;
    const woPct = total > 0 ? (wo / total * 100) : 0;

    const bars = el("div", { class: "wiwo-bars" });
    bars.appendChild(barRow("WO", "wo", woPct, wo, total));
    bars.appendChild(barRow("WI", "wi", wiPct, wi, total));

    const gainPP = total > 0 ? ((wi - wo) / total * 100) : 0;
    const gainNote = el("p", { style: "margin-top: 14px; font-family: var(--mono); font-size: 12.5px; color: var(--ink-soft);" });
    gainNote.appendChild(document.createTextNode("Δ  "));
    const gainEm = el("strong", { style: "font-size: 16px; color: var(--teal-deep);" }, (gainPP > 0 ? "+" : "") + gainPP.toFixed(1) + " pp");
    gainNote.appendChild(gainEm);
    gainNote.appendChild(document.createTextNode("  attributable to the skill, not to the model."));
    bars.appendChild(gainNote);

    block.appendChild(bars);

    // Resource usage
    const wiTime = u.wi_avg_time_s, woTime = u.wo_avg_time_s;
    const wiTok = u.wi_avg_eff_tokens, woTok = u.wo_avg_eff_tokens;
    if (wiTime != null && woTime != null) {
      const res = el("div", { class: "wiwo-resource" });
      res.appendChild(resourceCell("Time per scenario (avg)", "wo", woTime != null ? woTime.toFixed(1) + " s" : "—",
                                                            "wi", wiTime != null ? wiTime.toFixed(1) + " s" : "—",
                                                            wiTime != null && woTime != null ? wiTime - woTime : null, "s"));
      res.appendChild(resourceCell("Effective tokens per scenario (avg)", "wo", woTok != null ? NUMBER_FORMAT.format(woTok) : "—",
                                                                          "wi", wiTok != null ? NUMBER_FORMAT.format(wiTok) : "—",
                                                                          wiTok != null && woTok != null ? wiTok - woTok : null, "tok"));
      block.appendChild(res);
    }

    wrap.appendChild(block);
    return wrap;
  }

  function barRow(label, mod, pct, num, total) {
    const fill = el("span", { class: "fill", "data-label": (Math.round(pct) + "%"), style: "width:" + Math.max(pct, 1) + "%;" });
    return el("div", { class: "wiwo-row " + mod }, [
      el("span", { class: "label" }, label),
      el("span", { class: "track" }, fill),
      el("span", { class: "num" }, [document.createTextNode(num + " / " + total), el("small", null, "judge items")]),
    ]);
  }

  function resourceCell(lbl, k1, v1, k2, v2, delta, unit) {
    const cell = el("div", { class: "resource-cell" });
    cell.appendChild(el("span", { class: "lab" }, lbl));
    cell.appendChild(el("div", { class: "row" }, [el("span", { class: "k" }, k1), el("span", { class: "v" }, v1)]));
    cell.appendChild(el("div", { class: "row" }, [el("span", { class: "k" }, k2), el("span", { class: "v" }, v2)]));
    if (delta != null) {
      const sign = delta < 0 ? "down" : delta > 0 ? "up" : "";
      const txt = (delta > 0 ? "+" : "") + (unit === "tok" ? NUMBER_FORMAT.format(Math.round(delta)) : delta.toFixed(1)) + " " + unit;
      const note = sign === "down" ? "  (skill saves)" : sign === "up" ? "  (skill costs more)" : "";
      cell.appendChild(el("div", { class: "row delta" }, [
        el("span", { class: "k" }, "Δ"),
        el("span", { class: "v " + sign }, txt + note),
      ]));
    }
    return cell;
  }

  function paneJudge(detail) {
    const u = detail.utility || {};
    const wrap = el("div", { class: "verdict-pane", "data-tab": "judge" });

    const intro = el("p", { style: "color: var(--ink-soft); font-size: 14px; line-height: 1.55; margin: 0 0 18px; max-width: 720px;" }, [
      document.createTextNode("Verbatim LLM-judge reasoning for the first scenario. Each item has a binary "),
      el("strong", null, "wi"),
      document.createTextNode(" / "),
      el("strong", null, "wo"),
      document.createTextNode(" outcome and the judge's plain-text justification — including which paper section it referenced, which weakness it found, which evidence was missing."),
    ]);
    wrap.appendChild(intro);

    const scen = (u.judge_scenarios || [])[0];
    if (!scen || !(scen.items || []).length) {
      wrap.appendChild(el("p", { style: "color: var(--muted); font-family: var(--mono); font-size: 13px;" }, "No judge evidence available for this skill."));
      return wrap;
    }

    wrap.appendChild(el("h4", { style: "font-family: var(--mono); font-size: 11px; letter-spacing: 0.14em; color: var(--muted); font-weight: 700; text-transform: uppercase; margin-bottom: 14px;" },
      "Scenario " + scen.scenario_id + "  ·  " + scen.wi_passed + " / " + scen.total_items + " with skill,  " + scen.wo_passed + " / " + scen.total_items + " without"));

    const list = el("div", { class: "judge-list" });
    (scen.items || []).slice(0, 5).forEach(function (item) {
      const block = el("div", { class: "judge-item" });
      block.appendChild(el("p", { class: "judge-criterion" }, [
        el("span", { class: "id" }, "[" + item.item_id + "]"),
        document.createTextNode(item.criterion || ""),
      ]));
      block.appendChild(el("div", { class: "judge-row" }, [
        el("span", { class: "badge wi " + (item.wi_score === 1 ? "pass" : "fail") }, "wi  " + (item.wi_score === 1 ? "✓" : "✗")),
        el("p", null, item.wi_reason || ""),
      ]));
      block.appendChild(el("div", { class: "judge-row" }, [
        el("span", { class: "badge wo " + (item.wo_score === 1 ? "pass" : "fail") }, "wo  " + (item.wo_score === 1 ? "✓" : "✗")),
        el("p", null, item.wo_reason || ""),
      ]));
      list.appendChild(block);
    });
    wrap.appendChild(list);

    return wrap;
  }

  function paneFindings(detail) {
    const s = detail.safety || {};
    const wrap = el("div", { class: "verdict-pane", "data-tab": "findings" });

    const findings = s.findings || [];
    if (!findings.length) {
      wrap.appendChild(el("p", { style: "color: var(--muted); font-family: var(--mono); font-size: 13px;" }, "No security findings — the static scanner reported no risks for this skill."));
      return wrap;
    }

    wrap.appendChild(el("p", { style: "color: var(--ink-soft); font-size: 14px; line-height: 1.55; max-width: 720px; margin: 0 0 18px;" }, [
      document.createTextNode("Each finding combines a static existence probability with a dynamic exploitability probability. "),
      el("strong", null, "Confirmed"),
      document.createTextNode(" verdicts mean the agent actually triggered the risk in the sandbox — the rationale below quotes the runtime trace."),
    ]));

    const list = el("div", { class: "findings-list" });
    findings.forEach(function (f) {
      const v = (f.trigger_verdict || "—");
      const head = el("div", { class: "finding-head" });
      head.appendChild(el("span", { class: "id-sev" }, [
        el("span", { class: "id" }, f.finding_id || ""),
        el("span", { class: "sev " + (f.severity || "L").toLowerCase() }, f.severity || "—"),
      ]));
      head.appendChild(el("span", { class: "verdict-badge " + v }, v.replace(/_/g, " ")));

      const item = el("div", { class: "finding" });
      item.appendChild(head);
      item.appendChild(el("div", { class: "finding-pattern" }, [
        document.createTextNode(f.pattern_name || "—"),
        f.category ? el("span", { class: "cat" }, "  ·  " + f.category) : null,
      ]));
      if (f.rationale) {
        item.appendChild(el("p", { class: "rationale" }, f.rationale));
      }
      item.appendChild(el("div", { class: "finding-bars" }, [
        barCell("Existence", f.existence_confidence, ""),
        barCell("Exploitability", f.exploitability, "exploit"),
      ]));
      list.appendChild(item);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function barCell(lbl, val, mod) {
    const pct = (val == null) ? 0 : clamp(val, 0, 1) * 100;
    return el("div", { class: "bar-cell " + mod }, [
      el("span", { class: "lab" }, lbl),
      el("span", { class: "track" }, [el("span", { class: "fill", style: "width:" + pct + "%" })]),
      el("span", { class: "num" }, val == null ? "—" : val.toFixed(2)),
    ]);
  }

  /* ------------------------------------------------- 3. lookup / autocomplete */

  function setupLookup(idx) {
    const form = document.getElementById("lookup-form");
    const input = document.getElementById("lookup-input");
    const optsBox = document.getElementById("lookup-options");
    const suggestRoot = document.getElementById("lookup-suggest");

    let activeIdx = -1;
    let currentList = [];

    function render(query) {
      const q = (query || "").trim().toLowerCase();
      if (!q) { optsBox.classList.remove("show"); optsBox.innerHTML = ""; currentList = []; return; }
      const matches = idx.skills.filter(function (s) {
        return s.name.toLowerCase().indexOf(q) !== -1
            || (s.owner || "").toLowerCase().indexOf(q) !== -1
            || (s.category || "").toLowerCase().indexOf(q) !== -1;
      }).slice(0, 12);
      optsBox.innerHTML = "";
      currentList = matches;
      activeIdx = -1;
      if (!matches.length) {
        optsBox.appendChild(el("div", { class: "lookup-option", style: "color:var(--muted);font-family:var(--mono);font-size:12.5px;" },
          "No skills match \"" + q + "\"."));
      } else {
        matches.forEach(function (s, i) {
          const opt = el("div", { class: "lookup-option", role: "option", "data-skill": s.name });
          opt.appendChild(el("span", { class: "name" }, s.name));
          opt.appendChild(el("span", { class: "meta" }, categoryLabel(s.category) + "  ·  safety " + (s.safety_score == null ? "—" : s.safety_score.toFixed(0))));
          opt.addEventListener("mousedown", function (e) {
            e.preventDefault();
            select(s.name);
          });
          optsBox.appendChild(opt);
        });
      }
      optsBox.classList.add("show");
    }

    function select(name) {
      input.value = name;
      optsBox.classList.remove("show");
      loadSkill(name);
    }

    input.addEventListener("input", function () { render(input.value); });
    input.addEventListener("focus", function () { if (input.value) render(input.value); });
    input.addEventListener("blur", function () { setTimeout(function () { optsBox.classList.remove("show"); }, 200); });

    input.addEventListener("keydown", function (e) {
      if (!optsBox.classList.contains("show")) return;
      const items = $$(".lookup-option[data-skill]", optsBox);
      if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(items.length - 1, activeIdx + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(0, activeIdx - 1); }
      else if (e.key === "Enter") {
        if (activeIdx >= 0 && currentList[activeIdx]) {
          e.preventDefault();
          select(currentList[activeIdx].name);
          return;
        }
      } else if (e.key === "Escape") { optsBox.classList.remove("show"); return; }
      items.forEach(function (it, i) { it.classList.toggle("is-active", i === activeIdx); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      // Try exact match first, otherwise first list match
      const exact = idx.skills.find(function (s) { return s.name === q; });
      if (exact) { select(exact.name); return; }
      const list = idx.skills.filter(function (s) { return s.name.toLowerCase().indexOf(q.toLowerCase()) !== -1; });
      if (list[0]) { select(list[0].name); return; }
    });

    // Suggested skill chips
    if (suggestRoot) {
      suggestRoot.addEventListener("click", function (e) {
        const btn = e.target.closest("button[data-skill]");
        if (!btn) return;
        select(btn.dataset.skill);
      });
    }
  }

  function loadSkill(name) {
    const card = document.getElementById("verdict-card");
    if (card) {
      card.dataset.state = "loading";
      card.innerHTML = "";
      card.appendChild(el("div", { class: "verdict-empty" }, "Loading evidence for " + name + "…"));
    }
    return loadJson("data/skill/" + encodeURIComponent(name) + ".json").then(function (d) {
      renderVerdict(d);
      const url = new URL(window.location.href);
      url.hash = "verdict";
      history.replaceState(null, "", url.toString());
      // Scroll to verdict (without overshooting)
      const target = document.getElementById("verdict");
      if (target) { target.scrollIntoView({ behavior: "smooth", block: "start" }); }
    }).catch(function (err) {
      console.error("[skilltestbench] failed to load detail for", name, err);
      if (card) {
        card.innerHTML = "";
        card.appendChild(el("div", { class: "verdict-empty" }, "Could not load detail for \"" + name + "\"."));
      }
    });
  }

  /* ------------------------------------------------- 4. distributions */

  const SAFETY_BUCKET_TONES = [
    "danger", "danger", "danger", "danger", "warn",
    "warn",   "warn",   "",       "",       "",
  ];

  function renderDistributions(stats) {
    drawHistogram("dist-gain",   stats.distributions.pass_rate_gain,   { color: "bucket",        labelMax: "1.0", labelStart: "0" });
    drawHistogram("dist-eff",    stats.distributions.efficiency_score, { color: "bucket eff",    labelMax: "1.0", labelStart: "0" });
    drawHistogram("dist-safety", stats.distributions.safety_score,     { color: "bucket safety", labelMax: "100", labelStart: "0", safetyMode: true });
  }

  function drawHistogram(id, dist, opts) {
    const slot = document.getElementById(id);
    if (!slot || !dist) return;
    slot.innerHTML = "";
    const buckets = dist.buckets || [];
    const padding = { top: 8, right: 6, bottom: 22, left: 6 };
    const w = 360, h = 150;
    const innerW = w - padding.left - padding.right;
    const innerH = h - padding.top - padding.bottom;
    const maxCount = Math.max.apply(null, buckets.concat([1]));

    const svg = svgEl("svg", { class: "dist-svg", viewBox: "0 0 " + w + " " + h, preserveAspectRatio: "xMidYMid meet", "aria-label": "Histogram" });
    const bw = innerW / buckets.length;
    buckets.forEach(function (count, i) {
      const x = padding.left + i * bw + 1;
      const bh = (count / maxCount) * innerH;
      const y = padding.top + innerH - bh;
      let cls = opts.color || "bucket";
      if (opts.safetyMode && SAFETY_BUCKET_TONES[i]) cls = "bucket safety " + SAFETY_BUCKET_TONES[i];
      const rect = svgEl("rect", {
        class: cls,
        x: String(x), y: String(y),
        width: String(bw - 2), height: String(bh),
        rx: "2",
      });
      svg.appendChild(rect);
      if (bh > 22 && count > 0) {
        const t = svgEl("text", {
          x: String(x + (bw - 2) / 2), y: String(y + 14),
          "text-anchor": "middle",
          "font-family": "ui-monospace, monospace",
          "font-size": "10", fill: "rgba(255,255,255,0.92)", "font-weight": "700",
        });
        t.textContent = String(count);
        svg.appendChild(t);
      }
    });
    const axis = svgEl("g", { class: "axis" });
    const ax0 = padding.left, ax1 = padding.left + innerW, ay = padding.top + innerH + 1;
    axis.appendChild(svgEl("line", { x1: String(ax0), x2: String(ax1), y1: String(ay), y2: String(ay) }));
    [opts.labelStart, opts.labelMax].forEach(function (txt, i) {
      const t = svgEl("text", { x: String(i === 0 ? ax0 : ax1), y: String(ay + 14), "text-anchor": i === 0 ? "start" : "end" });
      t.textContent = txt;
      axis.appendChild(t);
    });
    svg.appendChild(axis);
    slot.appendChild(svg);
  }

  /* ------------------------------------------------- 5. explorer */

  const STATE = {
    skills: [],
    sortKey: "gain",
    sortDir: -1,
    category: "",
    query: "",
    pageSize: 18,
    page: 1,
  };

  const SORTERS = {
    name:    function (a, b) { return a.name.localeCompare(b.name); },
    gain:    function (a, b) { return ((a.pass_rate_gain || 0) - (b.pass_rate_gain || 0)); },
    eff:     function (a, b) { return ((a.efficiency_score || 0) - (b.efficiency_score || 0)); },
    safety:  function (a, b) { return ((a.safety_score || 0) - (b.safety_score || 0)); },
  };

  function setupExplorer(idx, stats) {
    STATE.skills = idx.skills || [];
    const sel = document.getElementById("explorer-category");
    if (sel) {
      sel.innerHTML = "";
      sel.appendChild(el("option", { value: "" }, "All categories  (" + STATE.skills.length + ")"));
      (stats.categories || []).forEach(function (c) {
        sel.appendChild(el("option", { value: c.id }, c.label + "  (" + c.count + ")"));
      });
      sel.addEventListener("change", function () { STATE.category = sel.value; STATE.page = 1; renderExplorer(); });
    }
    const search = document.getElementById("explorer-search");
    if (search) {
      search.addEventListener("input", function () {
        STATE.query = search.value.trim().toLowerCase();
        STATE.page = 1;
        renderExplorer();
      });
    }
    $$(".explorer-table th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        const key = th.dataset.sort;
        if (STATE.sortKey === key) STATE.sortDir = -STATE.sortDir;
        else { STATE.sortKey = key; STATE.sortDir = (key === "name" ? 1 : -1); }
        renderExplorer();
      });
    });
    const prev = document.getElementById("explorer-prev");
    const next = document.getElementById("explorer-next");
    if (prev) prev.addEventListener("click", function () { if (STATE.page > 1) { STATE.page -= 1; renderExplorer(); } });
    if (next) next.addEventListener("click", function () { STATE.page += 1; renderExplorer(); });

    renderExplorer();
  }

  function filteredSkills() {
    const q = STATE.query, cat = STATE.category;
    return STATE.skills.filter(function (s) {
      if (cat && s.category !== cat) return false;
      if (!q) return true;
      return s.name.toLowerCase().indexOf(q) !== -1
          || (s.owner || "").toLowerCase().indexOf(q) !== -1
          || (s.category || "").toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderExplorer() {
    const tbody = document.getElementById("explorer-body");
    if (!tbody) return;
    const sorter = SORTERS[STATE.sortKey] || SORTERS.gain;
    const dir = STATE.sortDir;
    const list = filteredSkills().slice().sort(function (a, b) { return dir * sorter(a, b); });

    $$(".explorer-table th[data-sort]").forEach(function (th) {
      th.classList.toggle("is-sorted", th.dataset.sort === STATE.sortKey);
      const mark = th.querySelector(".sort-mark");
      if (mark) mark.textContent = (th.dataset.sort === STATE.sortKey) ? (dir === 1 ? "▲" : "▼") : "—";
    });

    const total = list.length;
    const pages = Math.max(1, Math.ceil(total / STATE.pageSize));
    if (STATE.page > pages) STATE.page = pages;
    const start = (STATE.page - 1) * STATE.pageSize;
    const view = list.slice(start, start + STATE.pageSize);

    tbody.innerHTML = "";
    if (!view.length) {
      tbody.appendChild(el("tr", null, [el("td", { colspan: "5", class: "explorer-empty" }, "No skills match the current filter.")]));
    } else {
      view.forEach(function (s) { tbody.appendChild(renderExplorerRow(s)); });
    }

    const meta = document.getElementById("explorer-meta");
    if (meta) {
      meta.innerHTML = "";
      meta.appendChild(el("span", null, [
        document.createTextNode("Showing "),
        el("strong", null, (start + 1) + "–" + Math.min(total, start + view.length)),
        document.createTextNode(" of "),
        el("strong", null, String(total)),
        document.createTextNode(" matching skills  ·  click any row to load its verdict at the top"),
      ]));
      meta.appendChild(el("span", null, [
        document.createTextNode("Sort by  "),
        el("strong", null, STATE.sortKey),
        document.createTextNode("  (" + (dir === 1 ? "asc" : "desc") + ")"),
      ]));
    }

    const prev = document.getElementById("explorer-prev"), next = document.getElementById("explorer-next");
    const pageL = document.getElementById("explorer-page");
    if (pageL) pageL.textContent = "page  " + STATE.page + " / " + pages;
    if (prev) prev.disabled = STATE.page <= 1;
    if (next) next.disabled = STATE.page >= pages;
  }

  function renderExplorerRow(s) {
    const tr = el("tr");
    tr.addEventListener("click", function () { loadSkill(s.name); });

    tr.appendChild(el("td", null, [el("span", { class: "skill-name" }, [document.createTextNode(s.name), el("small", null, s.owner || "unknown")])]));
    tr.appendChild(el("td", { class: "col-cat" }, [el("span", { class: "cat-pill" }, categoryLabel(s.category))]));

    const gv = s.pass_rate_gain;
    const gPct = (gv == null) ? 0 : clamp(gv, 0, 1) * 100;
    tr.appendChild(el("td", { class: "num" }, [
      el("span", { class: "bar-inline" + (gv === 0 ? " is-zero" : "") }, [
        el("span", { class: "track" }, el("span", { class: "fill", style: "width:" + gPct + "%" })),
        el("span", { class: "num" }, gv == null ? "—" : (gv > 0 ? "+" : "") + (gv * 100).toFixed(1) + " pp"),
      ]),
    ]));

    const ev = s.efficiency_score;
    const ePct = (ev == null) ? 0 : clamp(ev, 0, 1) * 100;
    tr.appendChild(el("td", { class: "num col-eff" }, [
      el("span", { class: "bar-inline is-eff" + (ev === 0 ? " is-zero" : "") }, [
        el("span", { class: "track" }, el("span", { class: "fill", style: "width:" + ePct + "%" })),
        el("span", { class: "num" }, ev == null ? "—" : ev.toFixed(2)),
      ]),
    ]));

    const sv = s.safety_score;
    let sCls = "";
    if (sv != null) sCls = sv >= 90 ? "" : sv >= 65 ? "mid" : "low";
    tr.appendChild(el("td", { class: "num" }, [
      el("span", { class: "safety-pill " + sCls }, sv == null ? "—" : sv.toFixed(1)),
      document.createTextNode("  "),
      el("span", { class: "findings-pills" }, [
        el("span", { class: "p h" + ((s.findings || {}).H ? "" : " zero") }, "H " + ((s.findings || {}).H || 0)),
        el("span", { class: "p m" + ((s.findings || {}).M ? "" : " zero") }, "M " + ((s.findings || {}).M || 0)),
        el("span", { class: "p l" + ((s.findings || {}).L ? "" : " zero") }, "L " + ((s.findings || {}).L || 0)),
      ]),
    ]));

    return tr;
  }

  /* ------------------------------------------------- 6. misc */

  function setupReveal() {
    const items = $$(".reveal");
    if (!items.length || !("IntersectionObserver" in window)) {
      items.forEach(function (i) { i.classList.add("is-visible"); }); return;
    }
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-visible"); obs.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.05 });
    items.forEach(function (i) { obs.observe(i); });
  }

  function setupNavActive() {
    const links = $$(".topnav a[href^='#']");
    if (!links.length || !("IntersectionObserver" in window)) return;
    const map = {};
    links.forEach(function (a) {
      const id = a.getAttribute("href").slice(1);
      const el = document.getElementById(id);
      if (el) map[id] = a;
    });
    const obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        Object.keys(map).forEach(function (k) { map[k].classList.remove("is-active"); });
        if (map[e.target.id]) map[e.target.id].classList.add("is-active");
      });
    }, { rootMargin: "-30% 0px -55% 0px" });
    Object.keys(map).forEach(function (id) { obs.observe(document.getElementById(id)); });
  }

  function setupCopy() {
    const btn = document.getElementById("copy-bib");
    const pre = document.getElementById("bibtex");
    if (!btn || !pre) return;
    btn.addEventListener("click", function () {
      const text = pre.textContent || "";
      const done = function () {
        btn.textContent = "Copied to clipboard";
        btn.classList.add("is-copied");
        setTimeout(function () {
          btn.textContent = "Copy BibTeX";
          btn.classList.remove("is-copied");
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (e) { /* noop */ }
        document.body.removeChild(ta);
        done();
      }
    });
  }

  function fillHeroStats(stats) {
    const t = stats.totals || {};
    function set(id, v) { const n = document.getElementById(id); if (n && v != null) n.textContent = NUMBER_FORMAT.format(v); }
    set("m-skills",    t.skill_count);
    set("m-scenarios", t.scenario_count);
    set("m-judge",     t.judge_items);
    set("m-findings",  t.total_findings);
    set("m-trig",      t.findings_triggered);
  }

  /* ----------------------------------------------------- boot */

  Promise.all([
    loadJson("data/skills.json"),
    loadJson("data/stats.json"),
  ]).then(function (results) {
    const idx = results[0];
    const stats = results[1];

    fillHeroStats(stats);
    renderDistributions(stats);
    setupExplorer(idx, stats);
    setupLookup(idx);
    setupReveal();
    setupNavActive();
    setupCopy();

    // Default-load a skill so the verdict card is alive on first paint.
    // Prefer the URL hash if it points at a known skill, else fall back to default.
    const hashSkill = decodeURIComponent((window.location.hash || "").replace(/^#skill=/, ""));
    const initial = (idx.skills.find(function (s) { return s.name === hashSkill; }) ? hashSkill : DEFAULT_SKILL);
    return loadJson("data/skill/" + encodeURIComponent(initial) + ".json").then(function (d) {
      renderVerdict(d);
    }).catch(function () {
      const card = document.getElementById("verdict-card");
      if (card) {
        card.innerHTML = "";
        card.appendChild(el("div", { class: "verdict-empty" }, "Type a skill name above to load its verdict."));
      }
    });
  }).catch(function (err) {
    console.error("[skilltestbench] boot failed", err);
    const card = document.getElementById("verdict-card");
    if (card) {
      card.innerHTML = "";
      card.appendChild(el("div", { class: "verdict-empty" }, "Could not load evaluation data. Run the page from a server (file:// blocks fetch on JSON)."));
    }
  });
})();
