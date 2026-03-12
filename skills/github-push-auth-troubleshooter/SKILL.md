---
name: github-push-auth-troubleshooter
description: Diagnose and resolve GitHub push authentication failures for repository remotes. Use when `git push` fails with errors such as "Invalid username or token", "Authentication failed", "Permission denied (publickey)", credential helper mismatches, or remote URL/protocol confusion, and when setting up or rotating HTTPS PAT and SSH authentication.
---

# Github Push Auth Troubleshooter

Use the quickest safe path to restore push access, then harden the repository authentication setup.

## Quick Triage

1. Run `git remote -v` and identify whether remote protocol is HTTPS or SSH.
2. Run `git branch --show-current` and confirm the branch intended for push.
3. Match the first failing error to one of these buckets:
- HTTPS credential problem (`Invalid username or token`, `Authentication failed`)
- SSH key/setup problem (`Permission denied (publickey)`)
- Repository/permission mismatch (`Repository not found`, protected branch rules)

## HTTPS Recovery (PAT)

1. Create a GitHub Personal Access Token with repository write access.
2. Clear stale cached credentials:
```bash
printf "protocol=https\nhost=github.com\n" | git credential-osxkeychain erase
```
3. Push again and authenticate with:
- Username: GitHub username
- Password: the PAT (not GitHub account password)
4. If the remote URL is wrong, fix it:
```bash
git remote set-url origin https://github.com/<owner>/<repo>.git
```

## SSH Workflow (Preferred Long-Term)

### A. First-Time Setup

1. Generate key pair:
```bash
ssh-keygen -t ed25519 -C "<email>"
```
2. Start agent and add key:
```bash
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
```
3. Add public key to GitHub (`~/.ssh/id_ed25519.pub`).
4. Verify account handshake:
```bash
ssh -T git@github.com
```

### B. Repository Switch to SSH

1. Update remote:
```bash
git remote set-url origin git@github.com:<owner>/<repo>.git
```
2. Confirm remote:
```bash
git remote -v
```
3. Push branch:
```bash
git push -u origin <branch>
```

### C. Recovery Paths

1. Error: `Permission denied (publickey)`:
- Run `ssh-add ~/.ssh/id_ed25519`
- Re-test `ssh -T git@github.com`
- Confirm key exists in GitHub SSH keys UI.
2. Error: wrong GitHub account:
- Run `ssh -vT git@github.com` and inspect selected key.
- Set explicit identity in `~/.ssh/config`:
```sshconfig
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```
3. Error: repo access denied after successful SSH handshake:
- Confirm repository permissions for the authenticated GitHub account.
- Confirm remote owner/repo path is correct.

## Verification Checklist

1. Confirm remote: `git remote -v`
2. Confirm auth path:
- HTTPS: push prompts for PAT and succeeds.
- SSH: `ssh -T git@github.com` succeeds.
3. Confirm permissions on target repository owner and branch.
4. Push with upstream set:
```bash
git push -u origin <branch>
```

## Response Template

Use this concise format when helping users:
1. State root cause category from the observed error.
2. Provide exact commands to fix it.
3. Provide one verification command and expected outcome.
4. Offer fallback path (switch HTTPS <-> SSH) only if first path fails.

## Reference

Load [references/github-auth-errors.md](references/github-auth-errors.md) for fast mapping from error text to probable cause and next command, including SSH-specific workflow failures.
