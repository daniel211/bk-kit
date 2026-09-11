# Secret Scan Patterns

Expanded regex patterns for deep secret scanning in staged git diffs.
Used in bk-commit Step 2 (Deep Secret Scan).

## Pattern List

### Cloud Provider Keys

| Service | Pattern | Example Match |
|---------|---------|---------------|
| AWS Access Key | `AKIA[A-Z0-9]{16}` | `AKIAIOSFODNN7EXAMPLE` |
| AWS Secret Key | `(?i)aws.{0,20}secret.{0,20}[A-Za-z0-9+/]{40}` | In config files |
| Firebase | `AIza[0-9A-Za-z_-]{35}` | `AIzaSyBx...` |
| Google OAuth | `[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com` | Client ID format |

### Source Control & CI/CD

| Service | Pattern | Example Match |
|---------|---------|---------------|
| GitHub PAT (classic) | `ghp_[a-zA-Z0-9]{36}` | `ghp_abc123...` |
| GitHub PAT (fine-grained) | `github_pat_[a-zA-Z0-9_]{82}` | New format |
| GitHub OAuth | `gho_[a-zA-Z0-9]{36}` | OAuth token |
| GitLab PAT | `glpat-[a-zA-Z0-9_-]{20}` | `glpat-abc123...` |

### Communication & SaaS

| Service | Pattern | Example Match |
|---------|---------|---------------|
| Slack Bot Token | `xoxb-[a-zA-Z0-9-]+` | `xoxb-123-456-abc` |
| Slack App Token | `xapp-[a-zA-Z0-9-]+` | `xapp-1-abc123` |
| Slack OAuth | `xoxo-[a-zA-Z0-9-]+` | OAuth token |
| Slack Webhook | `xoxs-[a-zA-Z0-9-]+` | User token |
| Slack (combined) | `xox[bpoas]-[a-zA-Z0-9-]+` | All Slack tokens |

### AI / ML Services

| Service | Pattern | Example Match |
|---------|---------|---------------|
| OpenAI API key | `sk-[a-zA-Z0-9]{48}` | `sk-abc123...` |
| OpenAI Org | `org-[a-zA-Z0-9]{24}` | Org identifier |
| Anthropic | `sk-ant-[a-zA-Z0-9_-]{95}` | Claude API key |

### Generic Patterns

| Pattern Type | Pattern | Notes |
|-------------|---------|-------|
| Password assignment | `(?i)(password\|passwd\|pwd)\s*[:=]\s*[A-Za-z0-9+/=!@#$%^&*]{8,}` | Catches `password = abc123` |
| Secret assignment | `(?i)secret\s*[:=]\s*[A-Za-z0-9+/=]{20,}` | Generic secret |
| Token assignment | `(?i)(token\|api_key\|apikey\|access_key)\s*[:=]\s*[A-Za-z0-9+/=_-]{20,}` | Generic token |
| Private key header | `-----BEGIN (RSA\|EC\|OPENSSH\|DSA\|PGP) PRIVATE KEY` | Any private key |
| Certificate | `-----BEGIN CERTIFICATE-----` | Embedded cert |

### Database Connection Strings

| Service | Pattern |
|---------|---------|
| MongoDB | `mongodb(\+srv)?://[^:]+:[^@]+@` |
| PostgreSQL | `postgres(ql)?://[^:]+:[^@]+@` |
| MySQL | `mysql://[^:]+:[^@]+@` |
| Redis | `redis://[^:]+:[^@]+@` (with auth) |

## Bash Scan Command

```bash
git diff --cached | grep -inE \
  "(AKIA[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{35}|ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}|glpat-[a-zA-Z0-9_-]{20}|xox[bpoas]-[a-zA-Z0-9-]+|sk-[a-zA-Z0-9]{48}|sk-ant-[a-zA-Z0-9_-]{95}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY|(password|secret|token|api_key)\s*[:=]\s*[A-Za-z0-9+\/=]{20,}|(mongodb|postgres|mysql|redis)://[^:]+:[^@]+@)"
```

## False Positive Handling

Some patterns may match legitimate non-secret content:

- **Token in variable names**: `tokenCount`, `tokenize` — context matters, scan the line
- **Test fixtures**: `password = "test123"` in test files — still flag, ask user to confirm
- **Env var references**: `process.env.SECRET` — this is safe, skip lines with `process.env.`
- **Placeholder values**: `password = "YOUR_PASSWORD_HERE"` — safe, skip obvious placeholders

## Exclusions

Never scan these as they are expected to contain pattern-like strings:
- `*.md` documentation files that discuss patterns (like this file)
- `secret-scan-patterns.md` itself
- Test fixture files that use clearly fake/placeholder values

## On Detection

When any pattern matches:
1. **BLOCK** the commit immediately
2. Show the matched line(s) with file path and line number
3. Ask user to remove or move to `.env` (which is gitignored)
4. Never suggest committing with `--no-verify`
