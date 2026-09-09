# Platform infrastructure

The folder hierarchy, one project per app per environment, and the identities app
repositories deploy with. Everything beneath the folder delegated by the bootstrap
stack in the `zygote` repository.

## How it runs

Pull requests get a preview; merges to `main` apply. Both happen in Pulumi Deployments,
not in GitHub Actions — the checks here are static only (formatting, lint, types), and
it is the preview that says whether a change plans cleanly against real infrastructure.

Credentials never touch this repository. The stack references a Pulumi ESC environment
which mints a short-lived GCP token by OIDC, so a local `pulumi up` and a Deployments
run authenticate identically, and neither involves a key.

The identity itself belongs to the bootstrap stack: the account, the trust that lets
Pulumi Cloud assume it, and the grants defining its reach are all owned there, so this
stack cannot widen what it runs as.

## Reproducing the wiring

Neither of these lives in a file, so they are recorded here.

The ESC environment, from the definition in `esc/`:

```
pulumi env edit platform/gcp --file esc/gcp.yaml
```

The Deployments settings:

```
pulumi deployment settings edit \
  --github-repo medusa-software-hq/platform \
  --branch main --folder infra \
  --preview-prs --push-to-deploy \
  --pre-run-command "corepack enable"
```

## Why npm here

Every other TypeScript package in the organization uses yarn 4 through corepack. This
one uses npm, for one reason: the Pulumi Deployments runner ships Node without `yarn`
on PATH, and it installs dependencies *before* running any pre-run command, so there
is no point at which corepack can be enabled.

The pre-run command below survives as a belt-and-braces measure. The `zygote` bootstrap
stack keeps yarn, since it is applied by hand and never runs in a deployment.
