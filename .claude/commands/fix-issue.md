# Fix GitHub Issue

Analyze and fix a GitHub issue for the VS Code Scrcpy extension.

**Usage**: `/fix-issue <issue-number-or-description>`

## Steps

1. If a GitHub issue number is provided, fetch the issue details:

```bash
gh issue view $ARGUMENTS
```

2. Understand the problem:
   - What is the expected behavior?
   - What is the actual behavior?
   - Are there reproduction steps?
   - Which files are likely involved?

3. Search the codebase for relevant files:

```bash
# Find related services
rg -l "relevant-keyword" src/services/

# Find related components
rg -l "relevant-keyword" webview-ui/src/components/

# Find message handlers
rg -n "case 'relevant-message'" src/views/ src/panels/
```

4. Read the CLAUDE.md files in relevant directories for patterns:
   - Root CLAUDE.md for universal rules
   - src/CLAUDE.md for extension patterns
   - webview-ui/CLAUDE.md for React patterns

5. Implement the fix following established patterns.

6. Verify the fix:

```bash
npm run typecheck
npm run lint
npm run format:check
```

7. Create a descriptive commit message using conventional commits:

```bash
git add .
git commit -m "fix: description of the fix

Closes #<issue-number>

Co-Authored-By: Claude <noreply@anthropic.com>"
```

8. Optionally create a PR if requested:

```bash
gh pr create --title "fix: description" --body "Fixes #<issue-number>"
```

## Notes

- Always read the relevant code before making changes
- Follow existing patterns in the codebase
- Test the fix if possible (F5 to launch Extension Development Host)
- Include the issue number in the commit message
