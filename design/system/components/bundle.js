/* @ds-bundle: {"format":4,"namespace":"Halden","components":[{"name":"ReasonMark"},{"name":"Key"},{"name":"KeyButton"},{"name":"Segmented"},{"name":"GroupHeader"},{"name":"QueueRow"},{"name":"Eyebrow"},{"name":"WhyBlock"},{"name":"FactStrip"},{"name":"ContactHeat"},{"name":"LogTable"},{"name":"PromiseItem"},{"name":"LogInput"},{"name":"Box"},{"name":"TopBar"},{"name":"KeyLegend"},{"name":"EmptyState"},{"name":"Toast"}]} */
(function () {
  "use strict";
  var React = window.React;
  var h = React.createElement;
  var cx = function () { return Array.prototype.filter.call(arguments, Boolean).join(" "); };
  var pick = function (props, omit) {
    var out = {};
    Object.keys(props).forEach(function (k) { if (omit.indexOf(k) < 0) out[k] = props[k]; });
    return out;
  };

  var MARK_WORDS = { promise: "A promise you made", reply: "Waiting on a reply", meeting: "A meeting today", quiet: "Going quiet", renewal: "Renewal ahead" };

  /* The shape is the reason an item is on your day. */
  function ReasonMark(p) {
    var kind = p.kind || "promise";
    var label = p.label === undefined ? MARK_WORDS[kind] : p.label;
    return h("span", {
      className: cx("hd-mark", "hd-mark-" + kind, p.late && "is-late", p.className),
      role: label ? "img" : undefined,
      "aria-label": label ? label + (p.late ? ", late" : "") : undefined,
      "aria-hidden": label ? undefined : "true",
      title: label || undefined
    }, h("i"));
  }

  function Key(p) { return h("kbd", { className: cx("hd-key", p.className) }, p.children); }

  function KeyButton(p) {
    var rest = pick(p, ["keyLabel", "primary", "className", "children"]);
    return h("button", Object.assign({ type: "button" }, rest, {
      className: cx("hd-keybtn", p.primary && "is-primary", p.className),
      "aria-keyshortcuts": p.keyLabel && p.keyLabel.length === 1 ? p.keyLabel.toUpperCase() : undefined
    }), p.keyLabel ? h(Key, null, p.keyLabel) : null, p.children);
  }

  function Segmented(p) {
    return h("div", { className: cx("hd-seg", p.className), role: "group", "aria-label": p.label },
      (p.options || []).map(function (o) {
        return h("button", {
          key: o.value, type: "button", "aria-pressed": String(o.value === p.value),
          onClick: function () { p.onChange && p.onChange(o.value); }
        }, o.label);
      }));
  }

  function GroupHeader(p) {
    return h("div", { className: cx("hd-group", p.late && "is-late", p.className), role: "presentation" },
      h("span", null, p.label), p.count === undefined ? null : h("span", null, p.count));
  }

  function QueueRow(p) {
    var cells = [
      h(ReasonMark, { key: "m", kind: p.kind, late: p.late }),
      h("span", { key: "w", className: "hd-row-who" }, p.who),
      h("span", { key: "t", className: "hd-row-what" }, p.what),
      h("span", { key: "a", className: "hd-row-age" }, p.age)
    ];
    if (p.waiting) return h("div", { className: cx("hd-row", "is-waiting", p.className) }, cells);
    return h("button", {
      type: "button", role: "option", "aria-selected": String(!!p.selected),
      className: cx("hd-row", p.late && "is-late", p.className), onClick: p.onSelect
    }, cells);
  }

  function Eyebrow(p) {
    return h("div", { className: cx("hd-eyebrow", p.late && "is-late", p.className) },
      p.kind ? h(ReasonMark, { kind: p.kind, late: p.late, label: "" }) : null, p.children);
  }

  function WhyBlock(p) {
    return h("div", { className: cx("hd-why", p.late && "is-late", p.className) },
      h("span", null, h("b", null, p.reason), p.detail ? " " + p.detail : null),
      p.also ? h("span", { className: "hd-why-also" }, "Also owed: " + p.also) : null);
  }

  function FactStrip(p) {
    return h("div", { className: cx("hd-facts", p.fill && "is-fill", p.className) },
      (p.facts || []).map(function (f, i) {
        return h("div", { key: i, className: "hd-fact" },
          h("span", { className: "hd-fact-k" }, f.label),
          h("span", { className: cx("hd-fact-v", f.figure && "is-figure", f.late && "is-late"), title: typeof f.value === "string" ? f.value : undefined }, f.value));
      }));
  }

  var HEAT_KEY = [["call", "var(--ink)"], ["email", "var(--ink-faint)"], ["meeting", "var(--meeting)"], ["note", "var(--select)"]];
  function ContactHeat(p) {
    var cells = p.cells || [];
    return h("div", { className: cx("hd-heat", p.className) },
      h("div", { className: "hd-heat-row" },
        h("span", { className: "hd-fact-k" }, "Contact · last " + cells.length + " days"),
        h("span", { className: "hd-heat-key" }, HEAT_KEY.map(function (k) {
          return h("span", { key: k[0] }, h("i", { style: { background: k[1] } }), k[0]);
        }))),
      h("div", { className: "hd-heat-cells", style: { "--days": cells.length }, role: "img", "aria-label": p.summaryText || "Contact over the last " + cells.length + " days" },
        cells.map(function (c, i) {
          return h("i", { key: i, className: c ? (c.type || c) : undefined, title: c && c.title ? c.title : undefined });
        })),
      p.summary ? h("div", { className: "hd-heat-row" }, h("span", null, p.summary)) : null);
  }

  function LogTable(p) {
    var rows = p.entries || [];
    return h("table", { className: cx("hd-logtable", p.className) },
      h("thead", null, h("tr", null, ["Date", "Type", "Who", "What was said"].map(function (t) { return h("th", { key: t, scope: "col" }, t); }))),
      h("tbody", null, rows.length ? rows.map(function (r, i) {
        return h("tr", { key: i },
          h("td", { className: "m" }, r.date), h("td", { className: "m" }, r.type),
          h("td", { className: cx("m", r.you && "you") }, r.you ? "you" : r.who), h("td", null, r.note));
      }) : h("tr", { className: "is-empty" }, h("td", { colSpan: 4 }, p.empty || "Nothing logged yet."))));
  }

  function PromiseItem(p) {
    return h("div", { className: cx("hd-promise", p.done && "is-done", p.className) },
      h("button", { type: "button", "aria-pressed": String(!!p.done), "aria-label": (p.done ? "Reopen: " : "Mark kept: ") + p.what, onClick: p.onToggle }),
      h("span", { className: "hd-promise-what" }, p.what),
      h("span", { className: cx("hd-promise-due", p.late && !p.done && "is-late") }, p.due));
  }

  function LogInput(p) {
    var st = React.useState(""), v = st[0], setV = st[1];
    var submit = function (e) {
      e.preventDefault();
      if (!v.trim()) return;
      p.onLog && p.onLog(v.trim());
      setV("");
    };
    return h("form", { className: cx("hd-log", p.className), onSubmit: submit },
      h("input", { id: p.id, value: v, placeholder: p.placeholder || "Call, note, or a promise…", "aria-label": "Log a contact", onChange: function (e) { setV(e.target.value); } }),
      h(KeyButton, { type: "submit", primary: true }, p.action || "Log"));
  }

  function Box(p) {
    return h("section", { className: cx("hd-box", p.className) },
      p.title ? h("h3", { className: "hd-box-title" }, p.title) : null, p.children);
  }

  function TopBar(p) {
    return h("header", { className: cx("hd-top", p.className) },
      h("span", { className: "hd-brand" }, h("i"), "HALDEN"),
      p.nav ? h("nav", { className: "hd-top-nav", "aria-label": "Screens" }, p.nav.map(function (n) {
        return h("a", { key: n.href, href: n.href, "aria-current": n.current ? "page" : undefined },
          n.label, n.count ? h("span", { className: "hd-top-count" }, n.count) : null);
      })) : null,
      p.where ? h("span", { className: "hd-top-where" }, p.where) : null,
      h("div", { className: "hd-top-end" }, p.children,
        p.me ? h("button", { type: "button", className: "hd-me", title: p.me.name, "aria-label": "Account: " + p.me.name, onClick: p.onMe }, p.me.initials) : null));
  }

  function KeyLegend(p) {
    var keys = p.keys || [];
    var total = p.total || 0, done = p.done || 0;
    return h("footer", { className: cx("hd-legend", p.className) },
      h("span", { className: "hd-legend-keys" }, keys.map(function (k, i) {
        return h(React.Fragment, { key: i }, [].concat(k.key).map(function (c) { return h(Key, { key: c }, c); }), h("em", null, k.label));
      })),
      total ? h("span", { className: "hd-progress" }, done + " / " + total + " cleared",
        h("span", { className: "hd-progress-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": total, "aria-valuenow": done },
          h("i", { style: { width: Math.round(done / total * 100) + "%" } }))) : null);
  }

  function EmptyState(p) {
    return h("div", { className: cx("hd-empty", p.className) },
      p.title ? h("h3", null, p.title) : null,
      p.children ? h("p", null, p.children) : null,
      p.rules ? h("div", { className: "hd-empty-rules" }, p.rules.map(function (r, i) {
        return h("div", { key: i }, h(ReasonMark, { kind: r.kind, label: "" }), h("span", null, h("b", null, r.title), " " + r.text));
      })) : null,
      p.actions ? h("div", { className: "hd-empty-acts" }, p.actions) : null);
  }

  function Toast(p) {
    return h("div", { className: cx("hd-toast", p.className), role: "status" },
      h("span", null, p.children),
      p.onUndo ? h("button", { type: "button", onClick: p.onUndo }, "Undo") : null);
  }

  window.Halden = Object.assign(window.Halden || {}, {
    ReasonMark: ReasonMark, Key: Key, KeyButton: KeyButton, Segmented: Segmented,
    GroupHeader: GroupHeader, QueueRow: QueueRow, Eyebrow: Eyebrow, WhyBlock: WhyBlock,
    FactStrip: FactStrip, ContactHeat: ContactHeat, LogTable: LogTable, PromiseItem: PromiseItem,
    LogInput: LogInput, Box: Box, TopBar: TopBar, KeyLegend: KeyLegend, EmptyState: EmptyState, Toast: Toast
  });
})();
