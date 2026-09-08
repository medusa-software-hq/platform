# Constants
locals {
  organization_domain = "medusa.software"

  gcp_primary_location = "europe-west1"
  gcp_root_project_id  = "ms-root-cc216992"

  gh_organization_name = "medusa-software-hq"
}

#region Environments/apps map

locals {
  # Environments every app is stamped into.
  envs = {
    production = { short = "prod" }
    staging    = { short = "stg" }
  }

  # Map of all apps.
  apps = {
    demo = { display_name = "Demo" }
  }

  # Flattened app x env, keyed "<app>-<env>"
  app_envs = merge([
    for app_key, app in local.apps : {
      for env_key, env in local.envs :
      "${app_key}-${env_key}" => {
        app          = app_key
        app_name     = app.display_name
        env          = env_key
        short        = env.short
        display_name = "${app.display_name} - ${env_key}"
      }
    }
  ]...)
}

#endregion

# Terraform configuration
terraform {
  required_version = ">= 1.15"

  backend "gcs" {
    bucket = "ms-root-tfstate-9d350b22"
    prefix = "platform"
  }

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.11"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 7.25"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.8"
    }
  }
}

#region Terraform providers

provider "google" {
  project = local.gcp_root_project_id
  region  = local.gcp_primary_location
}

provider "github" {
  owner = local.gh_organization_name

  app_auth {
    # https://github.com/organizations/medusa-software-hq/settings/apps/medusa-platform-terraformer
    id = "4874543"
    # https://github.com/organizations/medusa-software-hq/settings/installations/160089048
    installation_id = "160089048"
    pem_file        = data.google_secret_manager_secret_version_access.platform_terraformer_app_pem.secret_data
  }
}

#endregion

#region Referenced global resources

data "google_organization" "gcp_organization" {
  domain = local.organization_domain
}

data "google_billing_account" "gcp_billing_account" {
  display_name = "My Billing Account"
  open         = true

  # Skip enumerating the account's projects. That listing needs
  # `billing.resourceAssociations.list`, which is not in `roles/billing.user` — the
  # only billing role this stack holds — and nothing here uses the result.
  lookup_projects = false
}

# Folder managed by this stack
data "google_active_folder" "platform" {
  display_name = "platform"
  parent       = data.google_organization.gcp_organization.name
}

# Terraformer GitHub App PEM key
data "google_secret_manager_secret_version_access" "platform_terraformer_app_pem" {
  project = local.gcp_root_project_id
  secret  = "gh-platform-terraformer-app-pem"
}

#endregion
