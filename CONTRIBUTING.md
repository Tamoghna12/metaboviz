# Contributing to MetaboViz

Thank you for considering a contribution. This document covers everything you need to go from idea to merged PR.

---

## Table of Contents

- [Getting started](#getting-started)
- [What to work on](#what-to-work-on)
- [Development workflow](#development-workflow)
- [Commit conventions](#commit-conventions)
- [Pull request checklist](#pull-request-checklist)
- [Code style](#code-style)
- [Testing](#testing)
- [Reporting bugs](#reporting-bugs)

---

## Getting started

```bash
# 1. Fork on GitHub, then clone your fork
git clone https://github.com/<your-username>/metaboviz.git
cd metaboviz

# 2. Install dependencies
npm install

# 3. Start dev server
npm run dev
# → http://localhost:5173
```

Node.js ≥ 18 required.

---

## What to work on

Check [open issues](https://github.com/Tamoghna12/metaboviz/issues) for anything labelled:

- `good first issue` — small, self-contained, well-scoped
- `help wanted` — larger tasks where external help is actively sought
- `bug` — confirmed defects

If you want to propose a new feature, open an issue first to discuss scope before investing time in implementation.

---

## Development workflow

```bash
# Create a focused branch
git checkout -b feat/my-feature     # new feature
git checkout -b fix/broken-fba      # bug fix
git checkout -b docs/update-usage   # docs only

# Make changes, run tests continuously
npm run test:watch

# Before pushing, ensure all checks pass
npm run lint
npm test
npm run build   # confirm no build errors
```

---

## Commit conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short imperative summary>

[optional body]
```

Types:

| Type | When to use |
|------|-------------|
| `feat` | New user-visible feature |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `refactor` | Code restructure with no behaviour change |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `chore` | Tooling, deps, CI |

Examples:
```
feat: add FVA panel with min/max flux ranges
fix: EscherParser drops midmarker nodes breaking bezier routing
docs: add C. botulinum sample analysis to README
perf: memoize subsystem grouping for large models
```

---

## Pull request checklist

Before opening a PR confirm:

- [ ] `npm test` passes with no failures
- [ ] `npm run lint` reports no errors
- [ ] `npm run build` completes without warnings
- [ ] New behaviour is covered by at least one test
- [ ] Screenshots added to PR description if UI changed
- [ ] `USAGE.md` updated if a new user-facing feature was added

---

## Code style

- **JavaScript/JSX only** — no TypeScript (ESLint configured accordingly)
- Functional components + hooks exclusively — no class components
- No comments explaining *what* code does — only *why* when non-obvious
- No `console.log` left in merged code
- Prefer named exports over default where multiple exports exist in a file

ESLint config is in `eslint.config.js`. Run `npm run lint` to check.

---

## Testing

Tests live alongside source files as `*.test.js`:

```
src/lib/FBASolver.test.js
src/lib/HiGHSSolver.test.js
src/lib/UncertaintyFBA.test.js
```

Run:
```bash
npm test                 # single run
npm run test:watch       # re-run on save
npm run test:coverage    # HTML coverage report in coverage/
```

For algorithmic changes (FBA solver, parsers, GPR evaluation) tests are **required**. For pure UI changes they are encouraged but not blocking.

---

## Reporting bugs

Open a [GitHub Issue](https://github.com/Tamoghna12/metaboviz/issues/new) and include:

1. **Model file** (or model name from BiGG) that triggers the bug
2. **Steps to reproduce** — exact sequence of clicks/inputs
3. **Expected behaviour** vs **actual behaviour**
4. **Browser and OS**
5. **Console errors** if any (open DevTools → Console, copy output)

---

## Questions

Open a [Discussion](https://github.com/Tamoghna12/metaboviz/discussions) for anything that isn't a bug or a concrete feature request.
