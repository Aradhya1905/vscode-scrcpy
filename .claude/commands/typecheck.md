# Type Check

Run TypeScript type checking for both the extension and webview UI.

## Steps

1. Run type checking for the extension:

```bash
npm run typecheck
```

2. Run type checking for the webview (from webview-ui directory):

```bash
cd webview-ui && npx tsc --noEmit
```

3. Report any type errors found with file locations and suggested fixes.

4. If no errors, confirm the codebase is type-safe.

## Common Type Issues

- Missing type annotations on function parameters
- Incorrect event handler types (React.PointerEvent vs MouseEvent)
- Nullable values not properly checked
- @yume-chan/adb API type mismatches
