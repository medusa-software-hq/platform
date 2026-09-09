#region App GitHub repositories

resource "github_repository" "app" {
  for_each = local.apps

  name = each.key

  visibility = "public"

  is_template = false

  has_discussions = false
  has_issues      = true
  has_projects    = false
  has_wiki        = false

  allow_merge_commit = true
  allow_squash_merge = false
  allow_rebase_merge = false

  allow_forking          = true
  allow_auto_merge       = true
  delete_branch_on_merge = true
}

locals {
  # App repos that existed before this stack did. Drop an entry once its first apply
  # has adopted it; apps added from here on are created by the resource above.
  preexisting_app_repos = toset(["demo"])
}

import {
  for_each = local.preexisting_app_repos

  id = each.value
  to = github_repository.app[each.value]
}

# GitHub Actions workload identity provider (per app).
resource "google_iam_workload_identity_pool_provider" "app_github_actions" {
  for_each = local.apps

  project                            = google_project.central.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.central.workload_identity_pool_id
  workload_identity_pool_provider_id = "${each.key}-github-actions"
  display_name                       = "${each.value.display_name} / GitHub Actions"
  description                        = "Workload identity provider for GitHub Actions in the ${each.value.display_name} app repo."
  disabled                           = false

  attribute_mapping = {
    "google.subject" = "assertion.sub"

    # Unused today; kept for a future repo-level, environment-less binding
    "attribute.repository" = "assertion.repository"

    "attribute.repository_environment" = "assertion.repository + ':' + assertion.environment"
  }

  # Trust only this app's repository, and only jobs running in an environment
  attribute_condition = "assertion.repository == '${local.gh_organization_name}/${github_repository.app[each.key].name}' && has(assertion.environment)"

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

#endregion

#region App-env projects

resource "random_id" "app_env_project_suffix" {
  for_each = local.app_envs

  byte_length = 2
}

resource "google_project" "app_env" {
  for_each = local.app_envs

  folder_id       = google_folder.app_env[each.key].folder_id
  billing_account = data.google_billing_account.gcp_billing_account.id

  name       = each.value.display_name
  project_id = "ms-${each.value.app}-${each.value.short}-${random_id.app_env_project_suffix[each.key].hex}"

  deletion_policy = "DELETE"
}

# Only what this stack needs to place a service account (everything else the app enables for itself).
resource "google_project_service" "app_env" {
  for_each = local.app_envs

  project            = google_project.app_env[each.key].project_id
  service            = "iam.googleapis.com"
  disable_on_destroy = false
}

#endregion

#region App-env CI/CD

resource "google_service_account" "app_env_cicd" {
  for_each = local.app_envs

  project      = google_project.app_env[each.key].project_id
  account_id   = "${each.value.app}-${each.value.short}-cicd"
  display_name = "${each.value.display_name} CI/CD"

  depends_on = [google_project_service.app_env]
}

# Allow GitHub Actions to impersonate the app's CI/CD service account (conditionally)
resource "google_service_account_iam_member" "app_env_cicd_workload_identity" {
  for_each = local.app_envs

  service_account_id = google_service_account.app_env_cicd[each.key].name
  role               = "roles/iam.workloadIdentityUser"

  # Condition: Only the app's repository and only jobs running in the right environment
  member = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.central.name}/attribute.repository_environment/${local.gh_organization_name}/${github_repository.app[each.value.app].name}:${each.value.env}"
}

# Grant the app's CI/CD service account full ownership of its own project.
resource "google_project_iam_member" "app_env_cicd_owner" {
  for_each = local.app_envs

  project = google_project.app_env[each.key].project_id
  role    = "roles/owner"
  member  = "serviceAccount:${google_service_account.app_env_cicd[each.key].email}"
}

#region Terraform state access

resource "google_storage_bucket_iam_member" "app_env_cicd_bucket_access" {
  for_each = local.app_envs

  bucket = google_storage_bucket.central_tfstate.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.app_env_cicd[each.key].email}"

  condition {
    title      = "${each.value.app}-${each.value.short}-prefix"
    expression = <<-EOT
      resource.type == "storage.googleapis.com/Object" &&
      resource.name.startsWith("projects/_/buckets/${google_storage_bucket.central_tfstate.name}/objects/${each.value.app}/${each.value.env}/")
    EOT
  }
}

# Bucket listing (_not_ reading the objects' content)
resource "google_storage_bucket_iam_member" "app_env_cicd_bucket_list" {
  for_each = local.app_envs

  bucket = google_storage_bucket.central_tfstate.name
  role   = "roles/storage.legacyBucketReader"
  member = "serviceAccount:${google_service_account.app_env_cicd[each.key].email}"
}

#endregion

#endregion

#region GitHub environments

resource "github_repository_environment" "app_env" {
  for_each = local.app_envs

  repository  = github_repository.app[each.value.app].name
  environment = each.value.env
}

locals {
  # Environment-agnostic variables
  app_variables = merge([
    for key, app in local.apps : {
      for name, value in {
        GCP_CICD_WI_PROVIDER = google_iam_workload_identity_pool_provider.app_github_actions[key].name
        TF_STATE_BUCKET      = google_storage_bucket.central_tfstate.name
      } :
      "${key}/${name}" => {
        app   = key
        name  = name
        value = value
      }
    }
  ]...)

  # Environment-specific variables
  app_env_variables = merge([
    for key, app_env in local.app_envs : {
      for name, value in {
        GCP_PROJECT_ID     = google_project.app_env[key].project_id
        GCP_PROJECT_NUMBER = google_project.app_env[key].number
        GCP_CICD_SA_EMAIL  = google_service_account.app_env_cicd[key].email
        TF_STATE_PREFIX    = "${app_env.app}/${app_env.env}"
      } :
      "${key}/${name}" => {
        app_env = key
        name    = name
        value   = value
      }
    }
  ]...)
}

# Set the repo-scoped variables
resource "github_actions_variable" "app" {
  for_each = local.app_variables

  repository    = github_repository.app[each.value.app].name
  variable_name = each.value.name
  value         = each.value.value
}

# Set the environment-scoped variables
resource "github_actions_environment_variable" "app_env" {
  for_each = local.app_env_variables

  repository    = github_repository.app[local.app_envs[each.value.app_env].app].name
  environment   = github_repository_environment.app_env[each.value.app_env].environment
  variable_name = each.value.name
  value         = each.value.value
}

#endregion

#region Outputs

output "gcp_app_env_project_ids" {
  description = "GCP project ID per app-env."
  value       = { for key, project in google_project.app_env : key => project.project_id }
}

#endregion
