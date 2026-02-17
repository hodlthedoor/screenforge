---
name: Bug Report
about: Report a bug to help us improve ScreenForge
title: ''
labels: bug
assignees: ''
---

**Describe the bug**
A clear and concise description of what the bug is.

**To reproduce**
Steps or curl command to reproduce the behavior:

```bash
curl -X POST http://localhost:3100/v1/screenshot \
  -H "Authorization: Bearer sf_live_..." \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

**Expected behavior**
What you expected to happen.

**Actual behavior**
What actually happened. Include error messages, status codes, or response bodies.

**Environment**

- ScreenForge version: [e.g. v1.0.0]
- Deployment: [Docker / Bare metal]
- Node.js version: [e.g. 22.x]
- OS: [e.g. Ubuntu 24.04]

**Logs**
Relevant log output (redact any API keys or secrets).

**Additional context**
Any other context about the problem.
