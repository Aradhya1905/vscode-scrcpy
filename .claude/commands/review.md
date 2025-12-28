# Code Review

Perform a comprehensive code review of recent changes in the VS Code Scrcpy extension.

## Steps

1. Check what files have been modified:

```bash
git status
git diff --stat HEAD~5
```

2. Review each changed file for:

### TypeScript & React Conventions
- Strict TypeScript usage (no `any` without justification)
- Functional components with `memo()` where appropriate
- Proper use of React hooks (dependencies, cleanup)
- Event handler types correctly specified

### VS Code Extension Patterns
- Proper disposable cleanup in `dispose()` methods
- Correct use of `vscode.window` and `vscode.workspace` APIs
- Message handlers cover all expected message types
- Error messages shown via `vscode.window.showErrorMessage`

### Performance
- Video buffering limits respected (MAX_VIDEO_BUFFER_SIZE)
- Touch events throttled appropriately
- No synchronous file operations blocking the main thread
- Proper use of AbortController for cancelable operations

### Security
- No hardcoded secrets or device IDs
- Proper input validation for ADB commands
- CSP headers maintained in webview HTML

### Code Quality
- Functions under 50 lines when possible
- Clear variable and function names
- Comments explain "why", not "what"
- No dead code or unused imports

3. Provide specific, actionable feedback with file:line references.

4. Suggest any refactoring opportunities.
