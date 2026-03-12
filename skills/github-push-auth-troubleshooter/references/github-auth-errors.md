# GitHub Auth Error Map

## HTTPS Errors

- `Invalid username or token`
Cause: account password used instead of PAT, expired PAT, or cached bad credential.
Action: erase cached credential, retry push, enter PAT.

- `Authentication failed for https://github.com/...`
Cause: same as above or wrong repository URL.
Action: verify `git remote -v`, reset remote URL, authenticate with PAT.

## SSH Errors

- `Permission denied (publickey)`
Cause: no key loaded, key not added to GitHub, or wrong SSH identity.
Action: run `ssh-add ~/.ssh/id_ed25519`, add public key to GitHub, test `ssh -T git@github.com`.

- `Hi <user>! You've successfully authenticated, but GitHub does not provide shell access.`
Cause: SSH auth is working.
Action: treat as success signal; continue with `git push`.

- SSH uses wrong account/key
Cause: multiple SSH keys loaded and incorrect identity selected.
Action: run `ssh -vT git@github.com`, then pin identity in `~/.ssh/config` with `IdentitiesOnly yes`.

## Repository/Access Errors

- `Repository not found`
Cause: typo in owner/repo, private repo without access, or wrong account.
Action: correct remote URL and confirm account has access.

- `remote: Write access to repository not granted`
Cause: authenticated identity lacks write permission.
Action: confirm collaborator/team permission on target repository.

## Core Commands

```bash
git remote -v
git branch --show-current
printf "protocol=https\nhost=github.com\n" | git credential-osxkeychain erase
eval "$(ssh-agent -s)"
ssh-add ~/.ssh/id_ed25519
ssh -vT git@github.com
ssh -T git@github.com
git push -u origin <branch>
```
