# Per-repository configuration, applied by app repos running Platform's code
#
# App repos need a GitHub credential with repository administration rights to manage
# their own branch protection, and the workflow GITHUB_TOKEN cannot provide it —
# `administration` is not among the permissions a workflow may request. The credential
# is therefore never handed over. Platform publishes a reusable workflow, app repos
# call it, and the provider below trusts `job_workflow_ref`: the claim describing the
# *called* workflow, which a caller cannot forge. An app repo reaches the key only
# while Platform's reviewed code is the thing executing.
#
# A second GitHub App, separate from the one this stack authenticates with, so a
# compromise of this path cannot administer Platform itself. That separation only
# holds while the App is installed on app repos alone.

#region Terraformer App key

# Terraform owns the container only; the key is added by hand, once:
#
#   gcloud secrets versions add gh-app-terraformer-app-pem \
#     --project=<central project> --data-file=<path-to-pem>
resource "google_secret_manager_secret" "app_terraformer_app_pem" {
  project   = google_project.central.project_id
  secret_id = "gh-app-terraformer-app-pem"

  replication {
    user_managed {
      replicas {
        location = local.gcp_primary_location
      }
    }
  }

  depends_on = [google_project_service.central]
}

#endregion

#region Workload identity

# Its own pool, deliberately. The key grant below covers every identity the pool can
# mint, so the pool must contain nothing else — putting this provider in central-pool
# alongside the per-environment app providers would hand the key to every app's CI.
resource "google_iam_workload_identity_pool" "repo_config" {
  project                   = google_project.central.project_id
  workload_identity_pool_id = "repo-config-pool"
  display_name              = "Repo config"
  description               = "Identities running the Platform repo-config workflow."
  disabled                  = false

  depends_on = [google_project_service.central]
}

resource "google_iam_workload_identity_pool_provider" "repo_config" {
  project                            = google_project.central.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.repo_config.workload_identity_pool_id
  workload_identity_pool_provider_id = "repo-config-github-actions"
  display_name                       = "Repo config / GitHub Actions"
  description                        = "Trusts the Platform repo-config reusable workflow, whichever repo calls it."
  disabled                           = false

  attribute_mapping = {
    "google.subject" = "assertion.sub"

    # Always the organization. Lets the key be granted to the whole pool using a
    # documented principalSet format, without enumerating apps.
    "attribute.repository_owner" = "assertion.repository_owner"

    # Which repo called. State access is bound per-app on this.
    "attribute.repo_config_repository" = "assertion.repository"
  }

  # No environment, by design: repository configuration is not per-environment. The
  # trust is `job_workflow_ref` pinned to main — a pull request run carries
  # refs/pull/N/merge, so a PR cannot alter the workflow and still be trusted.
  attribute_condition = join(" && ", [
    "assertion.repository_owner == '${local.gh_organization_name}'",
    "assertion.job_workflow_ref == '${local.gh_organization_name}/platform/.github/workflows/apply-repo-config.yml@refs/heads/main'",
  ])

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

# Granted to the federated principal rather than through a service account: Google
# recommends direct resource access where the resource supports it, and it means no
# key and no impersonation step.
resource "google_secret_manager_secret_iam_member" "repo_config_pem_accessor" {
  project   = google_secret_manager_secret.app_terraformer_app_pem.project
  secret_id = google_secret_manager_secret.app_terraformer_app_pem.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.repo_config.name}/attribute.repository_owner/${local.gh_organization_name}"
}

#endregion

#region Terraform state access

locals {
  # Per-app principal. The key is available to every identity the pool mints, but
  # state is scoped per repository so one app's run cannot touch another's.
  repo_config_principals = {
    for key, app in local.apps :
    key => "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.repo_config.name}/attribute.repo_config_repository/${local.gh_organization_name}/${github_repository.app[key].name}"
  }
}

resource "google_storage_bucket_iam_member" "app_repo_config_state" {
  for_each = local.apps

  bucket = google_storage_bucket.central_tfstate.name
  role   = "roles/storage.objectUser"
  member = local.repo_config_principals[each.key]

  condition {
    title      = "${each.key}-repo-prefix"
    expression = <<-EOT
      resource.type == "storage.googleapis.com/Object" &&
      resource.name.startsWith("projects/_/buckets/${google_storage_bucket.central_tfstate.name}/objects/${each.key}/repo/")
    EOT
  }
}

# `storage.objects.list` is authorized against the bucket, so a prefix condition can
# never match it. See the matching pair on the per-environment identities.
resource "google_storage_bucket_iam_member" "app_repo_config_state_list" {
  for_each = local.apps

  bucket = google_storage_bucket.central_tfstate.name
  role   = "roles/storage.legacyBucketReader"
  member = local.repo_config_principals[each.key]
}

#endregion

#region GitHub Actions variables

# Read by Platform's reusable workflow. `vars` in a reusable workflow resolve in the
# CALLER's context, so anything that workflow needs has to be published here.
resource "github_actions_variable" "app_repo_config_wi_provider" {
  for_each = local.apps

  repository    = github_repository.app[each.key].name
  variable_name = "GCP_REPO_CONFIG_WI_PROVIDER"
  value         = google_iam_workload_identity_pool_provider.repo_config.name
}

resource "github_actions_variable" "app_repo_config_secret" {
  for_each = local.apps

  repository    = github_repository.app[each.key].name
  variable_name = "GCP_REPO_CONFIG_SECRET"
  value         = "${google_secret_manager_secret.app_terraformer_app_pem.project}/${google_secret_manager_secret.app_terraformer_app_pem.secret_id}"
}

#endregion
