# Folder tree
#
#   platform/                        (delegation boundary, created by the Zygote stack)
#   ├── shared/                      central project
#   └── environments/
#       ├── production/
#       │   └── apps/
#       │       └── <app>/           one app-env project, plus whatever the app repo adds
#       └── staging/
#           └── apps/
#               └── <app>/
#
# Environment-major on purpose: a per-environment folder is the natural attach point
# for org policy, so a new app cannot land in prod without inheriting whatever prod
# enforces. Inheritance is fail-closed this way round; app-major would need every
# policy stamped per app.
#
# Nothing is attached per environment today. The service envelope lives on the
# delegation folder in the Zygote stack and applies uniformly to both, because
# `roles/orgpolicy.policyAdmin` is org-level only and this stack deliberately has no
# org-level write. So this is currently structure without content — adding a prod-only
# policy means moving these folders up into the Zygote stack.

resource "google_folder" "shared" {
  display_name = "shared"
  parent       = data.google_active_folder.platform.name
}

resource "google_folder" "environments" {
  display_name = "environments"
  parent       = data.google_active_folder.platform.name
}

resource "google_folder" "env" {
  for_each = local.envs

  display_name = each.key
  parent       = google_folder.environments.name
}

resource "google_folder" "env_apps" {
  for_each = local.envs

  display_name = "apps"
  parent       = google_folder.env[each.key].name
}

# One folder per app-env, delegated to the app repo.
resource "google_folder" "app_env" {
  for_each = local.app_envs

  display_name = each.value.app
  parent       = google_folder.env_apps[each.value.env].name
}
