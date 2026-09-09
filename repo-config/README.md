# Repo config

Terraform stack applied **on behalf of** an app repo, once per app.

It is not applied from here. Each app repo calls
`.github/workflows/apply-repo-config.yml`, which checks this directory out of
`platform` and applies it against that repo, using state under `<app>/repo`.

## Why it lives in Platform

Two reasons, and the second is the important one.

The credential: managing a ruleset needs repository administration rights, which the
workflow `GITHUB_TOKEN` can never hold — `administration` is not among the permissions
a workflow may request. The only alternative to this arrangement is a GitHub App per
app repo, created by hand, because Apps have no headless creation path.

It authenticates as `medusa-app-terraformer`, deliberately not as the App this repo's
own stack uses. A compromise of this path should not be able to administer Platform,
which holds only while that App is installed on app repos rather than the whole org.
Its key lives in the central project, so the Zygote stack needs no knowledge of apps.

The trust: branch protection is what makes "this ran from main, so it was reviewed"
true. If an app repo's own CI could rewrite its ruleset, that guarantee would be
circular — relax the rule, then push anything. A guard has to be owned above the thing
it guards, which is the same reason org policy sits in the Zygote stack.

## What the app repo controls

`.github/required-checks.json` in the app repo, which is read as **data**. The app
repo decides which of its checks are required; it does not decide what this stack
does.

That distinction is load-bearing. This stack runs holding the Terraformer key, so it
must never execute code the app repo authored — the config here comes from `platform`,
and the app repo contributes variable values only. Applying app-authored HCL under
this identity would let an `external` data source or a hostile provider `source`
exfiltrate the key.

For the same reason the checks file is JSON rather than `.tfvars`, and reaches
Terraform through `TF_VAR_required_checks`. A `-var-file` outranks `TF_VAR_`
environment variables, so a caller supplying one could override `repo_name` and point
this stack at somebody else's repository.
