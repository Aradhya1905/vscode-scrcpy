# Add Feature

Plan and implement a new feature for the VS Code Scrcpy extension.

**Usage**: `/add-feature <feature-description>`

## Steps

1. Understand the feature request:
   - What should the feature do?
   - Where should it appear in the UI?
   - What extension/webview communication is needed?

2. Plan the implementation:
   - Which existing patterns apply?
   - What new files are needed?
   - What messages need to be added?

3. Check existing patterns in CLAUDE.md files:
   - Service pattern: src/CLAUDE.md
   - Component pattern: webview-ui/CLAUDE.md
   - Message handling: src/views/ScrcpySidebarView.ts

4. Implement the feature following this order:

### For Extension-Side Features

a. Add service method (if needed):
```typescript
// src/services/SomeService.ts
async newFeature(): Promise<void> {
    // Implementation
}
```

b. Add message handler in view/panel:
```typescript
// src/views/ScrcpySidebarView.ts
case 'new-feature':
    await this._handleNewFeature(message);
    break;
```

c. Add response message type if needed.

### For Webview UI Features

a. Add component:
```typescript
// webview-ui/src/components/NewFeature.tsx
export const NewFeature = memo(function NewFeature(props: Props) {
    // Implementation
});
```

b. Add hook if stateful logic is complex:
```typescript
// webview-ui/src/hooks/useNewFeature.ts
export function useNewFeature() {
    // Stateful logic
}
```

c. Add message sending:
```typescript
vscode.postMessage({ command: 'new-feature', ...data });
```

d. Add styles if needed in src/styles/

5. Verify the implementation:

```bash
npm run typecheck
npm run lint
npm run format
```

6. Test by pressing F5 to launch Extension Development Host.

7. Commit with conventional commit format:

```bash
git add .
git commit -m "feat: add <feature-name>

<Brief description of the feature>

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## Checklist

- [ ] TypeScript types defined for all new code
- [ ] Error handling for edge cases
- [ ] Proper cleanup in dispose/unmount
- [ ] Message types documented
- [ ] Follows existing code patterns
