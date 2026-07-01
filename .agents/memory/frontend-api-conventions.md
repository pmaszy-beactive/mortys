---
name: Frontend data-fetching conventions (Morty's app)
description: How apiRequest and the default TanStack Query fetcher behave in client/src/lib/queryClient.ts
---

- `apiRequest(method, url, data)` returns the PARSED body (axios `response.data`) — NOT a Response. Never call `.json()` on its result.
- The default query fn (getQueryFn) fetches ONLY `queryKey[0]`. Multi-segment query keys like `['/api/x', id, 'sub']` will hit `/api/x`, not the full path. For parameterized URLs, supply an explicit `queryFn` that builds the real URL (e.g. `queryFn: () => apiRequest('GET', \`/api/x/${id}/sub\`)`).

**Why:** two runtime bugs (broken exam start/flag, and monitor queries hitting wrong URLs) came from assuming Response semantics / auto-joined query keys.
