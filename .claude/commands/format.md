# Format Code

Format all TypeScript and React code using Prettier.

## Steps

1. Run the format command:

```bash
npm run format
```

This formats:
- All `.ts` files in `src/`
- All `.ts` and `.tsx` files in `webview-ui/src/`

2. Report any files that were changed.

3. Optionally check for any remaining formatting issues:

```bash
npm run format:check
```

## Prettier Configuration

The project uses the following Prettier settings (.prettierrc):

- Semi: true (always use semicolons)
- Trailing Comma: es5 (trailing commas where valid in ES5)
- Single Quote: true (use single quotes)
- Print Width: 100 (wrap lines at 100 characters)
- Tab Width: 4 (4-space indentation)
- Bracket Spacing: true (spaces inside object literals)
- Arrow Parens: always (always wrap arrow function params)
- End of Line: auto (match existing line endings)
