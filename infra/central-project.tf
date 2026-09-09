#region Central GCP project

resource "random_id" "central_project_suffix" {
  byte_length = 4
}

resource "google_project" "central" {
  folder_id       = google_folder.shared.folder_id
  billing_account = data.google_billing_account.gcp_billing_account.id

  name       = "central"
  project_id = "ms-central-${random_id.central_project_suffix.hex}"

}

resource "google_project_service" "central" {
  for_each = toset([
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "secretmanager.googleapis.com",
    "serviceusage.googleapis.com",
    "storage.googleapis.com",
    "sts.googleapis.com",
  ])

  project            = google_project.central.project_id
  service            = each.key
  disable_on_destroy = false
}

#endregion

#region Central Terraform state bucket

resource "random_id" "central_tfstate_bucket_suffix" {
  byte_length = 4
}

resource "google_storage_bucket" "central_tfstate" {
  name          = "ms-central-tfstate-${random_id.central_tfstate_bucket_suffix.hex}"
  project       = google_project.central.project_id
  location      = local.gcp_primary_location
  storage_class = "STANDARD"

  # Prevent the bucket from being destroyed if it contains objects (the Terraform state files)
  force_destroy = false

  # Enforce uniform bucket-level access (security best practice)
  uniform_bucket_level_access = true

  # Prevent the bucket from being accidentally made public
  public_access_prevention = "enforced"

  # Keep old versions of files safe from accidental deletion
  versioning {
    enabled = true
  }

  # Prune superseded state versions
  lifecycle_rule {
    condition {
      with_state         = "ARCHIVED"
      num_newer_versions = 5
      age                = 30 # days
    }

    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.central]
}

#endregion

# Central workload identity pool
resource "google_iam_workload_identity_pool" "central" {
  project                   = google_project.central.project_id
  workload_identity_pool_id = "central-pool"
  display_name              = "Central"
  description               = "Central workload identity pool."
  disabled                  = false

  depends_on = [google_project_service.central]
}

#region Outputs

output "gcp_central_project_id" {
  description = "GCP central project ID."
  value       = google_project.central.project_id
}

output "central_tfstate_bucket_name" {
  description = "GCP central Terraform state bucket name."
  value       = google_storage_bucket.central_tfstate.name
}

#endregion
