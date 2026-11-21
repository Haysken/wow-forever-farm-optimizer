# GITHUB REPOSITORY AND VERSION CONTROL WORKFLOW

## 1. Repository Creation

Create a new GitHub repository for this project.

Suggested repository name:

wow-forever-farm-optimizer

Requirements:

- Use GitHub as the central remote repository.
- Initialize Git locally.
- Configure the GitHub repository as origin.
- Use the main branch as the production-ready branch.
- Create a proper .gitignore.
- Never commit secrets, API keys, credentials, environment files, or private configuration.
- Include a comprehensive README.md.

If GitHub authentication is unavailable, ask the user to authenticate rather than attempting to bypass authentication.

## 2. Mandatory Synchronization

Every time code is modified, added, or removed, the changes must be tracked in Git.

At the end of every completed development task:

1. Review all modified files.
2. Run relevant tests.
3. Run linting and type checks when applicable.
4. Check for accidental secrets or sensitive information.
5. Review the Git diff.
6. Create a meaningful commit.
7. Push the commit to GitHub.

Do not leave completed development tasks uncommitted.

## 3. Commit Standards

Use clear, descriptive commit messages.

Follow Conventional Commits:

- feat: new functionality.
- fix: bug fixes.
- refactor: code restructuring.
- docs: documentation updates.
- test: tests and testing improvements.
- perf: performance improvements.
- chore: maintenance and configuration.

Examples:

feat: implement creature loot database
feat: add auction house price integration
fix: correct expected gold per hour calculation
refactor: improve market data providers
docs: document auction house API integration
test: add drop probability calculation tests

## 4. Branch Management

Use:

- main: stable and tested code.
- feature/*: new functionality.
- fix/*: bug fixes.

For substantial features, create a dedicated feature branch.

Merge into main only after successful validation.

Do not force-push or rewrite shared Git history without explicit permission.

## 5. GitHub Updates

The GitHub repository must remain synchronized with the local project.

Push completed changes after each meaningful development task, not necessarily after every individual file edit.

Never push:
- Broken or incomplete changes presented as finished.
- Secrets or credentials.
- Unreviewed generated files.
- Temporary debugging artifacts.

If tests fail, report the failure and do not represent the changes as validated.

If a push fails, preserve the local commits and report the issue. Retry after resolving authentication or connectivity problems.

## 6. Development Reports

After each completed task, report:

- What was implemented.
- Files modified.
- Tests performed and their results.
- Commit hash.
- GitHub branch.
- Whether the push succeeded.
- Any outstanding issues.

## 7. User Approval

The initial repository creation must be completed after GitHub authentication is available.

Routine commits and pushes for completed development tasks are authorized by this workflow.

Destructive Git operations, repository deletion, history rewriting, and force-pushing require explicit user approval.