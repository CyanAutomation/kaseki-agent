# Kaseki Task Prompt Templates & Best Practices

This guide shows how to write **effective task prompts** that minimize scope creep and unintended file changes. Combined with the allowlist, these templates help keep agent modifications focused.

## What is Scope Creep?

**Scope Creep:** When an agent makes changes beyond what you asked for.

```
Request: "Fix the parser bug that fails on empty input"

Without constraints:
✅ Fixes src/lib/parser.ts
❌ Also refactors unrelated code in src/lib/utils.ts
❌ Updates docs/ARCHITECTURE.md
❌ Changes package.json
❌ Reformats random files

With constraints (template):
✅ Fixes src/lib/parser.ts
✅ Adds test case to tests/parser.validation.ts
❌ Everything else prevented by allowlist
```

## Template Structure

Effective prompts contain:

1. **Clear Task Goal** — what to do, not how
2. **Scope Boundaries** — what files to touch/avoid
3. **Success Criteria** — how to verify it works
4. **Constraints** — what not to do

### Basic Template

```
[GOAL]
Fix [specific behavior] in [file(s)].

[SCOPE]
Restrict changes to:
- [file/directory pattern]
- [file/directory pattern]

[CONSTRAINTS]
- Do not modify [adjacent areas]
- Do not update [build/config files]
- Do not refactor [unrelated code]

[SUCCESS]
The fix must:
- [criterion 1]
- [criterion 2]
```

## Specific Prompt Templates

### 1. Bug Fix in Specific File

**When:** Fix a bug in one file, minimal test changes

```
Fix the [specific bug description] in `[file.ts]`.

Restrict changes to:
- [file.ts]
- tests/[corresponding test file.ts]

Do NOT:
- Modify other files in this module
- Refactor surrounding code
- Update types or interfaces
- Add new dependencies

The fix must:
- Correctly handle [edge case]
- Preserve existing behavior for [scenario]
- Pass all existing tests
```

**Example:**

```
Fix the parser bug that fails on empty input in `src/lib/parser.ts`.

Restrict changes to:
- src/lib/parser.ts
- tests/parser.validation.ts

Do NOT:
- Modify src/lib/utils.ts or other modules
- Refactor the parsing logic
- Add new functions or exports
- Change package.json

The fix must:
- Return a valid AST for empty input
- Pass all existing tests
- Handle whitespace-only input identically to empty input
```

**Recommended Allowlist:**

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/parser.ts tests/parser.validation.ts"
```

### 2. Utility/Helper Function Fix

**When:** Fix a utility function, update related tests

```
Fix the [function] in `[utils file]` to [behavior change].

Restrict changes to:
- src/lib/[util-name]/** 
- src/utils/[util-name]/**
- tests/[util-name]/**

Do NOT:
- Modify unrelated utility functions
- Update types outside of [util-name] directory
- Add new public exports beyond fixing [function]

The fix must:
- Correctly implement [spec]
- Maintain backward compatibility for [existing calls]
- Include tests for the specific case
```

**Example:**

```
Fix the `normalizeEmail()` function in `src/lib/email-utils.ts` to properly validate email format.

Restrict changes to:
- src/lib/email-utils.ts
- tests/email-utils.test.ts

Do NOT:
- Modify unrelated functions like `sanitizeEmail` or `parseEmail`
- Change the function signature
- Add new exports

The fix must:
- Reject emails with spaces or special chars (except @.-)
- Accept valid emails per RFC 5322 (basic form)
- Pass all existing validation tests
```

**Recommended Allowlist:**

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/email-utils.ts tests/email-utils.test.ts"
```

### 3. React/Vue Component Implementation

**When:** Create or modify a UI component

```
[Implement|Update] the [ComponentName] component in `[path]`.

[Description of component behavior and props]

Restrict changes to:
- src/components/[component-name]/
- src/hooks/[related hooks]/
- tests/components/[component-name]/
- src/lib/ui/** (only if adding UI utilities)

Do NOT:
- Modify other components
- Update global styles in src/app/globals.css
- Change layout or navigation structure
- Add new pages or routes

The component must:
- Accept [prop1], [prop2] as inputs
- Support [feature1] and [feature2]
- Be accessible (ARIA labels where needed)
- Include tests with [test1], [test2] cases
```

**Example:**

```
Implement the PricingCard component in `src/components/pricing-card`.

The component displays a pricing tier with plan name, price, features list, and CTA button.
Props: title, price, currency, features (string[]), onSelect (callback).

Restrict changes to:
- src/components/pricing-card/
- src/hooks/ (only if creating new hooks for this component)
- tests/components/pricing-card/

Do NOT:
- Modify other components
- Update global styles
- Change the pricing page layout

The component must:
- Display price in the specified currency
- Render features as a bulleted list
- Include an "Select Plan" button that calls onSelect
- Be responsive (mobile and desktop)
- Have unit tests for rendering, currency formatting, and button click
```

**Recommended Allowlist:**

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/components/pricing-card/** src/hooks/** tests/components/pricing-card/**"
```

### 4. API Endpoint

**When:** Implement a new API route/handler

```
[Implement|Fix] the `[METHOD] /api/[route]` endpoint.

[Description of endpoint behavior, request/response format]

Restrict changes to:
- src/app/api/[route]/route.ts
- src/lib/[route-utils]/** (utilities for this route)
- src/types/api.ts (if adding request/response types)
- tests/api/[route].test.ts

Do NOT:
- Modify other routes or endpoints
- Change authentication/middleware globally
- Update database schema
- Add new environment variables without documenting

The endpoint must:
- Accept [request format/params]
- Return [response format] on success
- Return [error response] on [failure case]
- Validate [specific inputs]
- Handle [edge case]
```

**Example:**

```
Implement the POST /api/users endpoint.

This endpoint creates a new user with email, password, and optional name.
Request: { email, password, name? }
Response: { userId, email, createdAt } or { error, status }

Restrict changes to:
- src/app/api/users/route.ts
- src/lib/user-service.ts
- src/types/api.ts (only for User types)
- tests/api/users.test.ts

Do NOT:
- Modify other endpoints or middleware
- Change authentication globally
- Update the database schema

The endpoint must:
- Validate email format
- Hash password (use bcrypt)
- Return 201 with user object on success
- Return 400 with error message on invalid input
- Return 409 if email already exists
- Include tests for valid input, duplicate email, invalid email
```

**Recommended Allowlist:**

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/app/api/users/** src/lib/user-service.ts src/types/api.ts tests/api/users.test.ts"
```

### 5. Configuration or Build Fix

**When:** Fix a configuration issue (tsconfig, jest, etc.)

```
Fix [config issue description] in `[config file]`.

Restrict changes to:
- [config file]
- [related source files affected by the fix]
- tests/ (if config changes affect test setup)

Do NOT:
- Modify unrelated configuration files
- Change build process for other targets
- Update source code beyond what's needed for the fix

The fix must:
- Correctly resolve [issue]
- Not break [other feature]
- Be compatible with [environment/version]
```

**Example:**

```
Fix TypeScript compilation error in tsconfig.json where async/await doesn't transpile for ES2020.

Restrict changes to:
- tsconfig.json
- src/lib/async-utils.ts (if implementation changes needed)

Do NOT:
- Modify jest.config.ts or other configs
- Change build process

The fix must:
- Compile src/lib/async-utils.ts without errors
- Target ES2020 as intended
- Preserve all other compiler options
```

**Recommended Allowlist:**

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="tsconfig.json src/lib/async-utils.ts"
```

### 6. Large Refactor (Multiple Files)

**When:** Refactor a feature across multiple files

```
Refactor [feature name] to [desired outcome].

Scope:
- Modify [module 1], [module 2], [module 3] to [specific changes]
- Update [test modules] correspondingly

Do NOT:
- Change public API contracts
- Modify unrelated features
- Add new endpoints or exports
- Update documentation outside of [specific area]

The refactor must:
- Preserve all external behavior
- Pass all existing tests
- Move [X] logic from [location A] to [location B]
- Reduce [metric] by improving [specific aspect]
```

**Example:**

```
Refactor the auth module to extract session utils into a separate file.

Scope:
- Extract session logic from src/lib/auth.ts to src/lib/session-utils.ts
- Update src/lib/auth.ts to import from session-utils.ts
- Update tests/auth.test.ts and tests/session-utils.test.ts

Do NOT:
- Change public API exports from src/lib/auth.ts
- Modify middleware or route handlers
- Update environment variable schema

The refactor must:
- Preserve all existing behavior
- Pass all tests (no functionality change)
- Make session utilities reusable
- Improve code organization
```

**Recommended Allowlist:**

```bash
KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/auth.ts src/lib/session-utils.ts tests/auth.test.ts tests/session-utils.test.ts"
```

## Anti-Patterns: What NOT to Do

### ❌ Vague Scope

```
"Fix the bug"
"Improve the code"
"Make it better"
```

**Why:** Agent doesn't know what files to touch → scope creep.

### ✅ Better

```
"Fix the parser null-reference bug in src/lib/parser.ts when input is null"
"Improve type safety by adding strict null checks in src/lib/validation.ts"
"Make JSON parsing faster by caching compiled schemas in src/lib/json-cache.ts"
```

---

### ❌ Vague Constraints

```
"Don't break anything"
"Keep it simple"
"Don't over-engineer"
```

**Why:** Agent interprets differently than you; no clear boundaries.

### ✅ Better

```
"Do not modify src/utils/ or src/components/"
"Keep the function signature the same"
"Do not add new dependencies to package.json"
```

---

### ❌ Over-Specification

```
"Change line 23 from X to Y. Then on line 45 change Z to W. Then..."
```

**Why:** Too prescriptive; prevents legitimate improvements; locks you into one solution.

### ✅ Better

```
"Fix the null-reference error on line 23. The issue occurs when
input is null. Use a null-coalescing operator or early return."
```

---

### ❌ Multiple Unrelated Tasks

```
"Fix the parser bug AND implement the new button component AND add metrics"
```

**Why:** Scope explosion; makes it hard to define allowlist and verify each fix.

### ✅ Better

```
"Fix the parser bug in src/lib/parser.ts that fails on empty input.
Run this first. Then in a separate kaseki run: implement the new button component."
```

## Combining Prompts with Allowlist

**The Power Combination:**

1. **Write a clear, scoped prompt** using a template above
2. **Set a matching allowlist** that covers those specific files
3. **Run kaseki** with both settings

**Example:**

```bash
export TASK_PROMPT="Fix the normalizeRole function in src/lib/role-utils.ts \
  to safely handle null FriendlyName by falling back to 'Unnamed Role'. \
  Add one test case in tests/role-utils.test.ts. \
  Do not modify other files or refactor."

export KASEKI_CHANGED_FILES_ALLOWLIST="src/lib/role-utils.ts tests/role-utils.test.ts"

./run-kaseki.sh
```

**Result:**

- Agent stays focused on the task
- Allowlist ensures no surprise changes
- Easy to review what changed (small diff)
- Easy to identify if agent drifted from instructions
- Restoration report confirms agent stayed on task

## Troubleshooting: Agent Changed Too Many Files

### If Prompt is Clear + Allowlist is Set + Agent Still Over-Modifies

1. **Check restoration report** — which files were restored?

   ```bash
   cat /results/kaseki-N/restoration-report.md
   ```

2. **Check agent reasoning** — look at pi-summary.json

   ```bash
   cat /results/kaseki-N/pi-summary.json | jq '.thinking' | head -100
   ```

3. **Refine the prompt** with more explicit constraints:
   - ✅ "Do not modify" specific files
   - ✅ "Only change" specific functions
   - ✅ "Add one test case, no more"

4. **Consider task decomposition** — break into smaller tasks:
   - Instead of: "Refactor entire module"
   - Use: "Extract X function from module" + "Update imports" (separate runs)

## Related Resources

- [docs/QUALITY_GATES.md](./QUALITY_GATES.md) — Allowlist configuration and patterns
- [scripts/suggest-allowlist.sh](../scripts/suggest-allowlist.sh) — Auto-generate allowlist from completed run
- [scripts/dry-run-allowlist.sh](../scripts/dry-run-allowlist.sh) — Preview what would be restored
- `templates/allowlist-*.txt` — Pre-built allowlist templates

## Summary

**Good Task Prompts:**

1. Have a **clear, specific goal** (not vague)
2. Define **scope boundaries** (which files to touch)
3. State **constraints** (what not to do)
4. Include **success criteria** (how to verify)
5. Are **focused** (one task, not multiple)

**Good Allowlist:**

1. **Matches the prompt scope** exactly
2. Is **as narrow as reasonable** (prevent scope creep)
3. Is **documented** (why these files?)
4. Can be **verified** with dry-run-allowlist.sh

**Result:** Focused, reviewable agent outputs with predictable scope.
