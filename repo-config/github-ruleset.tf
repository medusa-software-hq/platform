# Branch protection for the app repo's default branch.
resource "github_repository_ruleset" "default_branch" {
  name        = "Default branch"
  repository  = var.repo_name
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    creation                = true
    update                  = false
    deletion                = true
    required_linear_history = false
    required_signatures     = false
    non_fast_forward        = true # Block force pushes

    pull_request {
      allowed_merge_methods = ["merge"]
    }

    required_status_checks {
      dynamic "required_check" {
        for_each = toset(var.required_checks)

        content {
          context        = required_check.value
          integration_id = local.gh_actions_integration_id
        }
      }

      strict_required_status_checks_policy = true
    }
  }
}

resource "github_actions_repository_permissions" "this" {
  repository      = var.repo_name
  enabled         = true
  allowed_actions = "all"
}
